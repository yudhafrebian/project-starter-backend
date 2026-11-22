# 13 · Database

PostgreSQL diakses lewat **Prisma 7** dengan driver adapter `@prisma/adapter-pg`.

## Diagram relasi

```
User 1 ──── * RefreshToken        (sesi login, per perangkat)
User 1 ──── * OAuthAccount        (akun Google/provider lain yang tertaut)
User 1 ──── * VerificationToken   (token verifikasi email & reset password)
```

Semua relasi memakai `onDelete: Cascade`. Menghapus user otomatis menghapus semua token dan akun OAuth-nya.

## Tabel

### `User`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | UUID (`@db.Uuid`) | Primary key, dibuat otomatis |
| `email` | String, **unique** | Selalu disimpan dalam huruf kecil (dinormalisasi oleh validasi) |
| `emailVerifiedAt` | DateTime? | `null` = belum terverifikasi. Bertipe tanggal, bukan boolean, supaya juga tercatat **kapan** email diverifikasi |
| `name` | String | |
| `avatarUrl` | String? | URL `https` |
| `passwordHash` | String? | Hash bcrypt. `null` = user tanpa password (Google-only) |
| `active` | Boolean, default `true` | `false` = tidak bisa login, dan semua sesinya mati |
| `role` | `Role`, default `USER` | |
| `createdAt` / `updatedAt` | DateTime | Otomatis |

### `RefreshToken`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | cuid | |
| `tokenHash` | String, **unique** | SHA-256 hex dari token (64 karakter). Token aslinya tidak pernah disimpan |
| `familyId` | String, index | Sama untuk semua token hasil rotasi dari satu kali login |
| `userId` | UUID, index | |
| `userAgent` | String? | Dipotong maksimal 512 karakter |
| `ip` | String? | Dari `req.ip` (dipengaruhi `TRUST_PROXY`) |
| `expiresAt` | DateTime | 30 hari sejak token dibuat |
| `revokedAt` | DateTime? | `null` = masih aktif |
| `createdAt` | DateTime | |

Detail cara kerjanya: [04-autentikasi-sesi.md](04-autentikasi-sesi.md).

### `OAuthAccount`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | cuid | |
| `provider` | `OAuthProvider` | Saat ini hanya `GOOGLE` |
| `providerAccountId` | String | `sub` dari Google, ID yang **tidak pernah berubah** |
| `email` | String? | Email di provider saat akun ditautkan. Hanya informasi |
| `userId` | UUID | |
| `createdAt` / `updatedAt` | DateTime | |

Constraint:
- `@@unique([provider, providerAccountId])`: satu akun Google hanya bisa tertaut ke satu user.
- `@@unique([userId, provider])`: satu user hanya bisa punya satu akun Google. Hapus constraint ini kalau ingin mengizinkan lebih dari satu.

Token akses dan refresh dari Google **tidak disimpan**, karena Google hanya dipakai untuk login, bukan untuk mengakses API Google. Data yang tidak disimpan tidak bisa bocor.

### `VerificationToken`

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | cuid | |
| `type` | `VerificationTokenType` | `EMAIL_VERIFICATION` atau `PASSWORD_RESET` |
| `tokenHash` | String, **unique** | SHA-256 hex |
| `userId` | UUID | |
| `expiresAt` | DateTime | Verifikasi: +24 jam. Reset: +60 menit |
| `usedAt` | DateTime? | Diisi saat dipakai **atau** saat dimatikan karena token baru dibuat |
| `createdAt` | DateTime | Dipakai untuk cooldown kirim ulang (60 detik) |

Index `@@index([userId, type])` mempercepat pencarian token terbaru per user per tipe.

Satu tabel generik untuk dua kegunaan, karena strukturnya identik. Menambah jenis token baru (misalnya untuk ganti email) cukup dengan menambah nilai enum.

## Enum

| Enum | Nilai |
|---|---|
| `Role` | `SUPER_ADMIN`, `USER` |
| `OAuthProvider` | `GOOGLE` |
| `VerificationTokenType` | `EMAIL_VERIFICATION`, `PASSWORD_RESET` |

## Prisma 7: hal yang berbeda dari versi sebelumnya

| Hal | Prisma 7 |
|---|---|
| URL database | Ditulis di `prisma.config.ts`, **bukan** di `schema.prisma` |
| Generator | `provider = "prisma-client"` dengan `output` wajib. Client di-import dari `src/generated/prisma/client`, bukan dari `@prisma/client` |
| Driver | Wajib driver adapter (`new PrismaPg({ connectionString })`) |
| `migrate dev` | **Tidak** otomatis menjalankan `generate`. Script `db:migrate` sudah menggabungkan keduanya |
| `.env` | Tidak dimuat otomatis oleh CLI. `prisma.config.ts` meng-import `dotenv/config` |
| Versi | `prisma` (CLI) dan `@prisma/client` **harus** versi yang sama |

## Alur kerja migrasi

### Development

1. Ubah `prisma/schema.prisma`.
2. Jalankan:
   ```bash
   npm run db:migrate
   ```
   Prisma akan meminta nama migrasi (atau berikan dengan `npx prisma migrate dev --name nama_perubahan`), membuat folder `prisma/migrations/<timestamp>_<nama>/migration.sql`, menerapkannya, lalu menjalankan `generate`.
3. Commit folder migrasi tersebut.

### Production

```bash
npm run db:deploy
```

Hanya menerapkan migrasi yang belum diterapkan. Tidak membuat migrasi baru dan tidak pernah mereset data.

### Aturan penting

