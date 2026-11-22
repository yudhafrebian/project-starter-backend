# 18 · Mengembangkan

## Menambah module baru

Contoh: module `products`.

### 1. Skema database

Tambahkan model di `prisma/schema.prisma`, lalu:

```bash
npm run db:migrate
```

Tambahkan juga nama tabel baru ke query `TRUNCATE` di `tests/helpers/db.ts`.

### 2. File module

```
src/modules/products/
  products.schema.ts
  products.repository.ts
  products.service.ts
  products.controller.ts
  products.routes.ts
```

**`products.schema.ts`**
```ts
import z from "zod";

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  price: z.number().int().min(0),
});
```

**`products.repository.ts`**
```ts
import { prisma } from "../../config/prisma";

export const createProduct = (data: { name: string; price: number; ownerId: string }) =>
  prisma.product.create({ data });

export const listProducts = (ownerId: string) =>
  prisma.product.findMany({ where: { ownerId }, orderBy: { createdAt: "desc" } });
```

**`products.service.ts`**
```ts
import * as repo from "./products.repository";

export const createProduct = (ownerId: string, input: { name: string; price: number }) =>
  repo.createProduct({ ...input, ownerId });

export const listProducts = (ownerId: string) => repo.listProducts(ownerId);
```

**`products.controller.ts`**
```ts
import type { Request, Response } from "express";
import * as service from "./products.service";

export const Create = async (req: Request, res: Response) => {
  const product = await service.createProduct(req.user!.id, req.body);
  res.status(201).send({ success: true, data: product });
};

export const List = async (req: Request, res: Response) => {
  const items = await service.listProducts(req.user!.id);
  res.status(200).send({ success: true, data: items });
};
```

**`products.routes.ts`**
```ts
import { Router } from "express";
import { requireAuth } from "../../middlewares/requireAuth";
import { validateBody } from "../../middlewares/validate";
import * as controller from "./products.controller";
import { createProductSchema } from "./products.schema";

export const router = Router();

router.use(requireAuth);
router.get("/", controller.List);
router.post("/", validateBody(createProductSchema), controller.Create);
```

### 3. Daftarkan di `src/routes.ts`

```ts
import { router as productsRouter } from "./modules/products/products.routes";

api.use("/products", productsRouter);
```

Endpoint baru otomatis mendapat proteksi CSRF dari `api.use(requireCsrfHeader)`.

### 4. Test & dokumentasi

