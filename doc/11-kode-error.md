# 11 · Kode Error

Semua error berbentuk:

```json
{ "error": { "code": "kode_mesin", "message": "Pesan untuk developer", "fields": { } } }
```

**Frontend sebaiknya memakai `code`**, bukan `message`, untuk menentukan tampilan dan teks ke user. `message` berbahasa Inggris, ditujukan untuk developer, dan bisa berubah.

## Umum

| Status | Kode | Arti | Sumber |
|---|---|---|---|
| 400 | `validation_failed` | Input tidak valid. Detail per field ada di `fields` | `validateBody`, `parseOrThrow`, `ZodError` |
| 400 | `invalid_request` | Body bukan JSON yang valid | body-parser |
| 403 | `csrf_blocked` | Request non-GET tanpa header `X-Requested-With` | `requireCsrfHeader` |
| 404 | `not_found` | Route tidak ada, atau record tidak ditemukan (Prisma `P2025`) | handler 404, `errorHandler` |
| 409 | `conflict` | Bentrok unique constraint (`P2002`, `fields` berisi kolomnya) atau foreign key (`P2003`) | `errorHandler` |
| 413 | `payload_too_large` | Body lebih dari 100 KB | body-parser |
| 4xx | `client_error` | Error 4xx lain dari library | `errorHandler` |
| 429 | `too_many_attempts` | Melebihi rate limit | `rateLimit.ts` |
| 500 | `internal_error` | Error tak terduga. Detailnya **hanya** di log server | `errorHandler` |

## Autentikasi & sesi

| Status | Kode | Arti | Saran tindakan frontend |
|---|---|---|---|
| 401 | `unauthenticated` | Belum login, access token tidak valid/kedaluwarsa, atau akun nonaktif | Coba `/auth/refresh` sekali. Kalau gagal, arahkan ke login |
| 401 | `invalid_credentials` | Email/password salah (pesan sengaja disamakan untuk semua penyebab) | "Email atau password salah" |
| 401 | `invalid_session` | Refresh token tidak valid, dicabut, atau kedaluwarsa | Arahkan ke login |
| 403 | `email_not_verified` | Password benar, tapi email belum diverifikasi | Tampilkan tombol "Kirim ulang email verifikasi" |
| 403 | `account_disabled` | Akun dinonaktifkan (login Google) | "Akun dinonaktifkan, hubungi admin" |

## Registrasi & verifikasi

| Status | Kode | Arti |
|---|---|---|
| 400 | `invalid_verification_token` | Link verifikasi tidak valid, sudah dipakai, atau kedaluwarsa. Tawarkan kirim ulang dan link ke login |

## Password

| Status | Kode | Arti |
|---|---|---|
| 400 | `wrong_password` | Password saat ini salah (change password). `fields.currentPassword` terisi |
| 400 | `invalid_reset_token` | Link reset tidak valid, sudah dipakai, atau kedaluwarsa. Tawarkan minta link baru |

### Pesan di dalam `fields` (validasi password)

| Pesan | Arti |
|---|---|
| `password_too_short` | Kurang dari 12 karakter |
| `password_too_long` | Lebih dari 72 byte |
| `password_same_as_current` | Password baru sama dengan yang lama (`fields.newPassword`) |

## Login Google

| Status | Kode | Arti |
|---|---|---|
| 401 | `invalid_google_token` | ID token palsu, rusak, kedaluwarsa, atau untuk Client ID lain |
| 401 | `google_email_not_verified` | Akun Google tidak memiliki email terverifikasi |
| 409 | `google_account_conflict` | Email sudah tertaut ke akun Google yang berbeda |

## Otorisasi & admin

| Status | Kode | Arti |
|---|---|---|
| 403 | `forbidden` | Sudah login, tapi role tidak cukup |
| 400 | `cannot_change_own_status` | Admin mencoba mengubah status dirinya sendiri |
| 403 | `cannot_change_super_admin` | Mencoba mengubah status `SUPER_ADMIN` lain |
| 404 | `user_not_found` | User tidak ditemukan |

## Kode sukses

Respons sukses juga membawa `code` di level atas:

| Kode | Endpoint |
|---|---|
| `registration_received` | `POST /auth/register` |
| `email_verified` | `POST /auth/verify-email` |
| `verification_sent` | `POST /auth/resend-verification` |
| `login_success` | `POST /auth/login`, `POST /auth/google` |
| `reset_email_sent` | `POST /auth/forgot-password` |
| `password_reset` | `POST /auth/reset-password` |

`change-password`, `me`, dan endpoint admin tidak mengirim `code`, hanya `success` (plus `message`/`data`).

## Menambah kode error baru

Lempar `HttpError` dari service:

```ts
throw new HttpError(409, "slug_taken", { slug: ["already_used"] }, "Slug is already used");
```

Gunakan `snake_case` yang deskriptif, lalu catat kode baru itu di dokumen ini.
