# 15 · Testing

## Test otomatis

### Strategi

**Integration test**: request HTTP sungguhan ke aplikasi lewat Supertest, dengan **database PostgreSQL sungguhan** khusus test. Pendekatan ini menguji alur nyata: middleware, cookie, transaksi database, dan validasi.

| Bagian | Perlakuan |
|---|---|
| Database | Asli (`starter_db_test`), dikosongkan sebelum setiap test |
| Email | Di-mock. Tidak ada yang terkirim. Email ditangkap, dan token diambil dari isinya |
| Google | Di-mock per file test (`verifyGoogleIdToken` mengembalikan profil palsu) |
| Rate limit | Otomatis dilewati saat `NODE_ENV=test` |
| bcrypt | Cost 4 (bukan 12) supaya cepat |
| Cookie | `supertest.agent()` menyimpan cookie antar request, seperti browser |

### Menjalankan

```bash
npm test                                   # semua test
npm run test:watch                         # mode watch
npx jest --runInBand tests/admin.test.ts   # satu file (lihat catatan flag di bawah)
```

Untuk menjalankan satu file, pakai perintah lengkap dengan flag yang sama seperti script `test`:

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/admin.test.ts
```

### Persiapan pertama kali

1. Buat database test, misalnya `starter_db_test`. **Nama database wajib mengandung kata `test`.**
2. Buat `.env.test` di root project (file ini di-`.gitignore`):

   ```bash
   NODE_ENV=test
   PORT=4001
   APP_NAME="Starter Test"
   WEB_ORIGIN=http://localhost:3000
   TRUST_PROXY=0

   DATABASE_URL="postgresql://postgres:PASSWORD@localhost:5432/starter_db_test?schema=public"

   JWT_SECRET=test-secret-yang-panjangnya-minimal-tiga-puluh-dua-karakter
   GOOGLE_CLIENT_ID=test-google-client-id.apps.googleusercontent.com

   SMTP_HOST=localhost
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=test
   SMTP_PASS=test
   MAIL_FROM="Starter Test <no-reply@test.local>"
   ```

   - Variabel SMTP tidak dipakai (mailer di-mock), tetapi wajib ada supaya validasi env lolos.
   - `PORT` wajib bilangan positif (bukan `0`). Server tidak benar-benar dinyalakan, karena Supertest memakai `app` langsung.

3. `npm test`. Migrasi otomatis diterapkan ke database test.

### Pengaman database

Test **menolak berjalan** kalau nama database di `DATABASE_URL` tidak mengandung kata `test`. Pengecekan ini ada di dua tempat: `tests/setup/global-setup.ts` (sebelum migrasi) dan `tests/helpers/db.ts` (sebelum mengosongkan tabel). Database development tidak mungkin terhapus oleh test.

### Konfigurasi Jest

`jest.config.js`:

| Opsi | Nilai | Fungsi |
|---|---|---|
| `roots` / `testMatch` | `tests/`, `**/*.test.ts` | Lokasi test |
| `transform` | `ts-jest` dengan `tsconfig.test.json` | Mengompilasi TypeScript |
| `moduleNameMapper` | `^(\.{1,2}/.*)\.js$` → `$1` | Prisma Client hasil generate meng-import `./x.js` padahal file aslinya `./x.ts`. `tsx` dan `tsc` memahami konvensi ini, Jest tidak, jadi akhiran `.js` pada import relatif dibuang |
| `setupFiles` | `tests/setup/env.ts` | Memuat `.env.test` **sebelum** kode aplikasi di-import |
| `setupFilesAfterEnv` | `tests/setup/mocks.ts` | Mock mailer untuk semua file test |
| `globalSetup` | `tests/setup/global-setup.ts` | `prisma migrate deploy` ke database test, sekali sebelum semua test |
| `clearMocks` | `true` | Riwayat mock (email "terkirim") direset sebelum setiap test |
| `testTimeout` | `20000` | 20 detik per test |

Script `test` di `package.json`:

```
node --experimental-vm-modules --no-warnings=ExperimentalWarning node_modules/jest/bin/jest.js --runInBand
```

- `--experimental-vm-modules`: Prisma 7 memuat query engine-nya dengan `import()` dinamis, dan sandbox Jest hanya mengizinkannya dengan flag ini.
- `--no-warnings=ExperimentalWarning`: menyembunyikan peringatan fitur eksperimental.
- `--runInBand`: menjalankan file test **satu per satu**. Ini wajib, karena semua test memakai satu database. Kalau berjalan paralel, test saling menghapus data.

### Cara `.env.test` dimuat

`tests/setup/env.ts` memanggil `dotenv.config({ path: ".env.test", override: true })` sebelum kode aplikasi dimuat. Setelah itu, `dotenv.config()` di `src/config/env.ts` **tidak** menimpa nilai-nilai tersebut, karena dotenv tidak menimpa variabel yang sudah ada.

### Struktur

```
tests/
  setup/
    env.ts              Memuat .env.test
    global-setup.ts     Migrasi database test + pengaman nama database
    mocks.ts            Mock mailer (berlaku untuk semua file)
  helpers/
    db.ts               resetDb(), createUser(), DEFAULT_PASSWORD
    http.ts             agent(), raw(), loginAs(), getCookie(), csrf
    mail.ts             sentEmails(), emailsTo(), lastEmailTo(), extractToken()
  auth.session.test.ts
  auth.register.test.ts
  auth.password.test.ts
  auth.google.test.ts
  auth.profile.test.ts
  admin.test.ts
```

### Helper

| Helper | Fungsi |
|---|---|
| `resetDb()` | `TRUNCATE` semua tabel aplikasi. Dipanggil di `beforeEach` |
| `createUser(overrides?)` | Membuat user langsung di DB. Default: `user@test.com`, password `DEFAULT_PASSWORD`, role `USER`, aktif, terverifikasi. `password: null` = user tanpa password; `verified: false` = belum terverifikasi |
| `agent()` | "Browser": menyimpan cookie dan sudah membawa header CSRF |
| `raw()` | Request tanpa cookie jar dan tanpa header CSRF (untuk mengirim cookie atau header secara manual) |
| `loginAs(email, password?)` | Login, lalu mengembalikan `{ agent, res }`. Melempar error kalau login gagal |
| `getCookie(res, name)` | Membaca nilai cookie dari header `Set-Cookie` |
| `sentEmails()` / `emailsTo(to)` / `lastEmailTo(to)` | Membaca email yang "terkirim" |
| `extractToken(mail)` | Mengambil token dari link `?token=...` di versi teks email |

### Cakupan (88 test)

| File | Yang diuji |
|---|---|
| `auth.session.test.ts` | Login (sukses, salah password, email tidak ada → error identik, belum verifikasi, nonaktif, Google-only, normalisasi email, validasi), CSRF, Bearer token, token palsu, refresh rotation, hash token di DB, deteksi reuse, masa toleransi, refresh kedaluwarsa, user nonaktif, logout, logout per perangkat, logout semua perangkat |
| `auth.register.test.ts` | Alur register–verifikasi–login, token sekali pakai, kedaluwarsa, token asal, escape nama di email, email sudah terdaftar (respons identik, password tidak berubah), pre-account takeover, normalisasi email, `role` diabaikan, batas password (12 karakter, 72 byte, multibyte), resend (tidak terdaftar, sudah terverifikasi, cooldown, setelah cooldown) |
| `auth.password.test.ts` | Alur reset lengkap (sesi dicabut, email notifikasi), token sekali pakai, kedaluwarsa, respons identik untuk email tidak terdaftar, user nonaktif, cooldown, token verifikasi tidak bisa dipakai untuk reset, reset memverifikasi email, Google-only membuat password, change password (perangkat lain ter-logout, password salah, sama dengan lama, tanpa login) |
| `auth.google.test.ts` | User baru, login kedua tanpa duplikat, email Google berubah, nama kosong, penautan ke user terverifikasi (password tetap), penautan ke user belum terverifikasi (password dihapus, link lama mati), konflik 409, nonaktif, token tidak valid, body kosong |
| `auth.profile.test.ts` | `GET /me` (password & Google-only, tanpa `passwordHash`), `PATCH /me` (nama, avatar, hapus avatar, URL berbahaya, body kosong, nama spasi, `role` diabaikan, tanpa login) |
| `admin.test.ts` | 401/403/200, role diturunkan langsung kehilangan akses, tanpa `passwordHash`, pencarian, pagination, batas `pageSize`, nonaktif/aktifkan (sesi langsung mati), tidak bisa mengubah diri sendiri / super admin lain, 404, id bukan UUID, body tidak valid, user biasa tidak bisa memakai endpoint |

### Teknik yang dipakai

- **Mensimulasikan waktu tanpa menunggu:** daripada `sleep`, test mengubah kolom waktu di DB. Contohnya, `revokedAt` dimundurkan 1 menit untuk menguji deteksi reuse di luar masa toleransi, atau `expiresAt` dimundurkan untuk menguji token kedaluwarsa.
- **Mengirim cookie lama secara manual:** `raw().post(...).set("Cookie", "refresh_token=...")`.
- **Mock per file:** `jest.mock("../src/lib/google", ...)` lalu `jest.mocked(verifyGoogleIdToken).mockResolvedValueOnce(profil)`.
- **Respons error:** dibaca dari `res.body.error.code`. Respons sukses dibaca dari `res.body.code`.

### Menulis test baru

```ts
import { prisma } from "../src/config/prisma";
import { createUser, resetDb } from "./helpers/db";
import { agent, loginAs } from "./helpers/http";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("fitur baru", () => {
  it("melakukan sesuatu", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: a } = await loginAs("a@test.com");

    const res = await a.post("/api/v1/fitur").send({ ... });
    expect(res.status).toBe(200);
  });
});
```

Saat menambah tabel baru, tambahkan nama tabelnya ke query `TRUNCATE` di `tests/helpers/db.ts`.

### Di CI

Semua test juga dijalankan otomatis oleh GitHub Actions setiap push ke `main` dan setiap pull request, memakai PostgreSQL di service container. Workflow membuat `.env.test` sendiri, jadi tidak ada secret yang dibutuhkan. Kalau kamu menambah variabel env wajib baru di `src/config/env.ts`, tambahkan juga ke langkah **Create .env.test** di `.github/workflows/ci.yml`. Detail di [16-deployment.md](16-deployment.md#ci-github-actions).

### Typecheck untuk file test

`npm run typecheck` hanya memeriksa `src/`. Untuk memeriksa file test juga:

```bash
npx tsc --noEmit -p tsconfig.test.json
```

---

## Postman

Koleksi: `postman/auth-starter.postman_collection.json`. Isinya 27 request dalam 6 folder, dan **semua endpoint API** sudah tercakup.

### Generate ulang koleksi

File koleksi **dihasilkan oleh script**, bukan ditulis tangan:

```bash
npm run postman:generate
```

Sumbernya ada di `scripts/generate-postman.js`. Saat menambah atau mengubah endpoint, ubah script itu (bukan file JSON-nya), lalu generate ulang. Perubahan yang dibuat langsung di file JSON akan tertimpa pada generate berikutnya.

Di dalam script:

| Bagian | Fungsi |
|---|---|
| `req(name, method, path, opts)` | Membuat satu request. `opts`: `body`, `query`, `headers`, `description`, `pre` (script pre-request), `test` (script test), `disableCookies` |
| `status(code)`, `okCode(code)`, `errCode(code)` | Potongan script test siap pakai: cek status HTTP, `code` sukses, dan `error.code` |
| `saveRefresh` | Menyimpan refresh token terbaru ke variable (untuk uji reuse) |
| `tokenFromUrl(variable)` | Mengambil token dari URL lengkap yang ditempel ke variable |
| `collection.variable` | Daftar variable koleksi dan nilai default-nya |

Setelah generate ulang, import lagi ke Postman dan pilih **Replace**.

### Import

Postman → **Import** → pilih file. Kalau koleksi dengan nama yang sama sudah ada, pilih **Replace**. Nilai variable akan kembali ke default, jadi isi ulang.

### Variable koleksi

| Variable | Isi | Diisi |
|---|---|---|
| `baseUrl` | `http://localhost:4000`. **Sesuaikan dengan `PORT` di `.env`** | Manual |
| `email`, `password` | Akun yang sudah terverifikasi. Untuk folder Admin, akun ini harus `SUPER_ADMIN` (misalnya hasil `npm run db:seed`) | Manual |
| `newPassword` | Password baru untuk Change Password. Ditukar otomatis dengan `password` setelah berhasil | Manual |
| `registerName`, `registerEmail`, `registerPassword` | Untuk uji register. `registerEmail` sebaiknya email asli yang inbox-nya bisa dibuka | Manual |
| `verificationToken` | Link dari email verifikasi (boleh seluruh URL; token diambil otomatis) | Manual |
| `resetToken` | Link dari email reset password (boleh seluruh URL) | Manual |
| `resetNewPassword` | Password baru untuk Reset Password. Ditukar otomatis dengan `registerPassword` setelah berhasil | Manual |
| `googleIdToken` | ID token dari OAuth Playground ([07-login-google.md](07-login-google.md#testing-tanpa-frontend-google-oauth-playground)) | Manual |
| `profileName`, `avatarUrl` | Nilai untuk uji update profil. `avatarUrl` wajib `https` | Manual (ada default) |
| `adminSearch` | Kata kunci pencarian `GET /admin/users`. Aktifkan parameter `search` di tab Params kalau ingin dipakai | Manual |
| `targetUserId` | Id user yang akan dinonaktifkan/diaktifkan | **Otomatis** oleh List Users |
| `currentRefreshToken`, `previousRefreshToken` | Untuk uji reuse refresh token | **Otomatis** |

Header `X-Requested-With` dipasang otomatis di level koleksi. Cookie disimpan otomatis oleh Postman.

**Satu sesi aktif.** Postman hanya menyimpan satu set cookie per domain. Login di folder mana pun (sebagai admin, user biasa, atau lewat Google) **mengganti** sesi sebelumnya. Perhatikan akun mana yang terakhir login sebelum menjalankan request yang butuh login.

### Folder

| Folder | Request | Catatan |
|---|---|---|
| (root) | Health | Cek server dan database |
| Register & Verifikasi | Register → Login (Belum Verifikasi, harus 403) → Verify Email → Resend Verification → Login (Akun Baru) | Memakai `register*` |
| Sesi | Login, Me, Refresh, Refresh – Reuse Token Lama, Logout, Logout All Devices | Memakai `email`/`password` |
| Login Google | Login Google, Login Google – Token Palsu (harus 401) | Butuh `googleIdToken` |
| Lupa Password | Forgot Password → Reset Password | Memakai `registerEmail`, supaya akun admin tidak ikut ter-reset |
| Akun & Profil | Update Profil – Nama, – Avatar, – Hapus Avatar, – Avatar Tidak Aman (harus 400), Change Password | Butuh login |
| Admin | Login sebagai Admin → List Users → List Users – Tanpa Akses (harus 403) → Nonaktifkan User → Aktifkan User → Update Status – ID Tidak Valid (harus 400) | Butuh akun `SUPER_ADMIN` |

Setiap request punya test sederhana (status code, kode respons, dan sebagainya) yang hasilnya terlihat di tab **Test Results**. Request yang menyimpan atau membaca variable menampilkan keterangan di **Postman Console** (View → Show Postman Console).

### Uji folder Admin

1. **Login sebagai Admin**. Test-nya memastikan role yang login adalah `SUPER_ADMIN`.
2. **List Users** menyimpan id user pertama yang bukan `SUPER_ADMIN` ke `targetUserId`. Kalau belum ada user lain, jalankan dulu folder Register & Verifikasi.
3. **Nonaktifkan User** → `active: false`. Sesi user itu langsung mati. Untuk membuktikannya: login sebagai user tersebut (Login (Akun Baru)) **sebelum** langkah ini, lalu setelah dinonaktifkan jalankan **Me**, dan hasilnya 401. Ingat, login sebagai user lain mengganti sesi admin di Postman, jadi login ulang sebagai admin sebelum langkah berikutnya.
4. **Aktifkan User** → `active: true`.
5. **List Users – Tanpa Akses**: jalankan saat sedang login sebagai user biasa. Hasilnya harus 403.

### Uji deteksi pencurian di Postman

Login → Refresh → **tunggu lebih dari 10 detik** → **Refresh – Reuse Token Lama**. Hasilnya harus 401. Setelah itu, Refresh biasa juga 401, karena seluruh sesi sudah dicabut. Request reuse mematikan cookie jar Postman, supaya yang terkirim benar-benar token lama.

Rate limit `emailLimiter` (5 per 15 menit, gabungan register/resend/forgot) mudah terlampaui saat testing manual. Restart server untuk mereset hitungannya.
