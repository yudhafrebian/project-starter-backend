# 16 · Deployment

## Build

```bash
npm run build
```

1. `tsc -p tsconfig.build.json` mengompilasi `src/` ke `dist/` (file test dikecualikan).
2. `node scripts/copy-assets.js` menyalin `src/emails/templates/` ke `dist/emails/templates/`. `tsc` hanya mengompilasi `.ts`, sehingga file `.hbs` tidak ikut tanpa langkah ini.

Menjalankan hasil build:

```bash
npm start   # node dist/server.js
```

Kalau ada template email yang hilang di `dist/`, server langsung gagal start dengan error `ENOENT`. Ini disengaja, supaya masalahnya ketahuan saat deploy, bukan saat user mendaftar.

## Server biasa (VPS, Docker, Railway, Render, Fly.io)

Langkah umum:

```bash
npm ci
npm run build
npm run db:deploy      # terapkan migrasi
npm start
```

- `npm ci` juga menjalankan `prisma generate` (lewat `postinstall`).
- `db:deploy` (`prisma migrate deploy`) aman dijalankan setiap deploy. Perintah ini hanya menerapkan migrasi yang belum diterapkan, dan tidak pernah mereset data.
- Proses menangani `SIGTERM`: berhenti menerima koneksi baru, menyelesaikan request yang sedang berjalan, menutup koneksi database, lalu keluar (paksa keluar setelah 10 detik). Ini cocok dengan cara platform container menghentikan aplikasi.
- Health check untuk platform: `GET /api/health` (200 jika database terhubung).

### Contoh Dockerfile

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./
EXPOSE 4000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
```

`bcryptjs` dipilih (bukan `bcrypt` native) salah satunya supaya image Alpine seperti ini tidak butuh alat kompilasi native.

## Vercel

`src/app.ts` meng-export `app` sebagai **default export**. Vercel mengenalinya otomatis dan menjalankannya sebagai serverless function. `src/server.ts` (yang memanggil `app.listen`) tidak dipakai di Vercel.

Yang perlu diperhatikan:

| Hal | Penjelasan |
|---|---|
| Template email | Vercel mengompilasi `src/app.ts` sendiri (tidak memakai `dist/`) dan hanya menyertakan file yang di-`import`. Template dibaca lewat `fs`, jadi `vercel.json` memaksanya ikut dengan `includeFiles: "src/emails/templates/**"` |
| `TRUST_PROXY` | Isi `1` |
| Migrasi | Jalankan `prisma migrate deploy` di build command atau dari pipeline CI, bukan saat runtime |
| Email | Sudah dikirim dengan `await` sebelum respons, karena pekerjaan setelah respons bisa dihentikan di serverless |
| Rate limit | Disimpan di memori per instance. Instance serverless bisa banyak dan berumur pendek, sehingga limit menjadi kurang efektif. Pertimbangkan store bersama (Redis/Upstash) |
| Koneksi database | Serverless membuka banyak koneksi. Pakai connection pooler (Neon, Supabase pooler, PgBouncer) |
| `SIGTERM` handler | Tidak berlaku di serverless (hanya di `server.ts`) |

## Environment production

| Variabel | Nilai production |
|---|---|
| `NODE_ENV` | `production`. **Wajib**, karena mengaktifkan cookie `secure` dan log JSON |
| `WEB_ORIGIN` | `https://app.domainkamu.com` |
| `JWT_SECRET` | Acak, unik, minimal 32 karakter. Berbeda dengan development |
| `TRUST_PROXY` | Sesuai infrastruktur |
| `DATABASE_URL` | Database production (dengan pooler kalau serverless) |
| `SMTP_*`, `MAIL_FROM` | Penyedia email dengan domain terautentikasi |
| `GOOGLE_CLIENT_ID` | OAuth Client dengan origin production |

## Frontend dan backend di domain berbeda

Cookie memakai `sameSite: "lax"`. Browser mengirim cookie `lax` hanya ke situs yang **sama** (*same-site*: domain utama yang sama, misalnya `example.com`).

| Frontend | Backend | Cookie terkirim? |
|---|---|---|
| `app.example.com` | `api.example.com` | ✅ Ya (*same-site*) |
| `example.com` | `example.com/api` | ✅ Ya |
| `app.vercel.app` | `api.onrender.com` | ❌ Tidak (*cross-site*) |

Untuk skenario *cross-site*, pilihan terbaiknya adalah memakai subdomain dari domain yang sama. Alternatifnya, ubah cookie menjadi `sameSite: "none"` (wajib bersama `secure: true`) di `src/lib/token.ts`. Tapi ini mengurangi perlindungan CSRF, dan beberapa browser memblokir cookie pihak ketiga.

## Mengubah prefix API

Kalau API dipasang di path lain (misalnya `/backend/api/v1`), ubah juga `path` cookie refresh di `src/lib/token.ts` (`refreshCookieOptions`). Kalau tidak, browser tidak mengirim cookie refresh ke endpoint refresh.

