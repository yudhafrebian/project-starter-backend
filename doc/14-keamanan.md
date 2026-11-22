# 14 · Keamanan

Dokumen ini merangkum ancaman yang diperhitungkan dan cara starter ini menanganinya. Setiap perlindungan juga diuji oleh test otomatis (lihat [15-testing.md](15-testing.md)).

## Ringkasan

| Ancaman | Perlindungan |
|---|---|
| Pencurian token lewat XSS | Token di cookie `httpOnly`, tidak bisa dibaca JavaScript |
| CSRF | Header `X-Requested-With` wajib + CORS satu origin + `sameSite=lax` |
| Token bocor | Access token 15 menit; refresh token dirotasi, disimpan sebagai hash, bisa dicabut |
| Refresh token dicuri | Deteksi reuse: seluruh sesi dicabut |
| Database bocor | Password memakai bcrypt; refresh dan verification token hanya hash SHA-256 |
| Brute force password | Rate limit per IP + bcrypt cost 12 |
| User enumeration | Pesan dan respons yang seragam + dummy hash |
| Pre-account takeover | Password ditimpa / dihapus saat kepemilikan email dibuktikan |
| Kenaikan hak akses | Field `role` dibuang dari input; role dibaca dari DB setiap request |
| Kebocoran data sensitif | `select` eksplisit; `passwordHash` tidak pernah keluar |
| XSS di email | Handlebars meng-escape semua variabel |
| URL berbahaya | `avatarUrl` wajib `https` |
| Spam email lewat aplikasi | Rate limit gabungan + cooldown per user |
| Header HTTP tidak aman | `helmet` |

## Cookie

| Flag | Nilai | Fungsi |
|---|---|---|
| `httpOnly` | `true` | JavaScript tidak bisa membaca token, sehingga XSS tidak bisa mencurinya |
| `secure` | `true` di production | Hanya dikirim lewat HTTPS |
| `sameSite` | `lax` | Tidak dikirim pada request lintas-situs, kecuali navigasi GET tingkat atas |
| `path` (refresh) | `/api/v1/auth` | Refresh token hanya dikirim ke endpoint auth, sehingga lebih jarang terekspos |

## CSRF

Serangan CSRF memanfaatkan browser korban yang otomatis mengirim cookie ke API. Starter ini memakai tiga lapis pertahanan:

1. **Header `X-Requested-With` wajib** untuk semua request non-GET di `/api/v1` (`requireCsrfHeader`). Form HTML biasa di situs penyerang tidak bisa menambahkan header custom. Request `fetch` lintas-origin dengan header custom memicu *CORS preflight*, dan preflight itu ditolak karena origin penyerang bukan `WEB_ORIGIN`.
2. **CORS hanya untuk `WEB_ORIGIN`**, dengan `credentials: true`.
3. **`sameSite=lax`**, sehingga cookie tidak ikut dikirim pada sebagian besar request lintas-situs.

Endpoint GET tidak dicek, jadi **endpoint GET tidak boleh mengubah data**. Patuhi aturan ini saat menambah endpoint.

## Password

### Hashing

- `bcryptjs` dengan **cost 12** (sekitar 250 ms per hash). Saat `NODE_ENV=test`, cost diturunkan menjadi 4 supaya test cepat. Pengecekan ini membaca `process.env.NODE_ENV` langsung, supaya `hash-password.ts` tidak bergantung pada validasi env.
- `bcryptjs` (JavaScript murni) dipilih dibanding `bcrypt` (native) karena **selalu berhasil diinstall** di mana pun (Windows, Docker Alpine, serverless). Format hash keduanya identik (`$2b$...`), sehingga bisa pindah ke `bcrypt` native kapan saja tanpa migrasi data, kalau beban login sudah sangat tinggi.
- Rekomendasi OWASP terbaru adalah Argon2id, lalu scrypt, lalu bcrypt. bcrypt masih dianggap aman.

### Batas 72 byte bcrypt

bcrypt **hanya memproses 72 byte pertama** password, dan sisanya diabaikan diam-diam. Tanpa pembatasan, dua password panjang yang 72 byte pertamanya sama akan dianggap identik. Karena itu `newPasswordSchema` menolak password lebih dari 72 byte (`password_too_long`). Perhitungannya **per byte UTF-8**, bukan per karakter: huruf beraksen memakai 2 byte, dan emoji sampai 4 byte.

### Aturan

Minimal 12 karakter. Tidak ada aturan "wajib huruf besar/angka/simbol". Panjang jauh lebih berpengaruh terhadap kekuatan password dibanding komposisi karakter, dan aturan komposisi cenderung mendorong pola yang mudah ditebak.

## User enumeration

Penyerang tidak boleh bisa mengetahui email mana yang terdaftar:

| Endpoint | Cara |
|---|---|
| `/login` | Pesan `invalid_credentials` yang sama untuk semua kegagalan. bcrypt selalu dijalankan (dummy hash) supaya waktu respons serupa. `email_not_verified` hanya muncul setelah password terbukti benar |
| `/register` | Selalu `202` dengan body identik. Password selalu di-hash di awal. Informasi "email sudah terdaftar" dikirim ke **inbox** pemilik |
| `/resend-verification` | Selalu `202` |
| `/forgot-password` | Selalu `202` |

