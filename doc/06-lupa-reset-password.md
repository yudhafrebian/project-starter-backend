# 06 · Lupa, Reset & Change Password

## Lupa password

`POST /auth/forgot-password { email }`, **selalu 202** (`reset_email_sent`).

```
user tidak ada ATAU nonaktif            → diam (tetap 202)
token reset terakhir < 60 detik lalu    → diam (cooldown)
selain itu:
   matikan token reset lama
   buat token reset baru (berlaku 60 menit)
   kirim email "Atur ulang password" → WEB_ORIGIN/reset-password?token=xxx
```

- Respons yang selalu sama mencegah *user enumeration*, sama seperti register.
- **User yang belum terverifikasi tetap boleh** meminta reset. Mengklik link di inbox membuktikan kepemilikan email (lihat di bawah).
- **User Google-only** (tanpa password) juga boleh. Inilah cara mereka **membuat password**, tanpa perlu endpoint terpisah.
- Rate limit: `emailLimiter`, berbagi kuota 5 per 15 menit dengan register dan resend.

## Reset password

`POST /auth/reset-password { token, newPassword }`

```
token tidak ditemukan / tipe bukan PASSWORD_RESET / sudah dipakai / kedaluwarsa
   → 400 invalid_reset_token

valid → SATU transaksi (resetPasswordWithToken):
   1. tandai token terpakai (atomic; kalau sudah dipakai request lain → 400)
   2. ganti passwordHash
   3. isi emailVerifiedAt kalau masih kosong
   4. matikan semua token reset lain milik user
   5. cabut SEMUA refresh token (semua perangkat ter-logout)
→ kirim email "Password kamu telah diganti"
→ 200 { code: "password_reset" }
```

Karena semua langkah ada dalam satu transaksi, kegagalan di tengah jalan (misalnya database putus) membatalkan semuanya. Tidak akan ada kondisi "password sudah berganti tapi sesi lama masih hidup".

### Keputusan desain

| Keputusan | Alasan |
|---|---|
| Token berlaku **60 menit** (verifikasi email 24 jam) | Link reset bisa mengambil alih akun kalau bocor, jadi umurnya dibuat pendek |
| Pengecekan `type === PASSWORD_RESET` | Tanpa ini, token verifikasi email (berlaku 24 jam) bisa dipakai untuk mereset password |
| Reset juga **memverifikasi email** | Mengklik link di inbox adalah bukti kepemilikan email. Ini juga menimpa password buatan penyerang pada skenario *pre-account takeover* |
| **Semua sesi dicabut** | Kalau akun pernah dibobol, pelakunya langsung ter-logout |
| **Tidak auto-login** setelah reset | Lebih sederhana dan aman. User login ulang dengan password baru |
| **Email notifikasi** setelah berhasil | Kalau yang mereset bukan pemilik akun, pemilik asli langsung tahu dan bisa bertindak |

### Token reset

| Properti | Nilai |
|---|---|
| Bentuk | 32 byte acak, `base64url` |
| Disimpan | Hash SHA-256, `VerificationToken.type = PASSWORD_RESET` |
| Umur | **60 menit** (`RESET_PASSWORD_TTL_MINUTES`) |
| Sekali pakai | Ya |
| Rate limit endpoint reset | `passwordResetLimiter`: 10 per 15 menit per IP. Token mustahil ditebak, tapi setiap request menjalankan bcrypt yang berat, jadi tetap dibatasi supaya tidak bisa dipakai untuk membebani server |

## Change password

`POST /auth/change-password { currentPassword, newPassword }`, butuh login.

```
user tidak punya password (Google-only) ATAU currentPassword salah
   → 400 wrong_password, fields.currentPassword = ["Current password is wrong"]
newPassword sama dengan currentPassword
   → 400 validation_failed, fields.newPassword = ["password_same_as_current"]

berhasil:
   ganti passwordHash
   cabut SEMUA refresh token (perangkat lain ter-logout)
   buat sesi BARU untuk perangkat ini → set cookie
   → 200 { message: "Password Changed Successfully" }
```

- Perangkat yang dipakai untuk mengganti password **tetap login**, karena langsung diberi sesi baru.
- User Google-only yang belum punya password harus memakai **lupa password** untuk membuat password pertamanya.
- Saat ini, change password **tidak** mengirim email notifikasi (berbeda dengan reset). Menambahkannya cukup dengan memanggil `trySendMail(passwordChangedEmail(...))` di akhir `changePassword`. Teks email "semua perangkat telah dikeluarkan" tetap akurat untuk kasus ini.

## Aturan password baru

Berlaku untuk register, reset, dan change password (`newPasswordSchema`):

- Minimal **12 karakter** (pesan `password_too_short`).
- Maksimal **72 byte UTF-8** (pesan `password_too_long`). Untuk huruf Latin biasa, 1 karakter = 1 byte. Huruf beraksen dan emoji memakai 2–4 byte. Alasannya ada di [14-keamanan.md](14-keamanan.md#batas-72-byte-bcrypt).

Field `password` saat login hanya dibatasi 1–256 karakter. Pembatasan 72 byte tidak diperlukan di sana, karena password yang tersimpan sudah pasti ≤72 byte.

## Email

| Kejadian | Template | Subjek |
|---|---|---|
| Lupa password | `reset-password` | `Atur ulang password - {APP_NAME}` |
| Reset berhasil | `password-changed` | `Password kamu telah diganti - {APP_NAME}` |

Email `password-changed` berisi tombol menuju `WEB_ORIGIN/forgot-password`, supaya pemilik akun bisa segera mengamankan akunnya kalau reset itu bukan dilakukan olehnya.
