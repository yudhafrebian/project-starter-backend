# 17 · Integrasi Frontend

Panduan untuk developer frontend (React, Vue, Next.js, Svelte, dan sebagainya) yang memakai API ini.

## Aturan dasar

1. **Selalu kirim cookie:** `credentials: "include"` (fetch) atau `withCredentials: true` (axios).
2. **Setiap request non-GET wajib membawa header `X-Requested-With`**, misalnya `XMLHttpRequest`.
3. **Token tidak perlu disimpan di frontend.** Token ada di cookie `httpOnly` dan dikelola browser. Jangan memakai `localStorage` untuk token.
4. **Gunakan `code`**, bukan `message`, untuk menentukan tampilan dan teks ke user.
5. Frontend harus berjalan di origin yang sama dengan `WEB_ORIGIN` (CORS hanya mengizinkan origin itu).

## Klien API dengan refresh otomatis

Access token berumur 15 menit. Kalau sebuah request mendapat `401`, panggil `/auth/refresh` **sekali**, lalu ulangi request aslinya.

Prinsip pentingnya:

- **Hanya satu refresh berjalan pada satu waktu.** Kalau 5 request gagal bersamaan, kelimanya menunggu promise refresh yang sama, bukan memicu 5 refresh paralel. Refresh paralel justru bisa dianggap pencurian token oleh backend.
- **Kalau `/auth/refresh` gagal, ulangi request asli sekali.** Bisa jadi tab lain sudah refresh duluan dan cookie baru sudah tersimpan (lihat [masa toleransi](04-autentikasi-sesi.md#masa-toleransi-10-detik-reuse_grace_ms)). Kalau tetap 401, arahkan ke halaman login.
- **Jangan me-refresh untuk endpoint auth itu sendiri** (`/auth/login`, `/auth/refresh`, dan seterusnya).

```ts
const API = "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(public status: number, public code: string, public fields?: Record<string, string[]>) {
    super(code);
  }
}

let refreshing: Promise<boolean> | null = null;

const refreshSession = () => {
  refreshing ??= fetch(`${API}/auth/refresh`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Requested-With": "XMLHttpRequest" },
  })
    .then((r) => r.ok)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
};

const rawRequest = (path: string, init: RequestInit = {}) =>
  fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      ...init.headers,
    },
  });

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let res = await rawRequest(path, init);

  if (res.status === 401 && !path.startsWith("/auth/")) {
    await refreshSession();
    res = await rawRequest(path, init);
    if (res.status === 401) {
      window.location.href = "/login";
      throw new ApiError(401, "unauthenticated");
    }
  }

  if (res.status === 204) return undefined as T;
  const body = await res.json();
  if (!res.ok) throw new ApiError(res.status, body.error?.code, body.error?.fields);
  return body as T;
}
```

Contoh pemakaian:

```ts
const { data: me } = await api<{ data: Profile }>("/auth/me");

await api("/auth/me", { method: "PATCH", body: JSON.stringify({ name: "Nama Baru" }) });
```

### Dengan axios

```ts
const http = axios.create({
  baseURL: "http://localhost:4000/api/v1",
  withCredentials: true,
  headers: { "X-Requested-With": "XMLHttpRequest" },
});

let refreshing: Promise<unknown> | null = null;

http.interceptors.response.use(undefined, async (error) => {
  const original = error.config;
  if (error.response?.status !== 401 || original._retried || original.url.startsWith("/auth/")) {
    throw error;
  }
  original._retried = true;
  refreshing ??= http.post("/auth/refresh").catch(() => null).finally(() => (refreshing = null));
  await refreshing;
  return http(original);
});
```

## Status login saat aplikasi dibuka

Panggil `GET /auth/me` saat aplikasi dimuat:

- `200` → user sudah login, dan simpan profilnya di state.
- `401` → klien di atas mencoba refresh dulu. Kalau tetap gagal, user belum login.

Cookie `httpOnly` tidak bisa dibaca JavaScript, jadi **satu-satunya cara** mengetahui status login adalah bertanya ke server.

## Login

```ts
try {
  const { data: user } = await api<{ data: User }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
} catch (e) {
  if (e instanceof ApiError) {
    switch (e.code) {
      case "invalid_credentials": tampilkan("Email atau password salah"); break;
      case "email_not_verified":  tampilkanTombolKirimUlangVerifikasi(email); break;
      case "too_many_attempts":   tampilkan("Terlalu banyak percobaan, coba lagi nanti"); break;
    }
  }
}
```

## Login Google

Pakai Google Identity Services. `client_id` = `GOOGLE_CLIENT_ID` yang sama dengan backend.

```html
<script src="https://accounts.google.com/gsi/client" async></script>
<div id="google-button"></div>
```

```ts
window.google.accounts.id.initialize({
  client_id: "xxxx.apps.googleusercontent.com",
  callback: async ({ credential }) => {
    const { data: user } = await api<{ data: User }>("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential }),
    });
  },
});
window.google.accounts.id.renderButton(document.getElementById("google-button")!, {
  theme: "outline",
  size: "large",
});
```

Yang dikirim adalah `credential` (ID token), **bukan** access token Google. Origin frontend wajib terdaftar di **Authorized JavaScript origins**. Lihat [07-login-google.md](07-login-google.md).

| `code` error | Tampilan |
|---|---|
| `google_account_conflict` | "Email ini sudah terhubung dengan akun Google lain" |
| `account_disabled` | "Akun dinonaktifkan" |
| `invalid_google_token` | "Login Google gagal, coba lagi" |

## Register

```ts
await api("/auth/register", {
  method: "POST",
  body: JSON.stringify({ name, email, password }),
});
tampilkan("Cek email kamu untuk link verifikasi");
```

Respons register **selalu** sukses (202). Jangan menampilkan "email sudah terdaftar", karena memang tidak ada informasi itu. Tampilkan error hanya untuk `validation_failed` (lihat `fields`).

Validasi di frontend (sesuaikan dengan backend): nama 1–100 karakter, password minimal 12 karakter dan maksimal 72 byte (untuk huruf biasa, 72 karakter).

## Halaman `/verify-email`

Link di email: `WEB_ORIGIN/verify-email?token=xxx`.

```ts
const token = new URLSearchParams(location.search).get("token");
history.replaceState(null, "", "/verify-email");

try {
  await api("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
  tampilkan("Email terverifikasi. Silakan login.");
} catch (e) {
  if (e instanceof ApiError && e.code === "invalid_verification_token") {
    tampilkan("Link tidak valid atau kedaluwarsa.");
    tampilkanFormKirimUlang();
    tampilkanLinkKeLogin();
  }
}
```

Tambahkan di `<head>` halaman ini:

```html
<meta name="referrer" content="no-referrer">
```

Kedua langkah (menghapus token dari URL dan `no-referrer`) mencegah token tersimpan di riwayat browser atau bocor lewat header `Referer` ke script atau gambar pihak ketiga.

Saat mendapat 400, tampilkan juga link ke login. Bisa saja email sudah terverifikasi sebelumnya (link diklik dua kali).

## Kirim ulang verifikasi

```ts
await api("/auth/resend-verification", { method: "POST", body: JSON.stringify({ email }) });
tampilkan("Kalau akun perlu verifikasi, email baru sudah dikirim");
```

Ada jeda minimal 60 detik antar pengiriman per akun. Nonaktifkan tombol selama 60 detik setelah diklik.

## Halaman `/forgot-password`

```ts
await api("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
tampilkan("Kalau email terdaftar, link reset sudah dikirim");
```

Selalu tampilkan pesan yang sama.

## Halaman `/reset-password`

Link di email: `WEB_ORIGIN/reset-password?token=xxx`. Perlakuannya sama seperti halaman verifikasi: hapus token dari URL dan pasang `no-referrer`.

```ts
await api("/auth/reset-password", {
  method: "POST",
  body: JSON.stringify({ token, newPassword }),
});
tampilkan("Password berhasil diganti. Silakan login.");
```

Field "konfirmasi password" cukup dicek di frontend. `invalid_reset_token` → "Link tidak valid atau kedaluwarsa", plus tombol minta link baru.

Setelah reset, **semua sesi dicabut**. User harus login ulang di semua perangkat.

## Profil & pengaturan akun

```ts
const { data: me } = await api<{ data: Profile }>("/auth/me");

if (me.hasPassword) tampilkanFormGantiPassword();
else tampilkanTombol("Buat password", () => kirimLupaPassword(me.email));

if (me.providers.includes("GOOGLE")) tampilkan("Terhubung dengan Google");
```

- **Ganti password:** `POST /auth/change-password`. Perangkat ini tetap login (cookie baru dikirim), perangkat lain ter-logout.
- **Ubah profil:** `PATCH /auth/me`. Jangan kirim body kosong.
- **Logout:** `POST /auth/logout`, lalu bersihkan state user di frontend.
- **Logout semua perangkat:** `POST /auth/logout-all`.

## Menampilkan error validasi

```ts
catch (e) {
  if (e instanceof ApiError && e.code === "validation_failed") {
    for (const [field, messages] of Object.entries(e.fields ?? {})) {
      setFieldError(field, terjemahkan(messages[0]));
    }
  }
}
```

Pesan khusus di `fields` yang perlu diterjemahkan: `password_too_short`, `password_too_long`, `password_same_as_current`. Pesan lain berasal dari Zod (bahasa Inggris).

## Peta halaman frontend yang dibutuhkan

| Path frontend | Dipakai oleh |
|---|---|
| `/login` | Link di email "Percobaan pendaftaran" |
| `/verify-email` | Link verifikasi email |
| `/forgot-password` | Link di email "Password telah diganti" |
| `/reset-password` | Link reset password |

Path ini ditulis di `src/modules/auth/auth.emails.ts`. Kalau path di frontend berbeda, ubah di file itu.