## Checklist go-live

- [ ] `NODE_ENV=production`
- [ ] HTTPS aktif di frontend dan backend
- [ ] Semua env production terisi (lihat tabel di atas)
- [ ] `npm run db:deploy` berhasil
- [ ] `npm run db:seed` untuk super admin pertama, lalu ganti password admin
- [ ] `GET /api/health` → `{"ok":true,"db":"up"}`
- [ ] Log saat start menampilkan `SMTP ready`
- [ ] Uji alur register → email masuk → verifikasi → login di production
- [ ] SPF, DKIM, DMARC = PASS (Gmail → Show original)
- [ ] Google OAuth: origin production terdaftar, consent screen sudah *published*
- [ ] Pembersihan token lama dijadwalkan ([13-database.md](13-database.md#pembersihan-data))
- [ ] Checklist keamanan di [14-keamanan.md](14-keamanan.md#checklist-keamanan-sebelum-production)

## CI (GitHub Actions)

Workflow ada di `.github/workflows/ci.yml` dan berjalan otomatis setiap kali:

- **push ke branch `main`**, dan
- **pull request** dibuat atau diperbarui (ke branch mana pun).

Kalau ada push baru ke branch yang sama saat CI masih berjalan, run lama dibatalkan (`concurrency`), sehingga yang diuji selalu commit terbaru dan kuota menit tidak terbuang. Workflow hanya punya izin baca (`permissions: contents: read`).

### Langkah

| # | Langkah | Gunanya |
|---|---|---|
| 1 | Checkout | Mengambil kode |
| 2 | Setup Node.js 22 (dengan cache npm) | Node 22 adalah LTS dan memenuhi syarat Prisma 7 |
| 3 | `npm ci` | Instalasi bersih **persis** sesuai `package-lock.json`. Gagal kalau lockfile tidak sinkron dengan `package.json`. Juga menjalankan `prisma generate` |
| 4 | Buat `.env.test` | File ini di-`.gitignore`, jadi dibuat di dalam workflow |
| 5 | `npm run typecheck` | Cek tipe kode aplikasi |
| 6 | `tsc -p tsconfig.test.json` | Cek tipe file test |
| 7 | `npm test` | 88 test dengan PostgreSQL sungguhan |
| 8 | `npm run build` | Memastikan build berhasil |
| 9 | Cek `dist/emails/templates` | Memastikan template email ikut tersalin ke hasil build |

### Database di CI

PostgreSQL 17 dijalankan sebagai *service container* dengan database `starter_db_test` (user dan password `postgres`). Langkah-langkah job baru dimulai setelah healthcheck `pg_isready` lulus. Nama database mengandung `test`, sehingga lolos pengaman di `tests/setup/global-setup.ts`. Container ini dibuat baru di setiap run dan dibuang setelahnya.

### Kenapa `DATABASE_URL` diset di level job

`npm ci` menjalankan `postinstall` → `prisma generate`, dan `prisma.config.ts` memanggil `env("DATABASE_URL")`, yang gagal kalau variabel itu tidak ada. Langkah ini berjalan **sebelum** `.env.test` dibuat, jadi `DATABASE_URL` harus sudah tersedia sebagai env job.

### Secret

**Tidak ada secret yang dibutuhkan.** Email dan Google di-mock di test, sehingga `SMTP_*`, `GOOGLE_CLIENT_ID`, dan `JWT_SECRET` di `.env.test` CI hanya nilai tiruan. Jangan pernah menaruh kredensial asli di file workflow.

### Melihat hasil

Buka tab **Actions** di repo GitHub. Setiap commit dan pull request mendapat tanda ✅ atau ❌. Klik run yang gagal untuk melihat log langkah yang bermasalah.

Untuk mencegah merge saat CI gagal: **Settings → Rules → Rulesets → New branch ruleset** untuk `main`, lalu aktifkan **Require status checks to pass** dan pilih check **Typecheck, test & build**.

### Kuota

Repo publik tidak dibatasi. Repo privat mendapat kuota gratis 2.000 menit per bulan, dan satu run project ini kira-kira memakan 1–2 menit.

### Menyesuaikan

| Kebutuhan | Ubah di `ci.yml` |
|---|---|
| Branch utama bukan `main` | `on.push.branches` |
| Menguji beberapa versi Node | Tambahkan `strategy.matrix.node: [20, 22, 24]` lalu ganti `node-version: 22` dengan `node-version: ${{ matrix.node }}` |
| Menambah variabel env yang wajib di `env.ts` | Tambahkan ke langkah **Create .env.test**. Kalau lupa, test gagal dengan `process.exit called with "1"` |
| Menambah langkah deploy | Buat job baru dengan `needs: test`, sehingga deploy hanya berjalan kalau test lulus |
