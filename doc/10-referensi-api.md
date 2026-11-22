# 10 · Referensi API

## Konvensi umum

| Hal | Nilai |
|---|---|
| Base URL | `http://localhost:4000/api/v1` (sesuaikan `PORT` dan domain) |
| Format body | JSON (`Content-Type: application/json`), maksimal 100 KB |
| Header wajib untuk method non-GET/HEAD/OPTIONS | `X-Requested-With: <nilai apa pun>`, misalnya `XMLHttpRequest`. Tanpa header ini → `403 csrf_blocked` |
| Autentikasi | Cookie `access_token` (otomatis dari browser), atau header `Authorization: Bearer <access_token>` |
| Cookie dari browser | Wajib `credentials: "include"` (fetch) / `withCredentials: true` (axios) |
| Respons sukses | `{ "success": true, "code"?, "message"?, "data"?, "meta"? }` |
| Respons error | `{ "error": { "code", "message", "fields"? } }` |

Kolom **Rate limit** di bawah: semua jendela 15 menit per IP. Endpoint yang memakai limiter yang sama **berbagi kuota**.

| Limiter | Batas | Dipakai oleh |
|---|---|---|
| `loginLimiter` | 10 | `/auth/login`, `/auth/google` |
| `emailLimiter` | 5 | `/auth/register`, `/auth/resend-verification`, `/auth/forgot-password` |
| `passwordResetLimiter` | 10 | `/auth/reset-password` |

Melebihi batas → `429 too_many_attempts`. Respons juga menyertakan header `RateLimit` dan `RateLimit-Policy` (standar *draft-7*).

## Ringkasan endpoint

| Method | Path | Auth | Rate limit | Sukses |
|---|---|---|---|---|
| GET | `/api/health` | – | – | 200 |
| POST | `/auth/register` | – | email | 202 |
| POST | `/auth/verify-email` | – | – | 200 |
| POST | `/auth/resend-verification` | – | email | 202 |
| POST | `/auth/login` | – | login | 200 |
| POST | `/auth/google` | – | login | 200 |
| POST | `/auth/refresh` | cookie refresh | – | 204 |
| POST | `/auth/logout` | cookie refresh (opsional) | – | 204 |
| POST | `/auth/logout-all` | login | – | 204 |
| GET | `/auth/me` | login | – | 200 |
| PATCH | `/auth/me` | login | – | 200 |
| POST | `/auth/change-password` | login | – | 200 |
| POST | `/auth/forgot-password` | – | email | 202 |
| POST | `/auth/reset-password` | – | reset | 200 |
| GET | `/admin/users` | SUPER_ADMIN | – | 200 |
| PATCH | `/admin/users/:id/status` | SUPER_ADMIN | – | 200 |

Selain error yang tercantum per endpoint, setiap endpoint di `/api/v1` bisa mengembalikan `403 csrf_blocked` (non-GET tanpa header), `400 invalid_request` (JSON rusak), `413 payload_too_large`, `429 too_many_attempts` (yang punya limiter), dan `500 internal_error`.

---

## Health

### `GET /api/health`

Di luar `/api/v1`, tidak butuh header CSRF. Menjalankan `SELECT 1` ke database.

| Status | Body |
|---|---|
| 200 | `{ "ok": true, "db": "up" }` |
| 500 | `{ "ok": false, "db": "down" }` |

Cocok untuk health check load balancer atau uptime monitor.

---

## Registrasi & verifikasi

### `POST /auth/register`

```json
{ "name": "Sari", "email": "sari@example.com", "password": "password-minimal-12" }
```

| Field | Aturan |
|---|---|
| `name` | string, di-trim, 1–100 |
| `email` | email valid, di-trim & dijadikan huruf kecil |
| `password` | 12 karakter s.d. 72 byte |

**202**, selalu sama apa pun kondisi email-nya:
```json
{ "success": true, "code": "registration_received", "message": "Please check your email to verify your account" }
```

| Error | Kode |
|---|---|
| 400 | `validation_failed` (`fields` berisi `password_too_short` / `password_too_long` / format email) |

Detail perilaku: [05-registrasi-verifikasi-email.md](05-registrasi-verifikasi-email.md).

### `POST /auth/verify-email`

```json
{ "token": "<nilai token dari link email>" }
```

**200**
```json
{ "success": true, "code": "email_verified", "message": "Email verified, please login" }
```

| Error | Kode |
|---|---|
| 400 | `validation_failed` (token kosong atau lebih dari 256 karakter) |
| 400 | `invalid_verification_token` (tidak ditemukan, sudah dipakai, kedaluwarsa, atau bukan token verifikasi) |

### `POST /auth/resend-verification`

```json
{ "email": "sari@example.com" }
```

**202**, selalu:
```json
{ "success": true, "code": "verification_sent", "message": "If the account needs verification, a new email has been sent" }
```

Email hanya terkirim jika akun ada, aktif, belum terverifikasi, dan kiriman terakhir lebih dari 60 detik yang lalu.

---

## Login & sesi

### `POST /auth/login`

```json
{ "email": "sari@example.com", "password": "password-minimal-12" }
```

**200**, plus cookie `access_token` dan `refresh_token`:
```json
{
  "success": true,
  "code": "login_success",
  "message": "Login Success",
  "data": { "id": "uuid", "email": "sari@example.com", "name": "Sari", "role": "USER" }
}
```

| Error | Kode | Penyebab |
|---|---|---|
| 400 | `validation_failed` | Format email salah atau password kosong |
| 401 | `invalid_credentials` | Email tidak terdaftar, password salah, akun nonaktif, atau akun tanpa password |
| 403 | `email_not_verified` | Password benar, tapi email belum diverifikasi |