Sisa risiko yang diterima: pada `/resend-verification` dan `/forgot-password`, request untuk email yang terdaftar melakukan lebih banyak pekerjaan (membuat token, mengirim email), sehingga sedikit lebih lambat. Rate limit membatasi seberapa jauh celah ini bisa dimanfaatkan.

## Pre-account takeover

**Skenario:** penyerang mendaftar lebih dulu memakai email korban. Nanti, ketika korban membuktikan kepemilikan email (verifikasi, login Google, reset password), akun menjadi "milik korban" padahal password buatan penyerang masih berlaku.

**Penangkal di tiga titik:**

| Titik | Tindakan |
|---|---|
| Register ulang (email belum terverifikasi) | Password dan nama **ditimpa** dengan milik pendaftar terbaru; semua link verifikasi lama dimatikan |
| Login Google ke akun belum terverifikasi | `passwordHash` **dihapus**; email ditandai terverifikasi; link verifikasi lama dimatikan |
| Reset password | Password baru menggantikan yang lama; email ditandai terverifikasi |

Tambahan: penautan Google berdasarkan email **hanya** terjadi kalau Google menyatakan `email_verified === true`.

## Token

| Token | Panjang | Disimpan | Sekali pakai | Umur |
|---|---|---|---|---|
| Access (JWT) | | Tidak | Tidak | 15 menit |
| Refresh | 256 bit | SHA-256 | Ya (rotation) | 30 hari |
| Verifikasi email | 256 bit | SHA-256 | Ya | 24 jam |
| Reset password | 256 bit | SHA-256 | Ya | 60 menit |

- Semua token acak dibuat dengan `crypto.randomBytes(32)`, generator acak kriptografis.
- JWT diverifikasi dengan `algorithms: ["HS256"]`, sehingga token dengan `alg: none` atau algoritma lain tertolak.
- Token verifikasi dan reset **dicek tipenya**, sehingga token satu jenis tidak bisa dipakai untuk keperluan jenis lain.
- Pemakaian token selalu **atomic** (`updateMany ... where usedAt/revokedAt = null`, lalu cek `count`). Dua request bersamaan tidak bisa memakai token yang sama dua kali.

## Rate limiting

| Limiter | Batas / 15 menit / IP | Endpoint |
|---|---|---|
| `loginLimiter` | 10 | login, google |
| `emailLimiter` | 5 (gabungan) | register, resend-verification, forgot-password |
| `passwordResetLimiter` | 10 | reset-password |

Keterbatasan yang perlu diketahui:

- **Disimpan di memori proses.** Hitungan hilang saat server restart, dan **tidak dibagi** antar instance. Di serverless atau saat memakai beberapa instance, batas efektifnya bisa lebih longgar. Untuk production berskala besar, pakai store bersama (misalnya Redis lewat `rate-limit-redis`).
- **Berbasis IP**, jadi `TRUST_PROXY` harus benar (lihat [02-konfigurasi.md](02-konfigurasi.md#trust_proxy)).
- Dimatikan saat `NODE_ENV=test`.

## Kebocoran data

- Respons `500` hanya berisi `internal_error`. Stack trace dan detail error hanya dicatat di log.
- Logger me-*redact* header `authorization` dan `cookie`.
- Modul admin memakai `publicUserSelect` (*allowlist* kolom).
- `/me` hanya mengirim boolean `hasPassword`, bukan hash-nya.
- Token Google (access/refresh) tidak disimpan sama sekali.

## Input

- Semua body divalidasi Zod. Field yang tidak dikenal **dibuang**.
- Ukuran body maksimal 100 KB.
- Param `:id` divalidasi sebagai UUID, sehingga input aneh tidak sampai ke database dan menyebabkan 500.
- `avatarUrl` dibatasi ke skema `https`.

## Header HTTP

`helmet()` mengatur header seperti `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, dan menghapus `X-Powered-By`.

## Hal yang menjadi tanggung jawab frontend

- Halaman `/verify-email` dan `/reset-password` menerima token di URL. Setelah dipakai, hapus token dari URL (`history.replaceState`), dan pasang `<meta name="referrer" content="no-referrer">` supaya token tidak bocor lewat header `Referer`.
- Jangan menampilkan `message` dari API apa adanya. Petakan dari `code`.
- Lihat [17-integrasi-frontend.md](17-integrasi-frontend.md).

## Checklist keamanan sebelum production

- [ ] `NODE_ENV=production` (mengaktifkan cookie `secure`)
- [ ] HTTPS di frontend dan backend
- [ ] `JWT_SECRET` acak, panjang, dan unik per project/lingkungan
- [ ] `TRUST_PROXY` sesuai infrastruktur
- [ ] `WEB_ORIGIN` = domain frontend production
- [ ] Password `SEED_SUPERADMIN_PASSWORD` kuat; ganti password admin setelah login pertama
- [ ] SPF/DKIM/DMARC lulus untuk domain email
- [ ] Click tracking penyedia email dimatikan
- [ ] Pertimbangkan rate limit dengan store bersama (Redis)
- [ ] Jadwalkan pembersihan token lama ([13-database.md](13-database.md#pembersihan-data))
