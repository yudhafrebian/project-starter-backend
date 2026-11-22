# 20 · Catatan Kode

Kode di project ini sengaja ditulis **tanpa komentar**. Keputusan penting yang dulu dijelaskan lewat komentar di dalam kode dipindahkan ke sini, diurutkan per file. Baca bagian yang relevan sebelum mengubah sebuah file, karena banyak baris yang terlihat "aneh" justru disengaja.

---

## `src/app.ts`

- `export default app` adalah **entry point Vercel**. Vercel mengenali file ini otomatis dan menjalankan default export-nya sebagai serverless function. Saat berjalan lokal atau di server biasa, aplikasi dijalankan lewat `src/server.ts` (`app.listen`). Named export `app` dipakai `server.ts` dan test.
- `/api/health` dipasang **sebelum** `/api/v1`, sehingga tidak melewati proteksi CSRF dan bisa dipanggil oleh load balancer.

## `src/server.ts`

- `verifyMailer()` hanya **memperingatkan** kalau SMTP tidak terjangkau. Server tetap menyala, karena aplikasi tetap berguna tanpa email (login tetap bisa).
- Graceful shutdown: tunggu request selesai, tutup Prisma, keluar. `setTimeout(..., 10_000).unref()` memaksa keluar kalau terlalu lama, dan `unref()` memastikan timer itu sendiri tidak menahan proses tetap hidup.

## `src/routes.ts`

- `api.use(requireCsrfHeader)` dipasang di level router `/api/v1`, sehingga **semua** module (yang ada sekarang maupun nanti) otomatis terlindungi.

## `src/config/env.ts`

- `TRUST_PROXY` adalah jumlah proxy di depan aplikasi (Express `trust proxy`), supaya `req.ip` berisi IP user asli untuk rate limit. Vercel = `1` (edge Vercel mengisi `X-Forwarded-For`), lokal = `0`.
- `SMTP_SECURE` **tidak** memakai `z.coerce.boolean()`, karena coerce mengubah string `"false"` menjadi `true`. Karena itu dipakai `z.enum(["true","false"])` lalu di-transform.
- Validasi gagal → `process.exit(1)`. Lebih baik gagal di awal daripada berjalan dengan konfigurasi yang salah.

## `src/config/prisma.ts`

- Satu instance `PrismaClient` untuk seluruh aplikasi, dengan driver adapter `PrismaPg` (wajib di Prisma 7).

## `src/lib/token.ts`

- `ACCESS_TTL_SECONDS = 15 * 60` (15 menit), `REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60` (30 hari).
- Refresh token dan token email di-hash dengan **SHA-256, bukan bcrypt**. Token sudah acak 256 bit sehingga mustahil ditebak, dan token perlu **dicari** di database berdasarkan hash-nya. bcrypt memakai salt acak, jadi tidak bisa dipakai untuk pencarian.
- `refreshCookieOptions.path = "/api/v1/auth"`: refresh token **hanya** dikirim browser ke endpoint auth, tidak ikut ke setiap request. Kalau prefix API berubah, nilai ini harus ikut diubah.
- `generateRefreshToken` dan `generateRandomToken` identik. Keduanya bisa disatukan.

## `src/lib/hash-password.ts`

- **Cost yang sama dipakai untuk semua hash**, termasuk `dummyHash` di `auth.service`, supaya waktu respons login tidak membocorkan apakah sebuah email terdaftar.
- Cost **4 hanya saat `NODE_ENV=test`** supaya test cepat. Production tetap **12**. `process.env.NODE_ENV` dibaca langsung (bukan lewat `env`), supaya file ini tidak bergantung pada validasi env.

## `src/lib/mailer.ts`

- `trySendMail` dipakai untuk email auth. Kegagalan SMTP dicatat di log, tapi **tidak menggagalkan request**, karena user selalu bisa meminta kirim ulang dan respons yang berbeda bisa membocorkan informasi.

