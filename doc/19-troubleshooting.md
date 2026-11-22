# 19 · Troubleshooting

Kumpulan masalah yang pernah terjadi selama membangun starter ini, beserta solusinya.

## Instalasi & Prisma

### `Module "prisma/config" has no exported member 'defineConfig'`
**Penyebab:** versi CLI `prisma` berbeda dengan `@prisma/client`. Pernah terjadi dengan `prisma@8.0.0-rc` dan `@prisma/client@7.10.1`. CLI versi 8 RC adalah paket yang berbeda dan tidak mengekspor `defineConfig`.
**Solusi:** samakan versinya, misalnya `npm install -D prisma@7.10.1`.

### `npm install` gagal: `EBUSY: resource busy or locked, rename ... node_modules\prisma`
**Penyebab:** folder sedang dipakai proses lain (terminal yang `cd` ke dalamnya, server TypeScript di editor, atau server dev yang sedang berjalan).
**Solusi:** keluar dari folder itu, hentikan `npm run dev`, lalu ulangi. Kalau masih gagal, restart editor.

### Peringatan `npm warn install-scripts ... prisma ... @prisma/engines`
**Penyebab:** npm memblokir install script paket.
**Solusi:**
```bash
npm install-scripts approve prisma @prisma/engines
npm rebuild prisma @prisma/engines
```

### `PrismaConfigEnvError: Cannot resolve environment variable: DATABASE_URL`
**Penyebab:** `.env` belum ada atau `DATABASE_URL` kosong. `prisma.config.ts` membutuhkannya untuk **semua** perintah Prisma, termasuk `generate`.
**Solusi:** buat `.env` dari `.env.example`.

### TypeScript tidak protes, tapi aplikasi error "column does not exist"
**Penyebab:** Prisma Client usang. Sejak Prisma 7, `migrate dev` **tidak** otomatis menjalankan `generate`.
**Solusi:** `npx prisma generate`, atau selalu pakai `npm run db:migrate` (sudah menggabungkan keduanya).

### `migrate status` bilang "up to date", tapi kolom tidak ada di database
**Penyebab:** skema diubah tanpa membuat migrasi baru. `migrate status` hanya memeriksa apakah file migrasi sudah diterapkan.
**Solusi:** cek *drift*:
```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```
Kalau ada isinya, jalankan `npm run db:migrate`.

### Migrasi menghapus kolom (data hilang)
**Penyebab:** field dihapus dari skema, misalnya `role` pernah terhapus tanpa sengaja saat model `User` ditulis ulang. Prisma membuat `DROP COLUMN`.
**Solusi:** selalu baca `migration.sql` sebelum diterapkan. Kalau perlu, buat migrasi dengan `--create-only` lalu edit dulu.

