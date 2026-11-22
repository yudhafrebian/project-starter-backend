# 08 · Otorisasi & Admin

## Role

Didefinisikan sebagai enum `Role` di `prisma/schema.prisma`:

| Role | Keterangan |
|---|---|
| `USER` | Default untuk semua user baru (register maupun Google) |
| `SUPER_ADMIN` | Akses modul admin. Dibuat lewat seed |

Role disimpan di kolom `User.role`, dan **dibaca dari database di setiap request** oleh `requireAuth`. Karena itu, menaikkan atau menurunkan role berlaku **seketika**, tanpa perlu login ulang.

Tidak ada endpoint untuk mengubah role. `PATCH /me` mengabaikan field `role`, dan register juga membuangnya. Role hanya bisa diubah lewat database, seed, atau endpoint admin yang kamu tambahkan sendiri.

## 401 vs 403

| Status | Kode | Arti |
|---|---|---|
| 401 | `unauthenticated` | "Kamu siapa?": belum login, token tidak valid, atau akun nonaktif |
| 403 | `forbidden` | "Aku tahu kamu siapa, tapi kamu tidak boleh": role tidak cukup |

## `requireRole`

`src/middlewares/requireRole.ts`:

```ts
router.get("/laporan", requireAuth, requireRole(Role.SUPER_ADMIN), controller.Laporan);
router.get("/konten", requireAuth, requireRole(Role.SUPER_ADMIN, Role.EDITOR), controller.Konten);
```

- **Wajib dipasang setelah `requireAuth`.** Kalau terlupa dan `req.user` belum ada, middleware ini menjawab `401` sebagai pengaman, bukan crash.
- Parameternya bertipe `[Role, ...Role[]]`, jadi **minimal satu role wajib diisi**. `requireRole()` tanpa argumen langsung menjadi error TypeScript, bukan diam-diam menolak semua orang.
- Role tidak cocok → `403 forbidden`.

### Melindungi seluruh router

```ts
router.use(requireAuth, requireRole(Role.SUPER_ADMIN));
router.get("/users", ...);
router.patch("/users/:id/status", ...);
```

`router.use` di bagian atas melindungi **semua** route di bawahnya, termasuk route yang ditambahkan nanti. Dengan begitu, tidak ada risiko lupa memasang guard di salah satu route. Pola ini dipakai di `admin.routes.ts`.

## Modul admin

Semua endpoint di `/api/v1/admin` hanya untuk `SUPER_ADMIN`.

### `GET /admin/users`

Daftar user dengan pagination dan pencarian.

| Query | Aturan | Default |
|---|---|---|
| `page` | Bilangan bulat ≥ 1 | `1` |
| `pageSize` | Bilangan bulat 1–100 | `20` |
| `search` | String 1–100 karakter (di-trim). Mencocokkan `email` **atau** `name`, *case-insensitive* | |

Hasil diurutkan dari yang terbaru (`createdAt desc`).

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "email": "budi@example.com",
      "name": "Budi",
      "avatarUrl": null,
      "role": "USER",
      "active": true,
      "emailVerifiedAt": "2026-11-22T10:00:00.000Z",
      "createdAt": "2026-11-22T09:00:00.000Z"
    }
  ],
  "meta": { "page": 1, "pageSize": 20, "total": 1, "totalPages": 1 }
}
```

Data user dan jumlah totalnya diambil dalam satu transaksi, sehingga `total` konsisten dengan `data`.

### `PATCH /admin/users/:id/status`

Mengaktifkan atau menonaktifkan user. Body `{ "active": boolean }`.

| Aturan | Hasil |
|---|---|
| `:id` bukan UUID | `400 validation_failed` (bukan 500) |
| Mengubah status diri sendiri | `400 cannot_change_own_status`, supaya admin tidak mengunci dirinya sendiri |
| User tidak ditemukan | `404 user_not_found` |
| Target adalah `SUPER_ADMIN` | `403 cannot_change_super_admin`, supaya antar admin tidak saling mengunci |
| Berhasil | `200`, `data` = user terbaru |

**Menonaktifkan** user (`active: false`) dalam satu transaksi juga **mencabut semua refresh token-nya**. Efeknya langsung terasa:

- Request berikutnya dengan access token lama → `401` (karena `requireAuth` memeriksa `active`).
- Refresh → `401`.
- Login → `401 invalid_credentials`.
- Login Google → `403 account_disabled`.

**Mengaktifkan** kembali tidak mengembalikan sesi lama. User harus login ulang.

## Data yang keluar dari API admin

`admin.repository.ts` memakai `publicUserSelect`, daftar kolom eksplisit yang **boleh** keluar ke API. `passwordHash` tidak termasuk. Dengan pola *allowlist* ini, kalau suatu hari tabel `User` mendapat kolom sensitif baru, kolom itu **tidak** otomatis bocor ke API.

## Validasi query & params

Di Express 5, `req.query` bersifat read-only, sehingga tidak bisa ditimpa middleware seperti `validateBody`. Controller admin memakai helper `parseOrThrow(schema, data)`, yang memvalidasi lalu melempar `400 validation_failed` dengan `fields` kalau tidak valid.

## Mengembangkan sistem role

Lihat [18-mengembangkan.md](18-mengembangkan.md#menambah-role) untuk menambah role baru dan beralih ke sistem *permission* saat aturan akses makin rumit.
