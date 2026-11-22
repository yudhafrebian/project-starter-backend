# 01 · Memulai

## Persyaratan

| Kebutuhan | Versi | Catatan |
|---|---|---|
| Node.js | **20.19+, 22.12+, atau 24+** | Syarat minimum Prisma 7 (`^20.19 \|\| ^22.12 \|\| >=24`). Node 20 versi lama (misalnya 20.10) tidak didukung. CI memakai Node 22 |
| npm | bawaan Node | |
| PostgreSQL | 14+ (Docker memakai 17) | Lewat Docker atau terinstall lokal |
| Docker | opsional | Untuk menjalankan PostgreSQL tanpa instalasi manual |
| Akun SMTP | opsional saat awal | Disarankan Brevo, lihat [12-email.md](12-email.md) |
| Google OAuth Client | opsional | Hanya jika memakai login Google, lihat [07-login-google.md](07-login-google.md) |

## Memulai project baru dari starter ini

```bash
git clone <url-repo-starter> nama-project
cd nama-project
rm -rf .git && git init
npm install
cp .env.example .env
```

Langkah `rm -rf .git && git init` membuat riwayat git baru, sehingga project baru tidak membawa riwayat commit starter.

`npm install` otomatis menjalankan `prisma generate` (script `postinstall`), sehingga Prisma Client langsung tersedia di `src/generated/prisma`.

### Jika npm memblokir install script

npm versi baru dapat memblokir install script paket. Jika muncul peringatan `install-scripts` untuk `prisma` atau `@prisma/engines`, jalankan:

```bash
npm install-scripts approve prisma @prisma/engines
npm rebuild prisma @prisma/engines
```

Tanpa ini, engine migrasi Prisma bisa tidak terunduh dan `prisma migrate` gagal.

## Menyiapkan database

### Opsi A: Docker (disarankan)

```bash
docker compose up -d
```

Ini menjalankan PostgreSQL 17 dengan:

| Setting | Nilai |
|---|---|
| Host | `localhost` |
| Port di komputer | **5433** (bukan 5432, supaya tidak bentrok dengan PostgreSQL yang mungkin sudah terinstall) |
| User / Password | `postgres` / `postgres` |
| Database | `starter_db` |

`DATABASE_URL` di `.env.example` sudah sesuai dengan setting ini. Data tersimpan di volume Docker `pgdata`, jadi tidak hilang saat container dimatikan. Untuk benar-benar menghapus data: `docker compose down -v`.

### Opsi B: PostgreSQL terinstall

Buat database (misalnya `starter_db`) lewat DBeaver, pgAdmin, atau psql (`CREATE DATABASE starter_db;`), lalu isi `DATABASE_URL`:

```
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/starter_db?schema=public"
```

Karakter khusus di password (`@`, `#`, `/`, `:`) harus di-URL-encode, misalnya `@` menjadi `%40`.

## Mengisi `.env`

Isi minimal agar server bisa menyala:

| Variabel | Cara mengisi |
|---|---|
| `DATABASE_URL` | Sesuai database di atas |
| `JWT_SECRET` | Minimal 32 karakter acak. Buat dengan: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `GOOGLE_CLIENT_ID` | Client ID dari Google Cloud. Jika belum memakai login Google, isi sementara dengan string apa pun (wajib tidak kosong) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Kredensial SMTP. Jika belum punya, isi nilai sementara; server tetap menyala, hanya email yang gagal terkirim (tercatat di log) |
| `SEED_SUPERADMIN_*` | Email, password (min. 12 karakter), dan nama super admin pertama |

Penjelasan lengkap setiap variabel ada di [02-konfigurasi.md](02-konfigurasi.md).

Jika ada variabel yang tidak valid, server langsung berhenti dengan pesan seperti:

```
Missing required env:
{ JWT_SECRET: [ 'JWT_SECRET must be at least 32 characters long' ] }
```

## Membuat tabel dan super admin

```bash
npm run db:migrate
npm run db:seed
```

- `db:migrate` menerapkan semua migrasi di `prisma/migrations/` lalu menjalankan `prisma generate`.
- `db:seed` membuat user `SUPER_ADMIN` dari variabel `SEED_SUPERADMIN_*`. Aman dijalankan berkali-kali, lihat [13-database.md](13-database.md#seed).

## Menjalankan server

```bash
npm run dev
```

Server berjalan di `http://localhost:4000` (atau sesuai `PORT`) dan otomatis restart saat file berubah. Saat start, log menampilkan:

```
project starter running on port 4000
SMTP ready            ← atau "SMTP not reachable" jika kredensial SMTP salah
```

Cek kesehatan server dan database:

```bash
curl http://localhost:4000/api/health
# {"ok":true,"db":"up"}
```

## Mencoba API

Import koleksi Postman `postman/auth-starter.postman_collection.json`. Di tab **Variables** koleksi, sesuaikan `baseUrl` dengan `PORT` server (default `http://localhost:4000`), isi `email` dan `password` dengan akun super admin dari seed, lalu jalankan request **Login** di folder **Sesi**. Detail di [15-testing.md](15-testing.md#postman).

## Daftar script npm

| Script | Fungsi |
|---|---|
| `npm run dev` | Server development dengan auto-reload (`tsx watch`) |
| `npm run build` | Kompilasi TypeScript ke `dist/` dan salin template email |
| `npm start` | Jalankan hasil build (`node dist/server.js`) |
| `npm run typecheck` | Cek tipe TypeScript tanpa menghasilkan file |
| `npm test` | Jalankan semua test otomatis |
| `npm run test:watch` | Test dalam mode watch |
| `npm run db:migrate` | Buat/terapkan migrasi (development) + generate client |
| `npm run db:generate` | Generate ulang Prisma Client |
| `npm run db:seed` | Buat/pastikan super admin |
| `npm run db:studio` | Buka Prisma Studio (lihat/edit data di browser) |
| `npm run db:push` | Sinkronkan skema tanpa membuat file migrasi (hanya untuk eksperimen) |
| `npm run db:reset` | ⚠️ Hapus seluruh data, terapkan ulang semua migrasi, lalu jalankan seed |
| `npm run db:deploy` | Terapkan migrasi di production (tanpa membuat migrasi baru) |
| `npm run postman:generate` | Generate ulang koleksi Postman dari `scripts/generate-postman.js` |

## Checklist saat memulai project baru

Hal-hal yang membawa identitas starter dan perlu diganti:

- [ ] `name`, `description`, `author` di `package.json`
- [ ] `APP_NAME` di `.env`. **Perhatikan juga default di `src/config/env.ts`** (saat ini `"Vlairwitch App"`), ganti ke nama project baru
- [ ] `MAIL_FROM` dengan domain project baru
- [ ] `WEB_ORIGIN` dengan URL frontend project baru
- [ ] `POSTGRES_DB` di `docker-compose.yaml` dan nama database di `DATABASE_URL`
- [ ] `JWT_SECRET` baru (jangan pernah memakai ulang secret antar project)
- [ ] OAuth Client Google baru, dengan Authorized JavaScript origins = URL frontend project baru
- [ ] Sender dan domain di Brevo (atau penyedia SMTP lain)
- [ ] Nama koleksi dan default `baseUrl` Postman di `scripts/generate-postman.js`, lalu `npm run postman:generate` (opsional)
- [ ] Tinjau daftar [fitur opsional](18-mengembangkan.md#fitur-opsional) yang mungkin dibutuhkan project ini