### `POST /auth/google`

```json
{ "credential": "<ID token dari Google Identity Services>" }
```

**200**, plus cookie sesi:
```json
{ "success": true, "code": "login_success", "data": { "id": "uuid", "email": "g@gmail.com", "name": "G", "role": "USER" } }
```

| Error | Kode |
|---|---|
| 400 | `validation_failed` |
| 401 | `invalid_google_token` |
| 401 | `google_email_not_verified` |
| 403 | `account_disabled` |
| 409 | `google_account_conflict` |

Detail: [07-login-google.md](07-login-google.md).

### `POST /auth/refresh`

Tanpa body. Membutuhkan cookie `refresh_token` (path `/api/v1/auth`).

**204**, plus cookie baru (access dan refresh, *rotation*).

| Error | Kode | Catatan |
|---|---|---|
| 401 | `invalid_session` | Tidak ada cookie, token tidak dikenal/dicabut/kedaluwarsa, atau user nonaktif. **Kedua cookie dihapus** |

### `POST /auth/logout`

Tanpa body, tidak butuh access token. Mencabut sesi perangkat ini (berdasarkan cookie refresh) dan menghapus cookie.

**204**, selalu.

### `POST /auth/logout-all`

Butuh login. Mencabut semua sesi user di semua perangkat dan menghapus cookie.

**204**

| Error | Kode |
|---|---|
| 401 | `unauthenticated` |

---

## Profil & akun

### `GET /auth/me`

**200**
```json
{
  "success": true,
  "data": {
    "id": "uuid", "email": "sari@example.com", "name": "Sari", "avatarUrl": null,
    "role": "USER", "emailVerified": true, "hasPassword": true, "providers": [],
    "createdAt": "2026-11-22T09:00:00.000Z"
  }
}
```

| Error | Kode |
|---|---|
| 401 | `unauthenticated` |
| 404 | `user_not_found` (praktis tidak terjadi, karena `requireAuth` sudah memeriksa) |

### `PATCH /auth/me`

```json
{ "name": "Sari Baru", "avatarUrl": "https://example.com/foto.png" }
```

Minimal satu field. `avatarUrl: null` menghapus avatar.

**200**, berisi profil terbaru (bentuknya sama dengan `GET /me`).

| Error | Kode |
|---|---|
| 400 | `validation_failed` (avatar bukan `https`, nama kosong, atau body tanpa field valid → `fields: {}`) |
| 401 | `unauthenticated` |

### `POST /auth/change-password`

```json
{ "currentPassword": "password-lama-123", "newPassword": "password-baru-12345" }
```

**200**, plus cookie sesi **baru** (perangkat lain ter-logout):
```json
{ "success": true, "message": "Password Changed Successfully" }
```

| Error | Kode | Penyebab |
|---|---|---|
| 400 | `validation_failed` | `newPassword` tidak memenuhi aturan, atau sama dengan password lama (`fields.newPassword: ["password_same_as_current"]`) |
| 400 | `wrong_password` | Password lama salah, atau akun belum punya password (`fields.currentPassword`) |
| 401 | `unauthenticated` | |

### `POST /auth/forgot-password`

```json
{ "email": "sari@example.com" }
```

**202**, selalu:
```json
{ "success": true, "code": "reset_email_sent", "message": "If the email is registered, a password reset link has been sent" }
```

### `POST /auth/reset-password`

```json
{ "token": "<nilai token dari link email>", "newPassword": "password-baru-12345" }
```

**200**
```json
{ "success": true, "code": "password_reset", "message": "Password has been reset, please login" }
```

| Error | Kode |
|---|---|
| 400 | `validation_failed` |
| 400 | `invalid_reset_token` |

Efek samping: semua sesi dicabut, email terverifikasi, dan email notifikasi dikirim. Detail: [06-lupa-reset-password.md](06-lupa-reset-password.md).

---

## Admin (SUPER_ADMIN)

Semua endpoint di bawah ini: tanpa login → `401 unauthenticated`, role bukan `SUPER_ADMIN` → `403 forbidden`.

### `GET /admin/users?page=1&pageSize=20&search=budi`

**200**
```json
{
  "success": true,
  "data": [
    { "id": "uuid", "email": "budi@example.com", "name": "Budi", "avatarUrl": null,
      "role": "USER", "active": true, "emailVerifiedAt": "…", "createdAt": "…" }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

| Error | Kode |
|---|---|
| 400 | `validation_failed` (`page` < 1, `pageSize` > 100, dan sebagainya) |

### `PATCH /admin/users/:id/status`

```json
{ "active": false }
```

**200**, `data` = user terbaru (bentuknya sama dengan item di daftar).

| Error | Kode |
|---|---|
| 400 | `validation_failed` (`:id` bukan UUID, atau `active` bukan boolean) |
| 400 | `cannot_change_own_status` |
| 403 | `cannot_change_super_admin` |
| 404 | `user_not_found` |

Menonaktifkan user juga mencabut semua sesinya. Detail: [08-otorisasi-admin.md](08-otorisasi-admin.md).

---

## Contoh dengan curl

```bash
# Login (simpan cookie ke file)
curl -i -c cookies.txt -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" -H "X-Requested-With: XMLHttpRequest" \
  -d '{"email":"admin@example.com","password":"password-minimal-12"}'

# Profil (kirim cookie)
curl -b cookies.txt http://localhost:4000/api/v1/auth/me

# Refresh
curl -i -b cookies.txt -c cookies.txt -X POST http://localhost:4000/api/v1/auth/refresh \
  -H "X-Requested-With: XMLHttpRequest"

# Memakai Bearer token
curl http://localhost:4000/api/v1/auth/me -H "Authorization: Bearer <access_token>"
```
