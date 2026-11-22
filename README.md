# Starter Backend

Backend starter dengan autentikasi lengkap dan siap produksi: **Express 5, TypeScript, Prisma 7, PostgreSQL**. Dipakai sebagai titik awal setiap project baru yang membutuhkan auth.

📚 **Dokumentasi lengkap ada di folder [`doc/`](doc/README.md).**

## Fitur

**Autentikasi**
- Register dengan **verifikasi email** wajib sebelum login
- Login email + password, dan **login Google** (verifikasi ID token)
- **Access token** JWT 15 menit + **refresh token** 30 hari di cookie `httpOnly`
- **Rotation** refresh token dan **deteksi pencurian** (reuse detection)
- Logout, logout semua perangkat
- Lupa password / reset password (mencabut semua sesi + email notifikasi)
- Change password (perangkat lain ter-logout)

**Akun & otorisasi**
- Profil: `GET /me`, `PATCH /me` (nama, avatar)
- Role (`SUPER_ADMIN`, `USER`) + middleware `requireRole`
- Modul admin: daftar user (pagination, pencarian), aktifkan/nonaktifkan user

**Keamanan**
- Proteksi CSRF (header wajib + CORS satu origin + `sameSite=lax`)
- Anti *user enumeration* dan anti *pre-account takeover*
- Rate limit per kelompok endpoint, `helmet`, validasi Zod di semua input
- Token disimpan sebagai hash, password memakai bcrypt dengan batas 72 byte

**Infrastruktur**
- Email via SMTP (Nodemailer) + template **Handlebars** (HTML + teks)
- **88 test otomatis** (Jest + Supertest, database sungguhan)
- **CI GitHub Actions**: typecheck, test, dan build otomatis setiap push dan pull request
- Koleksi Postman, Docker Compose untuk PostgreSQL, siap Vercel

## Persyaratan

- Node.js 20.19+, 22.12+, atau 24+ (syarat Prisma 7)
- PostgreSQL 14+ (lewat Docker atau terinstall)
- Akun SMTP (disarankan Brevo) dan Google OAuth Client, opsional saat awal

## Mulai cepat

```bash
git clone <repo> nama-project && cd nama-project
rm -rf .git && git init
npm install
cp .env.example .env          # lalu isi nilainya
docker compose up -d          # PostgreSQL di localhost:5433
npm run db:migrate            # buat tabel
npm run db:seed               # buat super admin
npm run dev                   # http://localhost:4000
```

Cek: `curl http://localhost:4000/api/health` → `{"ok":true,"db":"up"}`.

Panduan langkah demi langkah: [doc/01-memulai.md](doc/01-memulai.md).

## Environment variable

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ya | Connection string PostgreSQL |
| `JWT_SECRET` | ya | Minimal 32 karakter acak |
| `GOOGLE_CLIENT_ID` | ya | Client ID OAuth Google (isi sementara kalau belum dipakai) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | ya | Pengiriman email |
| `WEB_ORIGIN` | tidak | URL frontend untuk CORS dan link email (default `http://localhost:3000`) |
| `PORT`, `NODE_ENV`, `APP_NAME`, `TRUST_PROXY`, `SMTP_PORT`, `SMTP_SECURE` | tidak | Lihat dokumentasi |
| `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD`, `SEED_SUPERADMIN_NAME` | saat seed | Super admin pertama |

Variabel opsional jangan ditulis kosong (`KEY=`), karena akan ditolak validasi. Hapus barisnya. Penjelasan lengkap: [doc/02-konfigurasi.md](doc/02-konfigurasi.md).

## Scripts

| Script | Fungsi |
|---|---|
| `npm run dev` | Server development (auto-reload) |
| `npm run build` / `npm start` | Build dan jalankan versi production |
| `npm run typecheck` | Cek TypeScript |
| `npm test` | Jalankan semua test |
| `npm run db:migrate` | Buat/terapkan migrasi + generate client |
| `npm run db:seed` | Buat/pastikan super admin |
| `npm run db:studio` | Lihat data di browser |
| `npm run db:reset` | ⚠️ Hapus semua data, migrasi ulang, seed |
| `npm run db:deploy` | Terapkan migrasi di production |
| `npm run postman:generate` | Generate ulang koleksi Postman |

