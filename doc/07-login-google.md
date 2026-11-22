# 07 · Login Google

## Alur yang dipakai

Starter ini memakai alur **verifikasi ID token**:

```
Frontend: tombol "Sign in with Google" (Google Identity Services)
   └─ Google memberi `credential` (ID token, JWT bertanda tangan Google)
Frontend ─► POST /api/v1/auth/google { credential }
Backend:
   1. Verifikasi ID token ke Google (signature, audience, issuer, masa berlaku)
   2. Wajib: ada email DAN email_verified === true
   3. Cari/tautkan/buat user (lihat di bawah)
   4. User nonaktif → 403 account_disabled
   5. createSession() → set cookie → 200 (bentuk respons sama dengan /login)
```

Alasan memilih alur ini dibanding alur redirect (*authorization code*):

| | ID token (dipakai) | Redirect / authorization code |
|---|---|---|
| Endpoint backend | 1 | 2 (mulai + callback) |
| Proteksi CSRF tambahan (`state`, PKCE) | Tidak perlu | Perlu |
| Dipakai mobile app | Bisa langsung (kirim ID token yang sama) | Lebih repot |
| `GOOGLE_CLIENT_SECRET` | Tidak dipakai | Dipakai |

## Setup Google Cloud Console

1. Buka Google Cloud Console, pilih atau buat project.
2. **APIs & Services → OAuth consent screen**: isi nama aplikasi, email dukungan, dan domain. Untuk development, mode *Testing* sudah cukup (tambahkan akun tester).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID** dengan tipe **Web application**.
4. **Authorized JavaScript origins**: alamat frontend tempat tombol Google ditampilkan.
   ```
   http://localhost:3000
   http://localhost
   https://app.domainkamu.com
   ```
   - Hanya origin (skema + domain + port), **tanpa path dan tanpa `/` di akhir**.
   - Production wajib `https`. Hanya `localhost` yang boleh `http`.
   - Wildcard (`*.domain.com`) dan alamat IP tidak diizinkan.
   - `http://localhost` tanpa port kadang dibutuhkan Google Identity Services saat development.
5. **Authorized redirect URIs**: tidak diperlukan untuk alur ini. Isi hanya untuk testing lewat OAuth Playground (lihat di bawah).
6. Salin **Client ID** ke `GOOGLE_CLIENT_ID`. Simpan Client Secret di `GOOGLE_CLIENT_SECRET` kalau ingin testing lewat Playground. Backend tidak memakainya.

Perubahan di Google Console kadang baru berlaku setelah beberapa menit.

## Verifikasi ID token

`src/lib/google.ts` → `verifyGoogleIdToken(idToken)`:

- Memakai `OAuth2Client.verifyIdToken` dari `google-auth-library`. Fungsi ini memeriksa **signature** (public key Google, diunduh dan di-cache otomatis), **audience** (harus sama dengan `GOOGLE_CLIENT_ID`), **issuer** (Google), dan **masa berlaku**.
- Error apa pun dari verifikasi menghasilkan `401 invalid_google_token`.
- Payload tanpa `sub`, tanpa `email`, atau dengan `email_verified !== true` menghasilkan `401 google_email_not_verified`.
- Email dinormalisasi ke huruf kecil.
- Hasilnya `{ sub, email, name?, picture? }`.

**Data user hanya diambil dari token yang sudah diverifikasi.** Backend tidak pernah menerima `email` atau `name` dari body request, karena nilai itu bisa diisi sembarangan oleh siapa pun.

## Menentukan user

```
1. Cari OAuthAccount(GOOGLE, sub)
      ada → user itu (login biasa)
2. Tidak ada → cari User berdasarkan email
      ada → TAUTKAN akun Google ke user tersebut
3. Tidak ada → BUAT user baru
```

### Kenapa mencari berdasarkan `sub` dulu, baru email

`sub` adalah ID akun Google yang **tidak pernah berubah**. Email di akun Google bisa diganti, misalnya di Google Workspace. Dengan mencocokkan `sub` lebih dulu, user tetap dikenali walaupun email Google-nya sudah berubah. Akun di aplikasi ini juga tetap memakai email lama.

### User baru dari Google