## `src/lib/email-templates.ts`

- `TEMPLATE_DIR = path.join(__dirname, "../emails/templates")`. Saat development (`tsx`) lokasinya `src/lib → src/emails/templates`. Setelah build, `dist/lib → dist/emails/templates` (disalin oleh `scripts/copy-assets.js`).
- `TemplateContexts` adalah daftar template beserta tipe variabelnya. Menambah email baru = tambah entri di sini + dua file `.hbs` (html dan text).
- `TEMPLATES ... satisfies Record<TemplateName, true>` memaksa daftar ini selalu sama dengan `TemplateContexts`. Kalau salah satu terlupa, TypeScript langsung error.
- `Handlebars.create()` membuat instance terpisah, supaya tidak bentrok dengan library lain yang memakai Handlebars global.
- Template **dikompilasi sekali** saat modul pertama kali di-import (saat server start), bukan per request. Kalau ada file yang hilang, server langsung gagal start, sehingga masalahnya ketahuan lebih awal, bukan saat user mendaftar.
- `strict: true`: variabel yang tidak ada (misalnya typo `{{nmae}}`) langsung error, bukan menjadi string kosong.
- Template teks memakai `noEscape: true`. Kalau di-escape, `&` menjadi `&amp;` di email teks.
- `appName` dan `year` adalah variabel global yang tersedia di semua template.

## `src/lib/google.ts`

- `verifyIdToken` memeriksa **signature** (public key Google, di-cache otomatis oleh library), **audience**, **issuer**, dan **masa berlaku**.
- `email_verified !== true` ditolak. Syarat ini membuat penautan akun berdasarkan email menjadi aman.

## `src/middlewares/errorHandler.ts`

- `clientErrorStatus` menangani error dari body-parser (JSON rusak, body terlalu besar), yang membawa properti `status`/`statusCode` 4xx.
- Error yang tidak dikenali dicatat di log, dan client hanya menerima `internal_error`, tanpa stack trace.

## `src/middlewares/rateLimit.ts`

- `emailLimiter` (5) lebih ketat dari `loginLimiter` (10), karena endpoint pengirim email bisa disalahgunakan untuk spam.
- `passwordResetLimiter` tetap ada walaupun token reset mustahil ditebak, karena setiap request menjalankan bcrypt yang berat.
- Satu instance limiter yang dipakai di beberapa route **berbagi kuota**. Ini disengaja.

## `src/middlewares/requireAuth.ts`

- User dimuat dari database **di setiap request**, supaya perubahan role dan penonaktifan akun berlaku seketika.
- Menerima token dari cookie **atau** header `Authorization: Bearer`.

## `src/middlewares/requireRole.ts`

- Parameter bertipe `[Role, ...Role[]]` memaksa **minimal satu** role. `requireRole()` tanpa argumen menjadi error TypeScript, bukan diam-diam menolak semua orang.
- Pengecekan `!req.user` → 401 adalah pengaman kalau `requireRole` terpasang tanpa `requireAuth` sebelumnya.

## `src/modules/auth/auth.schema.ts`

- `newPasswordSchema` membatasi password **72 byte**, karena bcrypt hanya memproses 72 byte pertama. Password yang lebih panjang ditolak supaya tidak terpotong diam-diam.
- `avatarUrl`: `null` = hapus avatar. Hanya `https` yang diterima, untuk mencegah `javascript:`, `data:`, dan `http`.

## `src/modules/auth/auth.service.ts`