## Endpoint

Semua di bawah `/api/v1`. Request non-GET wajib membawa header `X-Requested-With`.

| Method | Path | Akses |
|---|---|---|
| POST | `/auth/register` | Publik |
| POST | `/auth/verify-email` | Publik |
| POST | `/auth/resend-verification` | Publik |
| POST | `/auth/login` | Publik |
| POST | `/auth/google` | Publik |
| POST | `/auth/refresh` | Cookie refresh |
| POST | `/auth/logout` | Cookie refresh |
| POST | `/auth/forgot-password` | Publik |
| POST | `/auth/reset-password` | Publik |
| GET | `/auth/me` | Login |
| PATCH | `/auth/me` | Login |
| POST | `/auth/change-password` | Login |
| POST | `/auth/logout-all` | Login |
| GET | `/admin/users` | SUPER_ADMIN |
| PATCH | `/admin/users/:id/status` | SUPER_ADMIN |

Detail request, respons, dan error: [doc/10-referensi-api.md](doc/10-referensi-api.md). Koleksi Postman (semua endpoint): `postman/auth-starter.postman_collection.json`, dihasilkan dari `scripts/generate-postman.js`.

## Test

```bash
npm test
```

Butuh database terpisah (nama wajib mengandung `test`) dan file `.env.test`. Lihat [doc/15-testing.md](doc/15-testing.md).

Test juga dijalankan otomatis oleh GitHub Actions (`.github/workflows/ci.yml`) setiap push ke `main` dan setiap pull request. Hasilnya ada di tab **Actions**. Lihat [doc/16-deployment.md](doc/16-deployment.md#ci-github-actions).

## Struktur folder

```
src/
  config/        env (validasi Zod), prisma client
  lib/           token, hash password, mailer, template email, google, errors, logger
  middlewares/   requireAuth, requireRole, csrf, rateLimit, validate, errorHandler
  modules/
    auth/        routes → controller → service → repository
    admin/
  emails/templates/   template Handlebars (.html.hbs & .text.hbs)
prisma/          schema, migrations, seed
tests/           test otomatis
doc/             dokumentasi
```

## Dokumentasi

| Topik | Dokumen |
|---|---|
| Memulai & konfigurasi | [01-memulai](doc/01-memulai.md) · [02-konfigurasi](doc/02-konfigurasi.md) · [03-arsitektur](doc/03-arsitektur.md) |
| Fitur | [04-autentikasi-sesi](doc/04-autentikasi-sesi.md) · [05-registrasi](doc/05-registrasi-verifikasi-email.md) · [06-password](doc/06-lupa-reset-password.md) · [07-google](doc/07-login-google.md) · [08-admin](doc/08-otorisasi-admin.md) · [09-profil](doc/09-profil.md) |
| Referensi | [10-api](doc/10-referensi-api.md) · [11-kode-error](doc/11-kode-error.md) · [12-email](doc/12-email.md) · [13-database](doc/13-database.md) · [14-keamanan](doc/14-keamanan.md) |
| Operasional | [15-testing](doc/15-testing.md) · [16-deployment](doc/16-deployment.md) · [17-frontend](doc/17-integrasi-frontend.md) · [18-mengembangkan](doc/18-mengembangkan.md) · [19-troubleshooting](doc/19-troubleshooting.md) · [20-catatan-kode](doc/20-catatan-kode.md) |

## Checklist project baru

- [ ] `name` di `package.json`
- [ ] `APP_NAME`, `MAIL_FROM`, `WEB_ORIGIN` di `.env`, plus default `APP_NAME` di `src/config/env.ts`
- [ ] Nama database di `docker-compose.yaml` dan `DATABASE_URL`
- [ ] `JWT_SECRET` baru
- [ ] Google OAuth Client baru (Authorized JavaScript origins = URL frontend)
- [ ] Sender dan domain di penyedia email

Detail: [doc/01-memulai.md](doc/01-memulai.md#checklist-saat-memulai-project-baru).
