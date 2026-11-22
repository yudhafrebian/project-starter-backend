# 05 · Registrasi & Verifikasi Email

## Aturan utama

1. **Email wajib diverifikasi** sebelum bisa login dengan password.
2. **Respons register selalu sama**, apa pun kondisi email-nya (anti *user enumeration*).
3. **Pendaftar terakhir yang menentukan password** untuk akun yang belum terverifikasi (anti *pre-account takeover*).
4. Link verifikasi mengarah ke **frontend** (`WEB_ORIGIN/verify-email?token=...`). Frontend lalu memanggil API.

## Alur

```
POST /auth/register { name, email, password }
   │
   ├─ hash password (SELALU di awal, apa pun cabangnya)
   │
   ├─ email belum terdaftar
   │     → buat user (emailVerifiedAt = null, role = USER)
   │     → buat token verifikasi, kirim email "Verifikasi email kamu"
   │
   ├─ email terdaftar, BELUM terverifikasi
   │     → TIMPA name + passwordHash dengan data pendaftar terbaru
   │     → matikan token verifikasi lama, kirim token baru
   │
   └─ email terdaftar, SUDAH terverifikasi
         → tidak mengubah apa pun
         → kirim email "Percobaan pendaftaran" ke pemilik akun
   │
   └─► SELALU: 202 { code: "registration_received" }

Email ─► WEB_ORIGIN/verify-email?token=xxx
Frontend ─► POST /auth/verify-email { token }
   ├─ valid       → emailVerifiedAt diisi, token lain dimatikan → 200 email_verified
   └─ tidak valid → 400 invalid_verification_token
```

## Kenapa respons selalu sama

Kalau register menjawab "email sudah terdaftar", siapa pun bisa mengecek apakah email tertentu punya akun di aplikasi ini. Untuk aplikasi yang sensitif, informasi itu sendiri sudah merupakan kebocoran. Dengan respons yang selalu `202` dan isi yang identik, informasi tersebut **hanya sampai ke inbox pemilik email**, misalnya lewat email "Percobaan pendaftaran".

Password **selalu di-hash di awal**, juga untuk cabang yang tidak memakainya. Tujuannya supaya waktu respons ketiga cabang kurang lebih sama, sehingga kondisi email tidak bisa ditebak dari kecepatan respons.

## Kenapa password ditimpa (pre-account takeover)

Skenario serangan tanpa aturan ini:

1. Penyerang mendaftar lebih dulu memakai email korban dengan password miliknya. Email belum terverifikasi.
2. Korban mendaftar memakai email yang sama. Kalau sistem tidak mengubah apa pun, korban akan mengklik link verifikasi untuk akun yang memakai **password buatan penyerang**.
3. Akun menjadi terverifikasi, dan penyerang bisa login.

Dengan aturan "pendaftar terakhir menentukan password", password yang aktif selalu milik pendaftar terbaru. Semua link verifikasi lama juga dimatikan (`issueVerificationToken` selalu memanggil `invalidateVerificationTokens` sebelum membuat token baru), sehingga link milik penyerang tidak berlaku lagi.

Celah yang sama juga ditutup di [login Google](07-login-google.md#penautan-akun) dan [reset password](06-lupa-reset-password.md).

## Token verifikasi

| Properti | Nilai |
|---|---|
| Bentuk | 32 byte acak, `base64url` (`generateRandomToken`) |
| Disimpan | Hash SHA-256 di tabel `VerificationToken`, `type = EMAIL_VERIFICATION` |
| Umur | **24 jam** (`VERIFY_EMAIL_TTL_HOURS`). Angka yang sama tertulis di isi email |
| Sekali pakai | Ya. `usedAt` diisi saat dipakai |
| Token lama | Dimatikan setiap kali token baru dibuat |

Verifikasi berjalan dalam **satu transaksi** (`markEmailVerified`):

1. Tandai token terpakai secara atomic (`updateMany` dengan `usedAt: null`, lalu cek `count`). Kalau `count = 0`, berarti sudah dipakai request lain, dan request ditolak.
2. Isi `user.emailVerifiedAt`.
3. Matikan semua token verifikasi lain milik user itu.

Token ditolak kalau tidak ditemukan, **tipenya bukan `EMAIL_VERIFICATION`**, sudah dipakai, atau kedaluwarsa. Pengecekan tipe mencegah token reset password dipakai untuk verifikasi, dan sebaliknya.

`/verify-email` **tidak** diberi rate limit. Endpoint ini tidak mengirim email, dan token 256 bit mustahil ditebak dengan brute force.

## Kirim ulang verifikasi

`POST /auth/resend-verification { email }`, **selalu 202** (`verification_sent`).

Email baru hanya terkirim kalau **semua** syarat ini terpenuhi:

- user dengan email itu ada,
- belum terverifikasi,
- aktif,
- token verifikasi terakhirnya dibuat **lebih dari 60 detik** yang lalu (`RESEND_COOLDOWN_MS`).

Kalau salah satu tidak terpenuhi, endpoint tetap menjawab 202 tanpa melakukan apa pun, supaya status akun tidak bocor. Cooldown mencegah inbox user dibanjiri email.

## Rate limit

`/register`, `/resend-verification`, dan `/forgot-password` memakai **satu** instance `emailLimiter`: **5 request per 15 menit per IP, dihitung gabungan dari ketiganya**. Ini disengaja untuk mencegah aplikasi dipakai sebagai alat spam email.

## Validasi input

| Field | Aturan |
|---|---|
| `name` | String, di-trim, 1–100 karakter |
| `email` | Di-trim, diubah ke huruf kecil, format email valid |
| `password` | Minimal 12 karakter, **maksimal 72 byte** (lihat [14-keamanan.md](14-keamanan.md#batas-72-byte-bcrypt)) |

Field lain di body (misalnya `role`) **dibuang** oleh Zod, jadi tidak mungkin mendaftar sebagai admin.

## Email yang dikirim

| Kondisi | Template | Subjek |
|---|---|---|
| Daftar baru atau daftar ulang (belum terverifikasi) | `verify-email` | `Verifikasi email kamu - {APP_NAME}` |
| Email sudah terverifikasi | `account-exists` | `Percobaan pendaftaran - {APP_NAME}` |

Kegagalan mengirim email **tidak** menggagalkan request. Kegagalan itu dicatat di log (`failed to send email`), dan user bisa memakai fitur kirim ulang. Lihat [12-email.md](12-email.md).

## Race condition

Kalau dua request register dengan email yang sama datang bersamaan, keduanya bisa melihat "email belum ada", lalu keduanya mencoba `create`. Request kedua gagal dengan Prisma `P2002` (unique constraint). Service menangkap error itu dan **diam saja**, jadi respons tetap 202.

## Login sebelum verifikasi

Login dengan password yang benar untuk akun yang belum terverifikasi menghasilkan `403 email_not_verified`. Frontend sebaiknya menampilkan tombol "Kirim ulang email verifikasi" yang memanggil `/resend-verification`.

## Cara lain email menjadi terverifikasi

- **Login Google:** akun Google yang `email_verified = true` langsung menandai email terverifikasi.
- **Reset password:** mengklik link reset di inbox juga membuktikan kepemilikan email.
- **Seed:** super admin dibuat langsung dalam keadaan terverifikasi.