- `VERIFY_TTL_MS` diturunkan dari `VERIFY_EMAIL_TTL_HOURS`, dan `RESET_TTL_MS` dari `RESET_PASSWORD_TTL_MINUTES`, supaya angka di database **sama dengan** yang tertulis di email.
- `RESEND_COOLDOWN_MS = 60 * 1000`: jeda minimal kirim ulang per user, berlaku untuk verifikasi dan reset.
- `issueVerificationToken` mematikan token lama dengan tipe yang sama, membuat token baru, lalu mengembalikan token mentah (untuk link email). Hanya link terbaru yang berlaku.
- `register`:
  - Password **selalu di-hash di awal**, supaya waktu respons ketiga cabang kurang lebih sama.
  - Dua register bersamaan dengan email yang sama → `P2002` → request yang kalah **diam saja** (tetap 202).
  - Email belum terverifikasi → **pendaftar terakhir menentukan password** (penangkal *pre-account takeover*).
- `resendVerification` dan `forgotPassword`: kondisi yang tidak memenuhi syarat → **diam** (`return`), supaya status akun tidak bocor.
- `createSession` adalah **satu pintu** pembuatan sesi, dipakai login password, login Google, dan change password.
- `refreshSession`:
  - Token yang sudah dicabut muncul lagi. Kalau baru dicabut kurang dari 10 detik (`REUSE_GRACE_MS`), kemungkinan dua tab refresh bersamaan, bukan pencurian. Selain itu dianggap **pencurian**, dan seluruh keluarga token dicabut.
  - `consumeRefreshToken` bersifat atomic. `count === 0` berarti token kalah balapan dengan request lain.
- `dummyHash` dibuat dengan `hashPassword` supaya cost-nya selalu sama dengan hash user asli, dan dibuat **saat startup** supaya login pertama tidak lebih lambat.
- `resolveGoogleUser`: (1) cocokkan `sub` (tidak pernah berubah), (2) tautkan berdasarkan email, (3) buat user baru.
- `loginWithGoogle` menangkap `P2002`, yang bisa terjadi kalau (a) dua login Google pertama datang bersamaan (ambil hasil request yang menang), atau (b) user sudah tertaut ke akun Google **lain** (`@@unique([userId, provider])`) → `409`.
- `toProfileDto` adalah **satu-satunya tempat** yang menentukan bentuk data profil yang keluar ke client.

## `src/modules/auth/auth.repository.ts`

- `consumeRefreshToken`: atomic, hanya berhasil kalau token **belum** dicabut. `count = 0` berarti sudah dipakai request lain.
- `invalidateVerificationTokens`: mengisi `usedAt` = token tidak bisa dipakai lagi.
- `markEmailVerified`: satu transaksi. Pakai token (atomic), tandai email terverifikasi, lalu matikan token verifikasi lain.
- `resetPasswordWithToken`: satu transaksi. Pakai token (atomic), ganti password, isi `emailVerifiedAt` kalau kosong (klik link di inbox = bukti pemilik email), matikan token reset lain, lalu cabut semua sesi. Kalau salah satu langkah gagal, semuanya dibatalkan.
- `linkGoogleAccount`: satu query `user.update` dengan nested write, sehingga otomatis satu transaksi. Kalau email **belum pernah terbukti**, password lama dibuat oleh orang yang belum tentu pemilik email, jadi password dihapus dan link verifikasi lama dimatikan (penangkal *pre-account takeover*).
- `profileSelect` mengambil `passwordHash` **hanya** untuk menghitung `hasPassword`. Kolom itu tidak dikirim ke client.
- `updateProfile`: Prisma mengabaikan field bernilai `undefined`, sehingga hanya field yang dikirim yang berubah.

## `src/modules/admin/admin.controller.ts`

- Di Express 5, `req.query` tidak bisa ditimpa (read-only), jadi query dan params divalidasi di controller dengan `parseOrThrow`.

## `src/modules/admin/admin.repository.ts`

- `publicUserSelect` adalah kolom yang **boleh** keluar ke API. `passwordHash` tidak pernah ikut.
- `setUserActive`: menonaktifkan user sekaligus mencabut semua sesinya, dalam satu transaksi.

## `src/modules/admin/admin.routes.ts`

