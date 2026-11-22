# Dokumentasi Starter Backend

Dokumentasi lengkap untuk backend starter autentikasi ini: cara memakai, cara kerja di balik layar, alasan setiap keputusan desain, dan cara mengembangkannya untuk project baru.

## Untuk siapa

- **Kamu di masa depan**, saat memulai project baru dari starter ini dan lupa detailnya.
- **Developer lain** yang bergabung ke project turunan starter ini.
- **Developer frontend** yang perlu tahu cara memanggil API auth dengan benar.

## Daftar isi

### Memulai
| # | Dokumen | Isi |
|---|---|---|
| 01 | [Memulai](01-memulai.md) | Persyaratan, instalasi, menjalankan pertama kali, checklist project baru |
| 02 | [Konfigurasi](02-konfigurasi.md) | Semua environment variable, file konfigurasi (`tsconfig`, `vercel.json`, Docker, Prisma) |
| 03 | [Arsitektur](03-arsitektur.md) | Struktur folder, lapisan kode, alur request, middleware, format respons |

### Fitur
| # | Dokumen | Isi |
|---|---|---|
| 04 | [Autentikasi & Sesi](04-autentikasi-sesi.md) | Login, access token, refresh token, rotation, deteksi pencurian, logout |
| 05 | [Registrasi & Verifikasi Email](05-registrasi-verifikasi-email.md) | Register, verifikasi, kirim ulang, anti user enumeration |
| 06 | [Lupa & Reset Password](06-lupa-reset-password.md) | Forgot password, reset password, change password |
| 07 | [Login Google](07-login-google.md) | Setup Google Cloud, alur verifikasi, penautan akun, testing tanpa frontend |
| 08 | [Otorisasi & Admin](08-otorisasi-admin.md) | Role, `requireRole`, modul admin |
| 09 | [Profil](09-profil.md) | `GET /me` dan `PATCH /me` |

### Referensi
| # | Dokumen | Isi |
|---|---|---|
| 10 | [Referensi API](10-referensi-api.md) | Setiap endpoint: request, respons, error, rate limit |
| 11 | [Kode Error](11-kode-error.md) | Daftar lengkap kode error dan artinya |
| 12 | [Email](12-email.md) | Mailer SMTP, setup Brevo, template Handlebars, deliverability |
| 13 | [Database](13-database.md) | Skema, relasi, migrasi, seed, Prisma 7 |
| 14 | [Keamanan](14-keamanan.md) | Model ancaman dan perlindungan yang diterapkan |

### Operasional
| # | Dokumen | Isi |
|---|---|---|
| 15 | [Testing](15-testing.md) | Test otomatis (Jest + Supertest), Postman |
| 16 | [Deployment](16-deployment.md) | Build, production, Vercel, checklist go-live, CI GitHub Actions |
| 17 | [Integrasi Frontend](17-integrasi-frontend.md) | Cara frontend memanggil API, refresh otomatis, halaman verifikasi/reset |
| 18 | [Mengembangkan](18-mengembangkan.md) | Menambah module, template email, role, provider OAuth, fitur opsional |
| 19 | [Troubleshooting](19-troubleshooting.md) | Masalah yang pernah terjadi dan solusinya |
| 20 | [Catatan Kode](20-catatan-kode.md) | Penjelasan per file: keputusan penting yang dulu ditulis sebagai komentar |

## Ringkasan cepat

- **Stack:** Node.js, Express 5, TypeScript, Prisma 7 (driver adapter `pg`), PostgreSQL, Zod 4, Nodemailer + Handlebars, Jest + Supertest.
- **Base URL API:** `/api/v1`. Health check di `/api/health`.
- **Sesi:** cookie `httpOnly`. `access_token` (JWT, 15 menit) + `refresh_token` (acak, 30 hari, disimpan sebagai hash).
- **Wajib di setiap request non-GET:** header `X-Requested-With` (proteksi CSRF).
- **Format error:** `{ "error": { "code", "message", "fields"? } }`.
- **Format sukses:** `{ "success": true, "code"?, "message"?, "data"?, "meta"? }`.