- **Jangan mengedit atau me-rename migrasi yang sudah diterapkan.** Nama folder dan checksum isinya tercatat di tabel `_prisma_migrations`. Kalau diubah, Prisma menganggapnya migrasi baru atau mendeteksi perubahan, lalu meminta reset. Contoh nyata di project ini: migrasi `20261121075427_add_user_rolenpx` memiliki typo (`npx` ikut tertulis di nama), dan sengaja **dibiarkan** apa adanya.
- **Jangan menghapus tabel `_prisma_migrations`.**
- **`migrate status` hanya memeriksa** apakah semua file migrasi sudah diterapkan. Perintah ini **tidak** membandingkan skema dengan isi database. Untuk mendeteksi perbedaan (*drift*):
  ```bash
  npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
  ```
  Hasil `-- This is an empty migration.` berarti database sinkron dengan skema.
- **Hati-hati saat menghapus field.** Menghapus field dari skema menghasilkan `DROP COLUMN`, dan datanya hilang. Selalu baca `migration.sql` sebelum menerapkannya ke data penting.

### Mengganti nama nilai enum tanpa kehilangan data

Kalau nilai enum diganti langsung di skema, Prisma membuat migrasi "hapus nilai lama, tambah nilai baru". Migrasi itu gagal kalau masih ada baris yang memakai nilai lama. Cara yang benar (pernah dipakai untuk `GUEST` → `USER`):

1. Ubah nama di `schema.prisma`, termasuk `@default(...)` kalau ada.
2. Buat migrasi **tanpa** menjalankannya:
   ```bash
   npx prisma migrate dev --create-only --name rename_x_to_y
   ```
3. Ganti seluruh isi `migration.sql` dengan:
   ```sql
   ALTER TYPE "Role" RENAME VALUE 'GUEST' TO 'USER';
   ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';
   ```
4. Jalankan `npm run db:migrate`.

## Riwayat migrasi

| Migrasi | Isi |
|---|---|
| `20261121055121_init` | Tabel `User` (dengan `username`) dan `RefreshToken` |
| `20261121074456_add_email_oauth` | Email menjadi identitas utama, `passwordHash` opsional, tabel `OAuthAccount` |
| `20261121075427_add_user_rolenpx` | Mengembalikan kolom `role` (nama folder mengandung typo, sengaja dibiarkan) |
| `20261121134847_refresh_token_family` | `familyId`, `userAgent`, `ip` di `RefreshToken` |
| `20261122034529_verification_token` | Tabel `VerificationToken` dan enum-nya |
| `20261122112116_rename_guest_to_user` | Rename nilai enum `GUEST` → `USER` |

Project baru yang memakai starter ini bisa mempertahankan riwayat migrasi ini, atau, **sebelum** ada data production, menyederhanakannya menjadi satu migrasi awal: hapus folder `prisma/migrations`, lalu jalankan `npx prisma migrate dev --name init` pada database kosong.

## Seed

`prisma/seed.ts` membuat super admin dari env `SEED_SUPERADMIN_EMAIL`, `SEED_SUPERADMIN_PASSWORD`, dan `SEED_SUPERADMIN_NAME`.

```bash
npm run db:seed
```

Seed juga dijalankan otomatis oleh `npm run db:reset` (`prisma migrate reset`), sesuai `migrations.seed` di `prisma.config.ts`.

**Idempotent**, jadi aman dijalankan berkali-kali:

| Kondisi | Hasil |
|---|---|
| User dengan email itu belum ada | Dibuat sebagai `SUPER_ADMIN`, email langsung terverifikasi |
| Sudah ada | Role dipastikan `SUPER_ADMIN` dan `active = true`. **Password tidak ditimpa** |

Password tidak ditimpa supaya kalau admin sudah mengganti password-nya, menjalankan seed tidak mengembalikannya ke password lama.

Kalau env seed tidak valid, seed berhenti dengan pesan `Env seed tidak valid:` beserta daftar field yang bermasalah.

## Melihat data

- `npm run db:studio`: Prisma Studio di browser.
- DBeaver, pgAdmin, atau klien PostgreSQL lain. Nama tabel mengikuti nama model **persis**, termasuk huruf besarnya, jadi di SQL manual wajib diberi tanda kutip:
  ```sql
  SELECT * FROM "User";
  SELECT * FROM "RefreshToken" WHERE "revokedAt" IS NULL;
  ```

Jangan membuat atau mengubah struktur tabel secara manual lewat DBeaver. Selalu lewat migrasi Prisma, supaya riwayat migrasi tetap sinkron.

## Pembersihan data

Belum ada pembersihan otomatis. Untuk aplikasi yang berjalan lama, jalankan secara berkala (cron, scheduled job):

```sql
DELETE FROM "RefreshToken"
WHERE "expiresAt" < now() OR "revokedAt" < now() - interval '7 days';

DELETE FROM "VerificationToken"
WHERE "expiresAt" < now() - interval '1 day';

DELETE FROM "User"
WHERE "emailVerifiedAt" IS NULL AND "passwordHash" IS NOT NULL
  AND "createdAt" < now() - interval '7 days'
  AND NOT EXISTS (SELECT 1 FROM "OAuthAccount" o WHERE o."userId" = "User"."id");
```

Query terakhir menghapus akun yang tidak pernah menyelesaikan verifikasi. Akun yang dibuat penyerang dengan email orang lain juga ikut terhapus.

## Database untuk test

Test memakai database terpisah (`starter_db_test`) yang **dikosongkan sebelum setiap test**. Lihat [15-testing.md](15-testing.md).