### Mengganti nama nilai enum gagal dimigrasi
Lihat [13-database.md](13-database.md#mengganti-nama-nilai-enum-tanpa-kehilangan-data).

### Nama folder migrasi salah ketik
**Contoh:** `20261121075427_add_user_rolenpx`. Dua perintah ikut tertempel dalam satu baris.
**Solusi:** **biarkan saja.** Nama folder tercatat di `_prisma_migrations`. Kalau di-rename, Prisma menganggapnya migrasi baru. Rename hanya aman di database development yang boleh direset (`npm run db:reset`).

## TypeScript

### `No overload matches this call` di `pino({ transport: ... : undefined })`
**Penyebab:** opsi `exactOptionalPropertyTypes: true` membedakan "properti tidak ada" dari "properti bernilai `undefined`". Tipe opsi pino tidak menerima `transport: undefined`.
**Solusi:** opsi tersebut sekarang tidak aktif di `tsconfig.json`. Kalau ingin mengaktifkannya lagi, tulis properti secara kondisional:
```ts
...(env.NODE_ENV === "development" && { transport: { target: "pino-pretty", options: { colorize: true } } })
```

### Tipe di `src/types/express.d.ts` diam-diam menjadi `any`
**Penyebab:** `skipLibCheck: true` melewati pemeriksaan semua file `.d.ts`, termasuk milik sendiri. Pernah terjadi: file itu meng-import `Role` dari file yang sudah dihapus, dan tidak ada error yang muncul.
**Solusi:** periksa file deklarasi secara manual saat mengubahnya. `Role` di-import dari `../generated/prisma/enums`.

### `Namespace ... has no exported member 'SessionMeta'`
**Penyebab:** tipe dipindah ke `auth.types.ts`, tapi masih diakses lewat `authService.SessionMeta`.
**Solusi:** import langsung dari `./auth.types`.

## Server

### `Missing required env: { PORT: [ 'Too small: expected number to be >0' ] }`
**Penyebab:** `PORT=0`.
**Solusi:** pakai angka positif.

### Server gagal start: variabel opsional kosong
**Penyebab:** baris seperti `GOOGLE_CLIENT_SECRET=` (kosong). Aturan `min(1).optional()` menerima variabel yang tidak ada, tapi menolak string kosong.
**Solusi:** hapus baris itu dari `.env`.

### `npm run dev` gagal di Mac/Linux
**Penyebab (dulu):** script memakai `cls &&`, yang hanya ada di Windows.
**Solusi:** sudah dihapus dari script.

### Error `ENOENT ... emails/templates/...` saat start
**Penyebab:** template tidak ada di lokasi yang dibaca. Biasanya karena `dist/` dibuat tanpa `scripts/copy-assets.js`, atau di Vercel tanpa `includeFiles`.
**Solusi:** gunakan `npm run build` (bukan `tsc` langsung). Di Vercel, pastikan `vercel.json` ada.

### `npm run build` gagal: `tsconfig.build.json` tidak ditemukan
**Solusi:** file itu harus ada (mewarisi `tsconfig.json` dan mengecualikan test).

### Mendapat 429 terus saat testing manual
**Penyebab:** `emailLimiter` hanya mengizinkan 5 request per 15 menit, **gabungan** register, resend, dan forgot password.
**Solusi:** restart server (hitungan disimpan di memori).

### Semua request POST mendapat `403 csrf_blocked`
**Penyebab:** header `X-Requested-With` tidak dikirim.
**Solusi:** tambahkan header itu ke semua request non-GET.

### Cookie tidak tersimpan / selalu 401 di browser
**Penyebab umum:**
- Frontend tidak memakai `credentials: "include"`.
- Origin frontend berbeda dengan `WEB_ORIGIN`, sehingga CORS menolak.
- Frontend dan backend berada di situs yang berbeda (*cross-site*), sehingga cookie `sameSite=lax` tidak dikirim. Lihat [16-deployment.md](16-deployment.md#frontend-dan-backend-di-domain-berbeda).
- `NODE_ENV=production` tapi diakses lewat `http`, sehingga cookie `secure` tidak disimpan browser.

## Email

### Email tidak masuk
Periksa berurutan:
1. Log server saat start: `SMTP ready` atau `SMTP not reachable`?
2. Log saat mengirim: ada `failed to send email`?
3. **Brevo → Transactional → Logs**: statusnya *delivered*, *blocked*, atau *bounce*?
4. Folder **Spam** dan tab Promotions/Updates di Gmail.

| Gejala | Penyebab |
|---|---|
| `Invalid login` / `535` | `SMTP_USER` diisi email akun (seharusnya login SMTP), atau `SMTP_PASS` diisi API key (seharusnya SMTP key) |
| SMTP OK, tapi email *blocked* | `MAIL_FROM` bukan sender terverifikasi |
| `SMTP account is not yet activated` | Akun Brevo baru perlu diaktivasi atau dilengkapi profilnya |
| `ETIMEDOUT` / `ECONNREFUSED` | Port 587 diblokir jaringan. Coba port `2525` atau jaringan lain |

### Email masuk spam
Lihat [12-email.md](12-email.md#deliverability-supaya-tidak-masuk-spam). Saat development, link `http://localhost` adalah penyebab terbesar.

### Email "akun sudah ada" tampil tanpa layout
**Penyebab (pernah terjadi):** isi `account-exists.html.hbs` dan `account-exists.text.hbs` tertukar.
**Solusi:** pastikan file `.html.hbs` berisi HTML dengan `{{#> layout}}`, dan `.text.hbs` berisi teks biasa.

### Link di HTML email tertulis `?token&#x3D;...`
Ini **normal**. Handlebars meng-escape `=` di HTML, dan browser membacanya kembali sebagai `=`.

## Login Google

| Gejala | Penyebab |
|---|---|
| `invalid_google_token` padahal token baru | `GOOGLE_CLIENT_ID` berbeda dengan Client ID yang menerbitkan token (audience salah) |
| `invalid_google_token` setelah beberapa waktu | ID token hanya berlaku 1 jam |
| `redirect_uri_mismatch` di OAuth Playground | `https://developers.google.com/oauthplayground` belum ditambahkan ke Authorized redirect URIs |
| Tombol Google tidak muncul / error origin | Origin frontend belum terdaftar di Authorized JavaScript origins (tanpa path, tanpa `/` di akhir) |
| Perubahan di Console belum berlaku | Tunggu beberapa menit |

## Test

### `Cannot find module './internal/class.js' from 'src/generated/prisma/client.ts'`
**Penyebab:** Prisma Client meng-import file `.ts` dengan akhiran `.js`.
**Solusi:** `moduleNameMapper` di `jest.config.js` (sudah dikonfigurasi).

### `A dynamic import callback was invoked without --experimental-vm-modules`
**Penyebab:** Prisma 7 memakai `import()` dinamis.
**Solusi:** jalankan Jest lewat `node --experimental-vm-modules ...`. Script `npm test` sudah memakai flag ini.

### `process.exit called with "1"` di awal test
**Penyebab:** validasi env gagal, karena ada variabel yang kurang di `.env.test`. Jalankan pengecekan untuk melihat field yang salah:
```bash
npx tsx -e "require('dotenv').config({path:'.env.test',override:true}); require('./src/config/env')"
```

### `DATABASE_URL harus mengarah ke database test`
Pengaman bekerja sebagaimana mestinya. Nama database di `.env.test` harus mengandung kata `test`.

### CI gagal di langkah `npm ci`
| Pesan | Penyebab |
|---|---|
| `npm ci can only install packages when your package.json and package-lock.json are in sync` | `package.json` diubah tanpa memperbarui lockfile. Jalankan `npm install` di lokal, lalu commit `package-lock.json` |
| `Cannot resolve environment variable: DATABASE_URL` | `DATABASE_URL` di level job pada `ci.yml` terhapus. `prisma generate` (postinstall) membutuhkannya |
| `EBADENGINE` / error engine Prisma | Versi Node di `ci.yml` di bawah syarat Prisma 7 (`^20.19 \|\| ^22.12 \|\| >=24`) |

### CI lulus di lokal tapi gagal di GitHub Actions
- Variabel env wajib baru belum ditambahkan ke langkah **Create .env.test** di `ci.yml`, sehingga muncul `process.exit called with "1"`.
- Nama file berbeda huruf besar/kecil. Windows tidak membedakan `Mailer.ts` dan `mailer.ts`, tapi Linux di CI membedakannya.
- Kode bergantung pada perintah khusus Windows (misalnya `cls`).

### Test saling memengaruhi / gagal acak
**Penyebab:** test dijalankan paralel.
**Solusi:** selalu pakai `--runInBand` (sudah ada di script).