- `router.use(requireAuth, requireRole(Role.SUPER_ADMIN))`: satu baris ini melindungi **semua** route di bawahnya.

## `src/modules/admin/admin.service.ts`

- Admin tidak bisa mengubah status dirinya sendiri, supaya tidak mengunci dirinya sendiri.
- `SUPER_ADMIN` tidak bisa dinonaktifkan lewat API, supaya antar admin tidak saling mengunci.

## `prisma/seed.ts`

- Jalankan dengan `npm run db:seed`. Otomatis juga dijalankan oleh `prisma migrate reset` (lihat `prisma.config.ts`).
- **Idempotent.** User belum ada → dibuat sebagai `SUPER_ADMIN`. Sudah ada → role dipastikan `SUPER_ADMIN` dan aktif, tapi password **tidak** ditimpa.

## `prisma.config.ts`

- File ini awalnya dibuat oleh `prisma init`, dan mengasumsikan `prisma` serta `dotenv` sudah terinstall.
- `import "dotenv/config"` diperlukan karena Prisma 7 CLI tidak memuat `.env` sendiri.

## `scripts/copy-assets.js`

- Menyalin file non-TS (template email) ke `dist/`, karena `tsc` hanya mengompilasi `.ts`.

## `scripts/generate-postman.js`

- Sumber koleksi Postman. File JSON di `postman/` adalah **hasil** script ini, jadi jangan diedit langsung.
- Path output default `postman/auth-starter.postman_collection.json`, bisa diganti lewat argumen pertama.
- Header `X-Requested-With` dipasang lewat script pre-request di level koleksi, sehingga berlaku untuk semua request.
- Request **Refresh – Reuse Token Lama** memakai `disableCookies: true`. Tanpa ini, Postman ikut mengirim cookie `refresh_token` terbaru dari cookie jar, dan uji pencurian tidak valid.
- `tokenFromUrl` membuat variable `verificationToken`/`resetToken` bisa diisi dengan URL lengkap dari email. Token diambil otomatis dari parameter `token=`.
- **List Users** menyimpan id user pertama yang bukan `SUPER_ADMIN` ke `targetUserId`, supaya request Nonaktifkan/Aktifkan tidak menyentuh akun admin.

## `.github/workflows/ci.yml`

- `DATABASE_URL` diset di level **job**, bukan hanya di `.env.test`. `npm ci` menjalankan `prisma generate` lewat `postinstall`, dan `prisma.config.ts` membutuhkan `DATABASE_URL` **sebelum** langkah pembuatan `.env.test`.
- Heredoc `cat > .env.test <<'EOF'` memakai tanda kutip di `'EOF'`, supaya `$` dan backtick di dalamnya tidak diproses shell.
- Nama database `starter_db_test` wajib mengandung `test`, karena ada pengaman di `tests/setup/global-setup.ts`.
- Langkah terakhir (`test -f dist/emails/templates/layout.html.hbs`) memastikan `scripts/copy-assets.js` berjalan. Tanpa template, server production gagal start.
- `concurrency` dengan `cancel-in-progress` membatalkan run lama di branch yang sama saat ada push baru.
- Node 22 dipilih karena memenuhi syarat Prisma 7 (`^20.19 || ^22.12 || >=24`) dan berstatus LTS.

## `docker-compose.yaml`

- Port **5433** di host, supaya tidak bentrok dengan PostgreSQL yang sudah terinstall di komputer.

## `.env.example`