- `email` diambil dari Google, `emailVerifiedAt` langsung diisi.
- `name` diambil dari Google. Kalau Google tidak mengirim nama, dipakai bagian sebelum `@` dari email.
- `avatarUrl` diambil dari `picture`.
- `passwordHash = null`. User ini hanya bisa login lewat Google, sampai ia membuat password lewat [lupa password](06-lupa-reset-password.md).
- `role = USER`.
- Satu baris `OAuthAccount` dibuat dalam query yang sama (nested create, sehingga atomic).

### Penautan akun

Saat email Google cocok dengan user yang sudah ada:

| Kondisi user | Yang terjadi |
|---|---|
| Email **sudah** terverifikasi | `OAuthAccount` ditambahkan. Password tetap ada, jadi user bisa login dengan keduanya |
| Email **belum** terverifikasi | `OAuthAccount` ditambahkan, **`passwordHash` dihapus**, `emailVerifiedAt` diisi, dan semua token verifikasi email lama dimatikan |

Penghapusan password pada baris kedua menangkal **pre-account takeover**. Password pada akun yang belum terverifikasi dibuat oleh seseorang yang belum terbukti memiliki email itu, dan bisa saja penyerang. Pemilik asli baru saja membuktikan kepemilikannya lewat Google, jadi password lama tidak bisa dipercaya. Kalau pemilik asli ingin memakai password, ia bisa membuatnya lewat lupa password.

Penautan otomatis berdasarkan email **hanya aman** karena langkah verifikasi mewajibkan `email_verified === true`. Tanpa syarat itu, seseorang bisa membuat akun Google dengan email orang lain yang belum diverifikasi Google, lalu mengambil alih akun.

Semua perubahan penautan berjalan dalam **satu query** `user.update` dengan nested write, sehingga otomatis satu transaksi.

### Konflik (409)

Constraint `@@unique([userId, provider])` membatasi satu user hanya punya satu akun Google. Kalau user sudah tertaut ke akun Google A, lalu seseorang login dengan akun Google B yang memakai email yang sama, penautan gagal dengan Prisma `P2002`. Service menangkapnya:

- Kalau `OAuthAccount` untuk `sub` itu ternyata ada (artinya dua request login pertama datang bersamaan, dan request lain sudah membuatnya), user dari akun itu yang dipakai.
- Kalau tidak ada → `409 google_account_conflict`.

## Testing tanpa frontend (Google OAuth Playground)

Postman tidak bisa menekan tombol Google, tapi ID token asli bisa didapat lewat OAuth Playground:

1. Di Google Cloud Console, tambahkan `https://developers.google.com/oauthplayground` ke **Authorized redirect URIs** OAuth Client.
2. Buka https://developers.google.com/oauthplayground.
3. Klik ikon ⚙️, centang **Use your own OAuth credentials**, lalu isi Client ID dan Client Secret.
4. Step 1: ketik `openid email profile`, klik **Authorize APIs**, lalu login Google.
5. Step 2: klik **Exchange authorization code for tokens**.
6. Salin nilai `id_token` (diawali `eyJ...`) ke variable Postman `googleIdToken`, lalu jalankan request **Login Google**.

ID token hanya berlaku **1 jam**. Script pre-request di Postman menampilkan email dan sisa masa berlaku token di Postman Console.

Kalau muncul error terkait audience, berarti `GOOGLE_CLIENT_ID` di `.env` berbeda dengan Client ID yang dipakai di Playground.

## Integrasi frontend

Lihat [17-integrasi-frontend.md](17-integrasi-frontend.md#login-google).

## Rate limit

`/auth/google` memakai `loginLimiter` (10 per 15 menit per IP), yang kuotanya dipakai bersama dengan `/auth/login`.

## Kode error

| Status | Kode | Penyebab |
|---|---|---|
| 400 | `validation_failed` | `credential` kosong atau lebih dari 4096 karakter |
| 401 | `invalid_google_token` | Token palsu, rusak, kedaluwarsa, atau audience salah |
| 401 | `google_email_not_verified` | Akun Google tanpa email terverifikasi |
| 403 | `account_disabled` | User dinonaktifkan admin |
| 409 | `google_account_conflict` | Email sudah tertaut ke akun Google lain |