- Tambahkan `tests/products.test.ts` (lihat pola di [15-testing.md](15-testing.md#menulis-test-baru)).
- Tambahkan endpoint ke `scripts/generate-postman.js`, lalu jalankan `npm run postman:generate` (lihat [15-testing.md](15-testing.md#generate-ulang-koleksi)). Jangan mengedit file JSON koleksi secara langsung.
- Tambahkan endpoint ke [10-referensi-api.md](10-referensi-api.md).
- Kalau module baru membutuhkan variabel env wajib baru, tambahkan ke `.env.example`, `.env.test`, dan langkah **Create .env.test** di `.github/workflows/ci.yml`.

### Aturan yang perlu dijaga

- Endpoint GET **tidak boleh** mengubah data (proteksi CSRF hanya untuk non-GET).
- Validasi semua input dengan Zod. Untuk query/params, pakai pola `parseOrThrow` seperti di `admin.controller.ts`.
- Gunakan `select` eksplisit kalau data menyangkut user, supaya kolom sensitif tidak bocor.
- Lempar `HttpError` dengan kode `snake_case` yang deskriptif, lalu catat di [11-kode-error.md](11-kode-error.md).
- Periksa kepemilikan data (misalnya `where: { id, ownerId: req.user!.id }`), bukan hanya status login.

## Menambah template email

Lihat [12-email.md](12-email.md#menambah-template-baru).

## Menambah role

1. Tambahkan nilai ke enum `Role` di `schema.prisma`, misalnya `ADMIN`.
2. `npm run db:migrate`. Menambah nilai enum aman, dan tidak memengaruhi data yang ada.
3. Pakai di route: `requireRole(Role.SUPER_ADMIN, Role.ADMIN)`.

Mengganti nama nilai enum yang sudah dipakai butuh migrasi manual, lihat [13-database.md](13-database.md#mengganti-nama-nilai-enum-tanpa-kehilangan-data).

### Beralih ke permission

Untuk 2–3 role, `requireRole` sudah cukup. Kalau role makin banyak dan aturannya rumit, petakan role ke permission:

```ts
type Permission = "user:read" | "user:update" | "billing:manage";

const ROLE_PERMISSIONS = {
  SUPER_ADMIN: ["user:read", "user:update", "billing:manage"],
  USER: [],
} satisfies Record<Role, Permission[]>;

export const requirePermission =
  (permission: Permission) => (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, "unauthenticated", undefined, "Please login first"));
    if (!(ROLE_PERMISSIONS[req.user.role] as readonly Permission[]).includes(permission)) {
      return next(new HttpError(403, "forbidden", undefined, "You do not have access to this resource"));
    }
    next();
  };

router.get("/users", requireAuth, requirePermission("user:read"), controller.ListUsers);
```

Route tidak perlu tahu role apa saja yang boleh mengaksesnya. Menambah role cukup dengan mengubah satu tabel, dan `satisfies Record<Role, ...>` memaksa setiap role baru punya entri.

## Menambah provider OAuth (misalnya GitHub)

1. Tambahkan `GITHUB` ke enum `OAuthProvider`, lalu migrasi.
2. Buat `src/lib/github.ts` yang memverifikasi kredensial GitHub dan mengembalikan `{ sub, email, name, picture }`. GitHub tidak memakai ID token seperti Google, jadi biasanya dipakai alur *authorization code*. Pastikan hanya email yang **terverifikasi** di GitHub yang dipakai untuk penautan.
3. Generalisasi `findGoogleAccount`, `linkGoogleAccount`, dan `createUserWithGoogle` menjadi versi yang menerima `provider`.
4. Tambahkan endpoint `POST /auth/github` dengan alur yang sama seperti `loginWithGoogle` (cari berdasarkan `sub`, lalu email, lalu buat baru), termasuk aturan penghapusan password untuk akun yang belum terverifikasi.

Tabel `OAuthAccount` sudah dirancang untuk banyak provider.

## Fitur opsional

Fitur yang belum ada, diurutkan dari yang paling sering dibutuhkan:

| Fitur | Catatan implementasi |
|---|---|
| **Daftar sesi aktif + cabut satu sesi** | Data sudah tersedia di `RefreshToken` (`userAgent`, `ip`, `createdAt`). `GET /auth/sessions` = token aktif dikelompokkan per `familyId`. `DELETE /auth/sessions/:familyId` = `revokeFamily` (pastikan milik user tersebut) |
| **Pembersihan berkala** | Query ada di [13-database.md](13-database.md#pembersihan-data) |
| **Email notifikasi saat change password** | Tambahkan `trySendMail(passwordChangedEmail(...))` di akhir `changePassword` |
| **Ganti email** | Tambahkan nilai `EMAIL_CHANGE` ke `VerificationTokenType`, plus kolom email baru (misalnya `pendingEmail` di `User`). Kirim link ke email **baru**, dan beri notifikasi ke email **lama** |
| **Log per request** | Pasang `pino-http` memakai `logger` yang sudah ada (redaksi header sudah dikonfigurasi) |
| **Rate limit dengan Redis** | `rate-limit-redis` atau Upstash untuk multi-instance/serverless |
| **Unlink akun Google** | Hanya izinkan kalau user punya password (`hasPassword`), supaya tidak terkunci dari akunnya sendiri |
| **Upload avatar** | Presigned URL ke S3/R2, lalu kirim URL hasilnya ke `PATCH /me` |
| **2FA (TOTP)** | Kolom secret terenkripsi + langkah verifikasi tambahan setelah password benar |
| **Audit log** | Tabel untuk mencatat login, ganti password, perubahan status oleh admin |
| **Hapus akun** | Pertimbangkan *soft delete* dan kewajiban retensi data |
| **Organisasi / tenant** | Kebutuhan SaaS. Sengaja **tidak** dimasukkan ke starter auth, karena model tenant berbeda di tiap produk |

## Perbaikan yang disarankan

Hal-hal kecil di kode yang bisa dirapikan:

| Lokasi | Hal | Saran |
|---|---|---|
| `src/middlewares/validate.ts` | Hanya mengirim `fieldErrors`. Error `.refine()` tingkat objek (misalnya "minimal satu field" di `PATCH /me`) menghasilkan `fields: {}` | Sertakan juga `formErrors`, misalnya sebagai `fields._form` |
| `src/lib/token.ts` | `generateRefreshToken` dan `generateRandomToken` identik | Pakai satu fungsi saja |
| `src/modules/auth/auth.repository.ts` | Nama fungsi `updatePasswordHas` (typo) | Ganti menjadi `updatePasswordHash` |
| `src/routes.ts` | Import memakai `"../src/modules/..."` | Cukup `"./modules/..."` |
| `src/config/env.ts` | Default `APP_NAME` masih nama brand (`Vlairwitch App`) | Ganti ke nama netral atau nama project baru |
| `prisma/seed.ts` | Password seed belum dibatasi 72 byte | Samakan dengan `newPasswordSchema` |
| `src/config/env.ts` | Variabel opsional yang kosong (`KEY=`) ditolak | Ubah string kosong menjadi `undefined` sebelum validasi, misalnya `z.preprocess((v) => (v === "" ? undefined : v), ...)` |
| `src/modules/auth/auth.service.ts` | `crypto.randomUUID()` memakai `crypto` global tanpa import | Boleh tetap (tersedia global di Node 19+), atau import dari `node:crypto` supaya eksplisit |