- `WEB_ORIGIN` = URL frontend, dipakai untuk CORS dan link di email.
- `TRUST_PROXY`: Vercel `1`, lokal `0`.
- `DATABASE_URL` default sesuai `docker-compose.yaml` (port 5433).
- `DIRECT_URL` hanya untuk connection pooler (Neon/Supabase). **Tidak dicantumkan**, karena nilai kosong ditolak validasi.
- `JWT_SECRET` minimal 32 karakter. Buat dengan `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.
- `GOOGLE_CLIENT_SECRET` tidak dipakai backend, hanya untuk testing lewat OAuth Playground. **Tidak dicantumkan**, karena nilai kosong ditolak validasi.
- `SEED_*` hanya untuk `npm run db:seed`.

## `tsconfig.json`

- Komentar bawaan `tsc --init` dihapus. Opsi yang dulu ada sebagai komentar tapi tidak aktif: `exactOptionalPropertyTypes`, `noImplicitReturns`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`. Semuanya bisa diaktifkan kalau ingin pengecekan yang lebih ketat. Penjelasan setiap opsi yang aktif ada di [02-konfigurasi.md](02-konfigurasi.md#tsconfigjson).

## `jest.config.js`

- `moduleNameMapper`: Prisma Client hasil generate meng-import `./x.js` padahal file aslinya `./x.ts`. `tsx` dan `tsc` memahami konvensi ini, Jest tidak, jadi akhiran `.js` pada import relatif dibuang.
- Urutan setup: (1) `setupFiles` memuat `.env.test` sebelum kode aplikasi di-import, (2) `setupFilesAfterEnv` memasang mock mailer, (3) `globalSetup` menerapkan migrasi ke database test sekali sebelum semua test.
- `clearMocks: true`: riwayat mock (email "terkirim") direset sebelum setiap test.

## `tests/`

- `setup/env.ts`: `override: true` membuat nilai `.env.test` menang. Setelah itu, `dotenv.config()` di `src/config/env.ts` tidak menimpanya, karena dotenv tidak menimpa variabel yang sudah ada.
- `setup/global-setup.ts` dan `helpers/db.ts`: **pengaman**. Kedua file menolak berjalan kalau nama database tidak mengandung `test`.
- `setup/mocks.ts`: mock berlaku untuk **semua** file test. Template email tetap di-render sungguhan; hanya pengirimannya yang ditangkap, lalu dibaca lewat `helpers/mail.ts`.
- `helpers/db.ts` → `createUser({ password: null })` = user tanpa password (Google-only).
- `helpers/http.ts`: `csrf` adalah header wajib untuk request non-GET. `agent()` = "browser" (menyimpan cookie dan sudah membawa header CSRF). `raw()` = tanpa cookie jar dan tanpa header CSRF, untuk mengirim cookie atau header secara manual. `loginAs()` login lalu mengembalikan agent yang membawa cookie sesi. `getCookie()` membaca nilai cookie dari `Set-Cookie`.
- `helpers/mail.ts`: `sentEmails()` berisi semua email yang "dikirim" sejak awal test. `extractToken()` mengambil token dari link `?token=` di versi teks email.
- `auth.session.test.ts`: test reuse **memundurkan `revokedAt` 1 menit** di database untuk mensimulasikan waktu tanpa benar-benar menunggu.
- `auth.register.test.ts`: `"é".repeat(37)` = 37 karakter, tapi 74 byte, untuk menguji batas byte (bukan karakter). Cooldown diuji dengan memundurkan `createdAt` token 2 menit.
- `auth.profile.test.ts`: user Google-only tidak bisa login dengan password, jadi test membuat access token langsung dengan `signAccessToken`.

---

## Hal yang sengaja tidak dihapus komentarnya

| Lokasi | Alasan |
|---|---|
| `src/generated/prisma/**` | Hasil generate Prisma, dibuat ulang setiap `prisma generate`. Perubahan manual akan hilang |
| `prisma/migrations/**/migration.sql` | Checksum file migrasi tercatat di database. Mengubah isinya, termasuk komentar, membuat Prisma mendeteksi migrasi yang dimodifikasi |
| `.env` | File konfigurasi pribadi berisi rahasia (tidak di-commit) |

Koleksi Postman (`postman/auth-starter.postman_collection.json`) juga tidak berisi komentar, karena dihasilkan oleh `scripts/generate-postman.js`.
