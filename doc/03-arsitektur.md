# 03 · Arsitektur

## Struktur folder

```
.
├── .github/workflows/ci.yml    CI GitHub Actions (typecheck, test, build)
├── doc/                        Dokumentasi (folder ini)
├── postman/                    Koleksi Postman untuk testing manual
├── prisma/
│   ├── schema.prisma           Definisi tabel & enum
│   ├── migrations/             Riwayat migrasi SQL (jangan diedit setelah diterapkan)
│   └── seed.ts                 Pembuat super admin
├── scripts/
│   ├── copy-assets.js          Menyalin template email ke dist/ saat build
│   └── generate-postman.js     Generator koleksi Postman
├── src/
│   ├── app.ts                  Membuat & mengonfigurasi aplikasi Express (juga entry Vercel)
│   ├── server.ts               Menjalankan HTTP server + graceful shutdown (entry lokal)
│   ├── routes.ts               Router /api/v1: CSRF + pemasangan module
│   ├── config/
│   │   ├── env.ts              Validasi environment variable (Zod)
│   │   └── prisma.ts           Instance PrismaClient tunggal
│   ├── lib/                    Utilitas tanpa ketergantungan HTTP
│   │   ├── errors.ts           Kelas HttpError
│   │   ├── token.ts            JWT, refresh token, hash token, opsi cookie
│   │   ├── hash-password.ts    bcrypt (bcryptjs)
│   │   ├── mailer.ts           Pengirim email SMTP (Nodemailer)
│   │   ├── email-templates.ts  Loader & renderer Handlebars
│   │   ├── google.ts           Verifikasi ID token Google
│   │   └── logger.ts           Logger pino
│   ├── middlewares/
│   │   ├── csrf.ts             Wajib header X-Requested-With untuk non-GET
│   │   ├── requireAuth.ts      Membaca access token, memuat user
│   │   ├── requireRole.ts      Membatasi akses berdasarkan role
│   │   ├── validate.ts         Validasi req.body dengan Zod
│   │   ├── rateLimit.ts        Limiter per kelompok endpoint
│   │   └── errorHandler.ts     Mengubah semua error menjadi respons JSON seragam
│   ├── modules/
│   │   ├── auth/               Semua fitur autentikasi & profil
│   │   └── admin/              Manajemen user oleh SUPER_ADMIN
│   ├── emails/templates/       Template email Handlebars (.html.hbs & .text.hbs)
│   ├── types/express.d.ts      Menambahkan req.user ke tipe Express
│   └── generated/prisma/       Prisma Client hasil generate (tidak di-commit)
├── tests/                      Test otomatis
└── dist/                       Hasil build (tidak di-commit)
```

## Lapisan kode dalam sebuah module

Setiap module (`auth`, `admin`) memakai pola yang sama:

```
routes ──► controller ──► service ──► repository ──► Prisma
  │            │             │             │
  │            │             │             └─ Query database. Tidak ada logika bisnis.
  │            │             └─ Logika bisnis & aturan. Melempar HttpError. Tidak tahu soal req/res.
  │            └─ Membaca req, memanggil service, menulis res (status, cookie, body).
  └─ Menyusun middleware per endpoint: rate limit, validasi, auth, role.
```

| File | Tanggung jawab | Boleh | Tidak boleh |
|---|---|---|---|
| `*.routes.ts` | Mendaftarkan endpoint dan urutan middleware | Memakai middleware | Logika bisnis |
| `*.controller.ts` | Jembatan HTTP | Membaca `req`, set cookie, kirim respons | Query database langsung |
| `*.service.ts` | Aturan bisnis | Memanggil repository, mengirim email, melempar `HttpError` | Menyentuh `req`/`res` |
| `*.repository.ts` | Akses data | Query Prisma, transaksi | Melempar error HTTP |
| `*.schema.ts` | Schema validasi Zod | | |
| `*.types.ts` | Tipe bersama | | |
| `auth.emails.ts` | Merakit email (subjek, link, TTL) dari template | | |

Manfaatnya: service bisa diuji dan dipakai ulang tanpa HTTP, dan seluruh akses database bisa ditemukan di satu tempat.

## Alur sebuah request

Urutan middleware global di `src/app.ts`:

```
Request
  │
  ├─ trust proxy           req.ip = IP asli (sesuai TRUST_PROXY)
  ├─ helmet()              Header keamanan HTTP
  ├─ cors()                Hanya WEB_ORIGIN, dengan credentials (cookie)
  ├─ express.json()        Parse body JSON, maksimal 100 KB
  ├─ cookieParser()        req.cookies
  │
  ├─ GET /api/health       Cek koneksi database (di luar /api/v1, tanpa CSRF)
  │
  ├─ /api/v1 ─► requireCsrfHeader ─► /auth  ─► (middleware per route) ─► controller
  │                               └► /admin ─► requireAuth ─► requireRole(SUPER_ADMIN) ─► controller
  │
  ├─ 404 handler           Route tidak ditemukan → HttpError 404 not_found
  └─ errorHandler          Semua error → JSON { error: {...} }
```

Contoh lengkap untuk `POST /api/v1/auth/login`:

```
helmet → cors → json → cookieParser → requireCsrfHeader → loginLimiter
       → validateBody(loginSchema) → controller.Login → authService.login
       → repository → Prisma → set cookie → 200
```

### Async error di Express 5

Express 5 otomatis meneruskan error dari handler `async` (promise yang reject) ke `errorHandler`. Karena itu, controller dan middleware cukup melempar error (`throw new HttpError(...)`), tanpa `try/catch` dan tanpa `next(err)`.

## Format respons

### Sukses

```json
{
  "success": true,
  "code": "login_success",
  "message": "Login Success",
  "data": { },
  "meta": { }
}
```

- `code` adalah kode mesin yang stabil. **Gunakan ini di frontend**, bukan `message`.
- `message` berbahasa Inggris dan ditujukan untuk developer. Jangan ditampilkan apa adanya ke user.
- `data` dan `meta` hanya ada jika relevan (`meta` untuk pagination).
- Endpoint yang mengembalikan `204 No Content` tidak punya body.

### Error

Semua error, dari sumber mana pun, dibentuk oleh `src/middlewares/errorHandler.ts`:

```json
{
  "error": {
    "code": "validation_failed",
    "message": "Invalid Data",
    "fields": { "email": ["Invalid email address"] }
  }
}
```

- `fields` hanya ada pada error validasi atau error yang terkait field tertentu.
- Daftar semua kode ada di [11-kode-error.md](11-kode-error.md).

### Pemetaan error di `errorHandler`

| Sumber error | Status | `code` |
|---|---|---|
| `HttpError` (dilempar kode aplikasi) | sesuai | sesuai |
| `ZodError` yang lolos ke handler | 400 | `validation_failed` |
| Prisma `P2002` (unique constraint) | 409 | `conflict`, dengan `fields` berisi kolom yang bentrok |
| Prisma `P2025` (record tidak ditemukan) | 404 | `not_found` |
| Prisma `P2003` (foreign key) | 409 | `conflict` |
| Error body-parser 413 (body > 100 KB) | 413 | `payload_too_large` |
| Error body-parser 400 (JSON rusak) | 400 | `invalid_request` |
| Error 4xx lain dari library | sesuai | `client_error` |
| Selain itu | 500 | `internal_error` (detail dicatat di log, **tidak** dikirim ke client) |

## Validasi input

- **Body:** middleware `validateBody(schema)` memvalidasi `req.body` dan **mengganti** `req.body` dengan hasil parse. Efeknya: field yang tidak dikenal dibuang, string di-`trim`, email dijadikan huruf kecil. Controller selalu menerima data yang sudah bersih.
- **Query dan params:** di Express 5, `req.query` bersifat read-only (getter), sehingga tidak bisa ditimpa oleh middleware. Karena itu, modul admin memvalidasi query dan params di controller dengan helper `parseOrThrow`.
- **Error validasi tingkat form:** aturan `.refine()` tanpa `path` (misalnya "minimal satu field" di `PATCH /me`) masuk ke `formErrors` milik Zod, bukan `fieldErrors`. Karena `validateBody` hanya mengirim `fieldErrors`, respons untuk kasus ini berisi `fields: {}`. Lihat [18-mengembangkan.md](18-mengembangkan.md#perbaikan-yang-disarankan).

## Logging

`src/lib/logger.ts` memakai pino:

| `NODE_ENV` | Level | Format |
|---|---|---|
| `development` | `info` | Berwarna dan mudah dibaca (`pino-pretty`) |
| `production` | `info` | JSON satu baris (cocok untuk agregator log) |
| `test` | `silent` | Tidak ada output |

Header `authorization` dan `cookie` di-*redact*, supaya token tidak pernah tercatat di log. Saat ini belum ada log per request (lihat [fitur opsional](18-mengembangkan.md#fitur-opsional)).

## Siklus hidup proses

`src/server.ts`:

1. `app.listen(PORT)`.
2. `verifyMailer()` mengecek koneksi SMTP. Kalau gagal, hanya muncul **peringatan**; server tetap berjalan.
3. Saat menerima `SIGTERM`/`SIGINT` (Ctrl+C, deploy ulang): server berhenti menerima koneksi baru, menunggu request yang sedang berjalan selesai, memutus koneksi Prisma, lalu keluar. Kalau dalam 10 detik belum selesai, proses dipaksa keluar.

`src/app.ts` meng-export `app` dua kali: sebagai named export (dipakai `server.ts` dan test) dan sebagai default export (dipakai Vercel sebagai serverless function).

## Prisma Client

`src/config/prisma.ts` membuat **satu** instance `PrismaClient` yang dipakai di seluruh aplikasi, dengan driver adapter `@prisma/adapter-pg`. Prisma 7 mewajibkan driver adapter. Client hasil generate berada di `src/generated/prisma` (dikonfigurasi di `schema.prisma`) dan di-import dari sana, bukan dari `@prisma/client`.

## Tipe `req.user`

`src/types/express.d.ts` menambahkan properti opsional `user` ke `Express.Request`:

```ts
user?: { id: string; email: string; name: string; role: Role };
```

Properti ini diisi oleh `requireAuth`. Di handler yang dipasang setelah `requireAuth`, `req.user!` aman dipakai.
