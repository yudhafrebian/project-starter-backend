# 04 · Autentikasi & Sesi

## Gambaran besar

Sesi memakai **dua token** yang disimpan di **cookie `httpOnly`** (tidak bisa dibaca JavaScript di browser):

| | Access token | Refresh token |
|---|---|---|
| Cookie | `access_token` | `refresh_token` |
| Bentuk | JWT (HS256), payload hanya `sub` = user id | 32 byte acak (`base64url`), **bukan** JWT |
| Umur | **15 menit** (`ACCESS_TTL_SECONDS`) | **30 hari** (`REFRESH_TTL_SECONDS`) |
| Disimpan di database | Tidak | Ya, hanya **hash SHA-256**-nya |
| Cookie `path` | `/`: dikirim ke semua endpoint | `/api/v1/auth`: hanya dikirim ke endpoint auth |
| Dipakai untuk | Membuktikan identitas di setiap request | Meminta access token baru |
| Bisa dicabut sebelum kedaluwarsa | Tidak (tunggu maksimal 15 menit) | Ya, langsung |

Opsi cookie (keduanya): `httpOnly: true`, `sameSite: "lax"`, `secure: true` hanya saat `NODE_ENV=production`.

### Kenapa dua token?

- Access token **tidak perlu query ke tabel token** saat diverifikasi, jadi cepat. Kelemahannya, token ini tidak bisa dicabut. Umurnya dibuat pendek supaya kerugian kalau token bocor tetap kecil.
- Refresh token **bisa dicabut** (logout, ganti password, akun dinonaktifkan), karena dicek ke database setiap kali dipakai. Token ini jarang dikirim (hanya ke `/api/v1/auth`), jadi peluangnya bocor lebih kecil.

### Kenapa refresh token di-hash dengan SHA-256, bukan bcrypt?

bcrypt dirancang untuk **password**, yang entropinya rendah dan bisa ditebak. Refresh token adalah 256 bit acak, sehingga mustahil ditebak, dan hash cepat seperti SHA-256 sudah cukup. Selain itu, token perlu **dicari** di database berdasarkan hash-nya (`WHERE tokenHash = ?`). Itu hanya bisa dilakukan dengan hash yang deterministik. bcrypt memakai salt acak, jadi hasilnya selalu berbeda dan tidak bisa dipakai untuk pencarian.

Kalau database bocor, isi tabel `RefreshToken` tidak bisa dipakai untuk login, karena yang tersimpan hanya hash-nya.

## Login (email + password)

`POST /api/v1/auth/login`, body `{ email, password }`.

```
1. Cari user berdasarkan email (sudah di-trim & lowercase oleh validasi)
2. Verifikasi password dengan bcrypt.
   Jika user tidak ada / tidak punya password → bandingkan dengan "dummyHash"
3. user tidak ada, password salah, atau user nonaktif → 401 invalid_credentials
4. Email belum terverifikasi                           → 403 email_not_verified
5. createSession() → set 2 cookie → 200 { data: { id, email, name, role } }
```

### Perlindungan di alur login

- **Pesan error yang sama** untuk "email tidak terdaftar", "password salah", "akun nonaktif", dan "akun Google-only tanpa password". Penyerang tidak bisa mengetahui email mana yang terdaftar.
- **Dummy hash (timing attack).** Kalau email tidak terdaftar dan kode langsung menjawab tanpa menjalankan bcrypt, responsnya jauh lebih cepat (sekitar 1 ms dibanding sekitar 250 ms), dan penyerang bisa membedakannya dari waktu respons. Karena itu bcrypt **selalu** dijalankan, terhadap `dummyHash` kalau user tidak ada. `dummyHash` dibuat dengan `hashPassword()` supaya cost-nya selalu sama dengan hash user asli, dan dibuat **sekali saat startup** supaya login pertama tidak lebih lambat.
- **`email_not_verified` hanya dikembalikan setelah password terbukti benar.** Kalau dicek sebelum password, siapa pun bisa mengetahui bahwa email itu terdaftar tapi belum diverifikasi.
- **Rate limit:** 10 percobaan per 15 menit per IP (`loginLimiter`, dipakai bersama dengan `/auth/google`).

## Membuat sesi

`createSession(userId, meta)` di `auth.service.ts` adalah **satu-satunya pintu** pembuatan sesi. Fungsi ini dipakai oleh login password, login Google, dan change password.

```
familyId = crypto.randomUUID()          ← satu "keluarga" = satu kali login = satu perangkat
refresh  = 32 byte acak
simpan RefreshToken { userId, familyId, tokenHash: sha256(refresh), expiresAt: +30 hari, userAgent, ip }
access   = JWT { sub: userId }, berlaku 15 menit
```

`userAgent` (dipotong maksimal 512 karakter) dan `ip` disimpan untuk fitur "daftar sesi aktif" di masa depan.

## Memakai access token

Middleware `requireAuth`:

1. Mengambil token dari cookie `access_token`, atau dari header `Authorization: Bearer <token>` (berguna untuk mobile app atau testing).
2. Memverifikasi JWT (algoritma dikunci ke `HS256`, sehingga serangan `alg: none` tertolak).
3. **Memuat user dari database di setiap request** (`id`, `email`, `name`, `role`, `active`).
4. User tidak ada atau `active = false` → `401 unauthenticated`.
5. Mengisi `req.user`.

Langkah 3 memang disengaja. Konsekuensinya satu query per request, tapi imbalannya: **perubahan role dan penonaktifan akun berlaku seketika**, tanpa menunggu access token kedaluwarsa.

## Refresh (rotation)

`POST /api/v1/auth/refresh`, tanpa body. Browser otomatis mengirim cookie `refresh_token`.

