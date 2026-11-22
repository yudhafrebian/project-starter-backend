# 09 · Profil

## `GET /auth/me`

Mengembalikan profil user yang sedang login.

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "andi@example.com",
    "name": "Andi",
    "avatarUrl": "https://example.com/foto.png",
    "role": "USER",
    "emailVerified": true,
    "hasPassword": true,
    "providers": ["GOOGLE"],
    "createdAt": "2026-11-22T09:00:00.000Z"
  }
}
```

| Field | Kegunaan di frontend |
|---|---|
| `emailVerified` | Status verifikasi (boolean, bukan tanggal) |
| `hasPassword` | `false` untuk user Google-only. Tampilkan "Buat password" (lewat lupa password), bukan "Ganti password" |
| `providers` | Daftar provider OAuth yang tertaut, misalnya untuk menampilkan "Terhubung dengan Google" |

`passwordHash` **tidak pernah dikirim**. Kolom itu memang diambil dari database, tetapi hanya untuk menghitung `hasPassword`.

Bentuk data profil ditentukan di **satu tempat**, yaitu fungsi `toProfileDto` di `auth.service.ts`. Endpoint `GET` dan `PATCH` sama-sama memakainya, sehingga bentuk respons keduanya selalu identik.

## `PATCH /auth/me`

Mengubah profil milik sendiri. Hanya field yang dikirim yang berubah.

| Field | Aturan |
|---|---|
| `name` | String, di-trim, 1–100 karakter |
| `avatarUrl` | URL **`https`** maksimal 2048 karakter, atau `null` untuk menghapus avatar |

Minimal satu field wajib ada. Respons berisi profil terbaru, dengan bentuk yang sama seperti `GET /me`.

### Contoh

```http
PATCH /api/v1/auth/me
X-Requested-With: XMLHttpRequest
Content-Type: application/json

{ "name": "Andi Baru" }
```

```http
PATCH /api/v1/auth/me
{ "avatarUrl": null }
```

### Kenapa avatar wajib `https`

`avatarUrl` akan dipasang di `<img src>` di frontend. Dengan membatasi skema ke `https`, URL berbahaya seperti `javascript:...` dan `data:...`, maupun `http` yang tidak aman, tidak bisa tersimpan.

### Field yang diabaikan

`role`, `email`, dan field lain yang tidak ada di schema **dibuang** oleh Zod sebelum sampai ke database. Akibatnya:

- User tidak bisa menaikkan role-nya sendiri.
- Email tidak bisa diganti lewat endpoint ini, karena ganti email butuh verifikasi ulang (lihat [fitur opsional](18-mengembangkan.md#fitur-opsional)).

Kalau body **hanya** berisi field yang dibuang (misalnya `{ "role": "SUPER_ADMIN" }`), tidak ada field valid yang tersisa, dan request ditolak oleh aturan "minimal satu field".

### Respons validasi "minimal satu field"

Aturan ini adalah `.refine()` tingkat objek, jadi pesannya masuk ke `formErrors` milik Zod. Karena `validateBody` hanya mengirim `fieldErrors`, responsnya:

```json
{ "error": { "code": "validation_failed", "message": "Invalid Data", "fields": {} } }
```

Frontend sebaiknya mencegah pengiriman form kosong sejak awal.

## Upload avatar

Upload file **tidak** disediakan, karena butuh storage (S3, Cloudflare R2, Cloudinary, dan sebagainya) yang pilihannya berbeda di tiap project. Pola yang disarankan: frontend meng-upload ke storage (misalnya lewat *presigned URL* yang diterbitkan endpoint baru), lalu mengirim URL hasilnya ke `PATCH /me`.
