# 02 · Konfigurasi

## Environment variable

Semua variabel divalidasi oleh Zod di `src/config/env.ts` saat aplikasi start. Jika ada yang tidak valid, proses langsung berhenti (`process.exit(1)`) dan menampilkan field mana yang bermasalah. Kode lain **tidak pernah** membaca `process.env` secara langsung, tetapi memakai objek `env` yang sudah tervalidasi dan bertipe.

File `.env` dimuat dengan `dotenv` (mode `quiet`). Variabel yang sudah ada di environment proses **tidak ditimpa** oleh `.env`. Ini penting untuk test (lihat [15-testing.md](15-testing.md)) dan deployment.

### Aplikasi

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `NODE_ENV` | tidak | `development` | `development`, `production`, atau `test`. Memengaruhi flag cookie `secure`, format log, rate limit, dan cost bcrypt |
| `PORT` | tidak | `4000` | Port HTTP. Harus bilangan bulat positif (bukan `0`) |
| `APP_NAME` | tidak | `Vlairwitch App` | Nama aplikasi yang muncul di subjek dan isi email. Ganti default di kode untuk project baru |
| `WEB_ORIGIN` | tidak | `http://localhost:3000` | URL frontend. Dipakai untuk **CORS** (satu-satunya origin yang diizinkan) dan untuk **link di email** (`/verify-email`, `/reset-password`, `/login`, `/forgot-password`). Harus URL valid, tanpa garis miring di akhir |
| `TRUST_PROXY` | tidak | `0` | Jumlah proxy di depan aplikasi, diteruskan ke Express `trust proxy`. Lihat [penjelasan di bawah](#trust_proxy) |

### Database

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `DATABASE_URL` | **ya** | | Connection string PostgreSQL. Dipakai aplikasi dan Prisma CLI |
| `DIRECT_URL` | tidak | | Koneksi langsung (non-pooler) untuk penyedia seperti Neon atau Supabase. Saat ini hanya divalidasi, belum dipakai kode |

### Autentikasi

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `JWT_SECRET` | **ya** | | Kunci penandatangan access token (HS256). Minimal 32 karakter. Mengganti nilai ini membuat semua access token yang beredar langsung tidak valid (refresh token tetap berlaku, karena tidak memakai JWT) |
| `GOOGLE_CLIENT_ID` | **ya** | | Client ID OAuth Google. Dipakai sebagai `audience` saat memverifikasi ID token. Wajib tidak kosong walaupun belum memakai login Google |
| `GOOGLE_CLIENT_SECRET` | tidak | | **Tidak dipakai backend.** Hanya disimpan untuk testing lewat Google OAuth Playground |

### Email (SMTP)

| Variabel | Wajib | Default | Keterangan |
|---|---|---|---|
| `SMTP_HOST` | **ya** | | Host SMTP, misalnya `smtp-relay.brevo.com` |
| `SMTP_PORT` | tidak | `587` | `587` untuk STARTTLS, `465` untuk TLS langsung |
| `SMTP_SECURE` | tidak | `false` | `true` hanya untuk port 465. Ditulis sebagai string `"true"`/`"false"` |
| `SMTP_USER` | **ya** | | Login SMTP (di Brevo bentuknya `xxx@smtp-brevo.com`, **bukan** email akun) |
| `SMTP_PASS` | **ya** | | SMTP key (di Brevo diawali `xsmtpsib-`, **bukan** API key `xkeysib-`) |
| `MAIL_FROM` | **ya** | | Alamat pengirim, misalnya `"Nama App <no-reply@domain.com>"`. Alamatnya harus sudah diverifikasi di penyedia SMTP |

### Seed (hanya untuk `npm run db:seed`)

| Variabel | Wajib saat seed | Default | Keterangan |
|---|---|---|---|
| `SEED_SUPERADMIN_EMAIL` | ya | | Email super admin |
| `SEED_SUPERADMIN_PASSWORD` | ya | | Minimal 12 karakter. Sebaiknya juga ≤72 byte (batas bcrypt), karena seed tidak memeriksa batas ini |
| `SEED_SUPERADMIN_NAME` | tidak | `Super Admin` | Nama tampilan |

Variabel seed divalidasi terpisah di `prisma/seed.ts` dan tidak dibutuhkan saat server berjalan.

### Variabel opsional: kosongkan dengan menghapus barisnya

Variabel opsional seperti `DIRECT_URL` dan `GOOGLE_CLIENT_SECRET` memakai aturan `z.string().min(1).optional()`. Artinya, variabel itu boleh **tidak ada**, tapi **tidak boleh berupa string kosong**. Baris `GOOGLE_CLIENT_SECRET=` yang kosong akan **ditolak** dan server gagal start. Kalau tidak dipakai, hapus barisnya. Itu sebabnya kedua variabel ini tidak dicantumkan di `.env.example`.

### Catatan validasi

- **`SMTP_SECURE` sengaja tidak memakai `z.coerce.boolean()`.** Coerce boolean mengubah string apa pun yang tidak kosong menjadi `true`, termasuk string `"false"`. Karena itu dipakai `z.enum(["true", "false"])` lalu di-transform.
- **`PORT` dan `SMTP_PORT`** memakai `z.coerce.number()`, karena semua nilai dari `.env` berupa string.

### `TRUST_PROXY`

Express perlu tahu berapa banyak proxy yang berada di depan aplikasi, supaya `req.ip` berisi **IP user asli**, bukan IP proxy. Ini penting karena:

- **Rate limit** menghitung percobaan per IP. Kalau `req.ip` selalu berisi IP proxy, semua user di dunia berbagi satu kuota, dan satu orang bisa membuat semua orang terblokir.
- **Kolom `ip` di tabel `RefreshToken`** diisi dari `req.ip`.

| Lingkungan | Nilai |
|---|---|
| Lokal, tanpa proxy | `0` |
| Vercel | `1` (edge Vercel mengisi header `X-Forwarded-For`) |
| Di belakang satu reverse proxy (Nginx, load balancer) | `1` |
| Cloudflare + Nginx | `2` |

Jangan mengisi angka lebih besar dari jumlah proxy sebenarnya. Kalau terlalu besar, penyerang bisa memalsukan IP lewat header `X-Forwarded-For`.

### `.env.test`

Dipakai khusus oleh Jest. Isinya sama dengan `.env`, tetapi `DATABASE_URL` wajib mengarah ke database terpisah yang namanya mengandung kata `test`. Lihat [15-testing.md](15-testing.md#persiapan-pertama-kali).

---

## File konfigurasi

### `tsconfig.json`

Konfigurasi TypeScript utama untuk kode aplikasi (`src/`).

| Opsi | Nilai | Alasan |
|---|---|---|
| `rootDir` / `outDir` | `./src` / `./dist` | Hasil build di `dist/` dengan struktur yang sama dengan `src/` |
| `module` / `moduleResolution` | `nodenext` | Mengikuti cara Node.js me-resolve modul. Karena `package.json` bertipe `commonjs`, output-nya CommonJS |
| `target` | `es2022` | Fitur modern (top-level class fields, `Array.prototype.at`, dan seterusnya) |
| `types` | `["node"]` | Hanya tipe Node yang dimuat global |
| `strict` | `true` | Semua pengecekan ketat aktif |
| `noUncheckedIndexedAccess` | `true` | Akses `array[i]` bertipe `T \| undefined`. Itu sebabnya ada `!` di beberapa tempat (misalnya `split("@")[0]!`) |
| `isolatedModules` | `true` | Setiap file bisa dikompilasi sendiri (dibutuhkan oleh `tsx` dan `ts-jest`) |
| `esModuleInterop` | `true` | Memungkinkan `import express from "express"` |
| `skipLibCheck` | `true` | Tidak memeriksa file `.d.ts`. **Efek samping:** error di file deklarasi milik sendiri (misalnya `src/types/express.d.ts`) juga tidak terdeteksi, jadi periksa file itu secara manual saat mengubahnya |
| `sourceMap`, `declaration`, `declarationMap` | `true` | Stack trace menunjuk ke file `.ts` asli |

`exactOptionalPropertyTypes` **tidak** diaktifkan. Opsi ini membedakan "properti tidak ada" dari "properti bernilai `undefined`", sehingga banyak library (misalnya opsi `transport` di pino) menolak `undefined` eksplisit. Lihat [19-troubleshooting.md](19-troubleshooting.md#typescript).

### `tsconfig.build.json`

Dipakai oleh `npm run build`. Mewarisi `tsconfig.json` dan mengecualikan file test (`**/*.test.ts`, `**/*.spec.ts`).

### `tsconfig.test.json`

Dipakai oleh `ts-jest`. Mengubah `rootDir` menjadi `.` (karena test berada di `tests/`, di luar `src/`), menambahkan tipe global `jest`, dan meng-include `src` dan `tests`.

### `prisma.config.ts`

Konfigurasi Prisma 7. Sejak Prisma 7, URL database **tidak lagi** ditulis di `schema.prisma`, tetapi di file ini.

| Kunci | Nilai | Keterangan |
|---|---|---|
| `schema` | `prisma/schema.prisma` | Lokasi skema |
| `migrations.path` | `prisma/migrations` | Lokasi file migrasi |
| `migrations.seed` | `tsx prisma/seed.ts` | Dijalankan otomatis oleh `prisma migrate reset` |
| `datasource.url` | `env("DATABASE_URL")` | Dibaca dari `.env` (file ini meng-import `dotenv/config`) |

`env("DATABASE_URL")` melempar error jika variabel tidak ada. Itu sebabnya **semua** perintah Prisma CLI gagal jika `.env` belum dibuat.

### `vercel.json`

```json
{ "functions": { "src/app.ts": { "includeFiles": "src/emails/templates/**" } } }
```

Vercel hanya menyertakan file yang terdeteksi di-`import`. Template email dibaca lewat `fs.readFileSync`, sehingga tidak terdeteksi. `includeFiles` memaksanya ikut ter-deploy. Lihat [16-deployment.md](16-deployment.md#vercel).

### `docker-compose.yaml`

Satu service `db` (PostgreSQL 17 Alpine) dengan healthcheck `pg_isready`. Port `5433` di host dipetakan ke `5432` di container, supaya tidak bentrok dengan PostgreSQL yang sudah terinstall di komputer.

### `jest.config.js`

Lihat [15-testing.md](15-testing.md#konfigurasi-jest).

### `scripts/copy-assets.js`

Menyalin `src/emails/templates/` ke `dist/emails/templates/` setelah `tsc`. Script ini dibutuhkan karena `tsc` hanya mengompilasi file `.ts`, sehingga file `.hbs` tidak ikut ke `dist/`.