```
1. Tidak ada cookie                                  → 401 invalid_session
2. Cari token berdasarkan sha256(cookie)
   tidak ditemukan                                   → 401 invalid_session
3. Token SUDAH dicabut (revokedAt terisi)?
     dicabut < 10 detik lalu  → kemungkinan 2 tab refresh bersamaan → 401, sesi TIDAK diganggu
     dicabut ≥ 10 detik lalu  → PENCURIAN TERDETEKSI → cabut seluruh keluarga → 401
4. Token kedaluwarsa ATAU user nonaktif              → cabut seluruh keluarga → 401
5. Tandai token lama dicabut (atomic)
   gagal karena sudah dicabut request lain           → 401
6. Terbitkan access token baru + refresh token baru (familyId SAMA) → set cookie → 204
```

Setiap kali refresh gagal, controller **menghapus kedua cookie** dari browser.

### Rotation

Setiap refresh token **hanya bisa dipakai sekali**. Setiap kali dipakai, token itu diganti dengan yang baru. Akibatnya, token yang dicuri hanya berguna sampai pemilik aslinya melakukan refresh berikutnya.

### Deteksi pencurian (reuse detection)

Misalkan penyerang menyalin refresh token korban:

```
Korban   : refresh dengan T1 → dapat T2   (T1 dicabut)
Penyerang: refresh dengan T1 (salinan)    → T1 sudah dicabut → PENCURIAN
           → semua token dengan familyId yang sama (termasuk T2 milik korban) dicabut
```

Penyerang dan korban sama-sama ter-logout. Korban tinggal login ulang, sedangkan penyerang kehilangan akses. Ini berlaku ke arah sebaliknya juga: kalau penyerang yang refresh duluan, korban yang memicu deteksi.

### Masa toleransi 10 detik (`REUSE_GRACE_MS`)

Tanpa toleransi, kasus normal berikut akan dianggap pencurian:

> Dua tab terbuka. Access token kedaluwarsa, dan kedua tab mengirim `/refresh` hampir bersamaan dengan cookie yang sama. Tab A menang dan mendapat T2. Tab B datang membawa T1 yang baru saja dicabut.

Kalau token **baru saja** dicabut (kurang dari 10 detik), request itu dianggap balapan biasa: dijawab 401 tanpa mencabut sesi. Browser sudah menyimpan cookie T2 dari tab A, jadi tab B cukup mengulang request aslinya. Lihat [17-integrasi-frontend.md](17-integrasi-frontend.md).

### Kenapa "tandai dicabut" harus atomic

`consumeRefreshToken` memakai `updateMany({ where: { id, revokedAt: null } })`, lalu memeriksa `count`. Kalau dua request membaca token yang sama di saat bersamaan, hanya **satu** yang berhasil mengubah `revokedAt` dari `null`. Request yang lain mendapat `count = 0` dan ditolak. Tanpa ini, satu refresh token bisa menghasilkan dua sesi.

## Logout

| Endpoint | Auth | Efek |
|---|---|---|
| `POST /auth/logout` | **Tidak perlu** | Mencabut keluarga token dari cookie `refresh_token` (hanya perangkat ini), lalu menghapus kedua cookie. Selalu 204, walaupun tidak ada sesi |
| `POST /auth/logout-all` | `requireAuth` | Mencabut **semua** refresh token milik user (semua perangkat), lalu menghapus cookie. 204 |

`/logout` sengaja tidak memakai `requireAuth`, supaya user tetap bisa logout walaupun access token-nya sudah kedaluwarsa.

Setelah logout, access token yang sudah beredar **tetap valid sampai maksimal 15 menit**. Itu konsekuensi JWT yang stateless. Cookie-nya sudah dihapus dari browser, jadi dalam praktiknya hanya salinan curian yang masih bisa dipakai, dan hanya selama sisa umurnya.

## Kapan sesi dicabut otomatis

| Kejadian | Yang dicabut |
|---|---|
| Logout | Keluarga token perangkat ini |
| Logout semua perangkat | Semua token user |
| Reuse refresh token terdeteksi | Keluarga token itu |
| Refresh dengan token kedaluwarsa | Keluarga token itu |
| Refresh saat user nonaktif | Keluarga token itu |
| Change password | Semua token user, lalu perangkat ini diberi sesi baru |
| Reset password | Semua token user |
| Admin menonaktifkan user | Semua token user |

## Change password

Lihat [06-lupa-reset-password.md](06-lupa-reset-password.md#change-password).

## Konstanta

| Konstanta | Nilai | Lokasi |
|---|---|---|
| `ACCESS_TTL_SECONDS` | `900` (15 menit) | `src/lib/token.ts` |
| `REFRESH_TTL_SECONDS` | `2592000` (30 hari) | `src/lib/token.ts` |
| `REUSE_GRACE_MS` | `10000` (10 detik) | `src/modules/auth/auth.service.ts` |
| `ACCESS_COOKIE` / `REFRESH_COOKIE` | `access_token` / `refresh_token` | `src/lib/token.ts` |
| Path cookie refresh | `/api/v1/auth` | `src/lib/token.ts` |

Kalau prefix API diubah (misalnya menjadi `/v2` atau dipasang di belakang `/backend`), **path cookie refresh harus ikut diubah**. Kalau tidak, browser tidak mengirim cookie itu ke endpoint refresh.

## Refresh token yang menumpuk

Baris lama di tabel `RefreshToken` (yang sudah dicabut atau kedaluwarsa) tidak dihapus otomatis. Untuk aplikasi yang sudah berjalan lama, tambahkan pembersihan berkala. Lihat [13-database.md](13-database.md#pembersihan-data).
