npm const fs = require("fs");
const out = process.argv[2] ?? "postman/auth-starter.postman_collection.json";

const json = (obj) => ({
  mode: "raw",
  raw: JSON.stringify(obj, null, 2),
  options: { raw: { language: "json" } },
});

const req = (name, method, path, opts = {}) => {
  const item = {
    name,
    request: {
      method,
      url: `{{baseUrl}}${path}`,
      ...(opts.description && { description: opts.description }),
      ...(opts.body && {
        header: [{ key: "Content-Type", value: "application/json" }, ...(opts.headers || [])],
        body: json(opts.body),
      }),
      ...(!opts.body && opts.headers && { header: opts.headers }),
    },
    event: [],
  };
  if (opts.query) {
    item.request.url = {
      raw: `{{baseUrl}}${path}?${opts.query.map((q) => `${q.key}=${q.value}`).join("&")}`,
      host: ["{{baseUrl}}"],
      path: path.split("/").filter(Boolean),
      query: opts.query,
    };
  }
  if (opts.pre) item.event.push({ listen: "prerequest", script: { type: "text/javascript", exec: opts.pre } });
  if (opts.test) item.event.push({ listen: "test", script: { type: "text/javascript", exec: opts.test } });
  if (opts.disableCookies) item.protocolProfileBehavior = { disableCookies: true };
  return item;
};

const status = (code) => `pm.test('status ${code}', () => pm.response.to.have.status(${code}));`;
const okCode = (code) => `pm.test('code ${code}', () => pm.expect(pm.response.json().code).to.eql('${code}'));`;
const errCode = (code) => `pm.test('error ${code}', () => pm.expect(pm.response.json().error.code).to.eql('${code}'));`;
const saveRefresh = [
  "if (pm.cookies.has('refresh_token')) {",
  "  pm.collectionVariables.set('previousRefreshToken', '');",
  "  pm.collectionVariables.set('currentRefreshToken', pm.cookies.get('refresh_token'));",
  "}",
];
const tokenFromUrl = (variable) => [
  `const t = pm.collectionVariables.get('${variable}');`,
  `if (!t) console.warn('${variable} kosong: tempel link dari email ke collection variable.');`,
  "if (t && t.includes('token=')) {",
  `  pm.collectionVariables.set('${variable}', decodeURIComponent(t.split('token=')[1].split('&')[0]));`,
  "}",
];

const collection = {
  info: {
    name: "Auth Starter API",
    description: [
      "Koleksi endpoint project-starter-backend. Dokumentasi lengkap: doc/15-testing.md#postman dan doc/10-referensi-api.md.",
      "",
      "Cara pakai:",
      "1. Tab Variables: sesuaikan `baseUrl` dengan PORT server, isi `email`/`password` (akun terverifikasi, mis. super admin dari seed) dan `registerEmail` (email asli yang inbox-nya bisa dibuka).",
      "2. Header `X-Requested-With` dipasang otomatis untuk semua request (wajib untuk lolos proteksi CSRF).",
      "3. Cookie `access_token` & `refresh_token` disimpan otomatis oleh Postman setelah login.",
      "",
      "Login di folder mana pun mengganti sesi aktif di cookie Postman. Folder Admin butuh login sebagai SUPER_ADMIN (request 'Login sebagai Admin' di folder itu).",
    ].join("\n"),
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  variable: [
    { key: "baseUrl", value: "http://localhost:4000" },
    { key: "email", value: "admin@example.com" },
    { key: "password", value: "ganti-password-ini" },
    { key: "newPassword", value: "password-baru-minimal-12" },
    { key: "registerName", value: "User Tes" },
    { key: "registerEmail", value: "email-asli-kamu@gmail.com" },
    { key: "registerPassword", value: "password-tes-12345" },
    { key: "verificationToken", value: "" },
    { key: "resetToken", value: "" },
    { key: "resetNewPassword", value: "password-reset-12345" },
    { key: "googleIdToken", value: "" },
    { key: "profileName", value: "Nama Baru" },
    { key: "avatarUrl", value: "https://example.com/avatar.png" },
    { key: "adminSearch", value: "" },
    { key: "targetUserId", value: "" },
    { key: "currentRefreshToken", value: "" },
    { key: "previousRefreshToken", value: "" },
  ],
  event: [
    {
      listen: "prerequest",
      script: {
        type: "text/javascript",
        exec: ["pm.request.headers.upsert({ key: 'X-Requested-With', value: 'XMLHttpRequest' });"],
      },
    },
  ],
  item: [
    req("Health", "GET", "/api/health", {
      description: "Cek server dan koneksi database. Di luar /api/v1, tidak butuh header CSRF.",
      test: [status(200), "pm.test('db up', () => pm.expect(pm.response.json().db).to.eql('up'));"],
    }),

    {
      name: "Register & Verifikasi",
      description: "Urutan: Register → Login (Belum Verifikasi) → tempel link dari email ke `verificationToken` → Verify Email → Login (Akun Baru).",
      item: [
        req("Register", "POST", "/api/v1/auth/register", {
          description: "Selalu 202 dengan body yang sama (anti user enumeration). Cek inbox `registerEmail`.",
          body: { name: "{{registerName}}", email: "{{registerEmail}}", password: "{{registerPassword}}" },
          test: [status(202), okCode("registration_received")],
        }),
        req("Login (Belum Verifikasi)", "POST", "/api/v1/auth/login", {
          description: "Akun baru yang belum klik link verifikasi. Harus 403 email_not_verified.",
          body: { email: "{{registerEmail}}", password: "{{registerPassword}}" },
          test: [status(403), errCode("email_not_verified")],
        }),
        req("Verify Email", "POST", "/api/v1/auth/verify-email", {
          description: "Isi `verificationToken` dengan link dari email (boleh seluruh URL). Pertama: 200. Token yang sama lagi: 400.",
          body: { token: "{{verificationToken}}" },
          pre: tokenFromUrl("verificationToken"),
          test: [
            "pm.test('status 200 atau 400 (token sudah dipakai)', () => pm.expect(pm.response.code).to.be.oneOf([200, 400]));",
            "if (pm.response.code === 200) {",
            `  ${okCode("email_verified")}`,
            "} else {",
            `  ${errCode("invalid_verification_token")}`,
            "}",
          ],
        }),
        req("Resend Verification", "POST", "/api/v1/auth/resend-verification", {
          description: "Selalu 202. Email hanya terkirim jika akun ada, aktif, belum terverifikasi, dan lewat 60 detik dari kiriman terakhir. Link sebelumnya otomatis tidak berlaku.",
          body: { email: "{{registerEmail}}" },
          test: [status(202), okCode("verification_sent")],
        }),
        req("Login (Akun Baru)", "POST", "/api/v1/auth/login", {
          description: "Login akun hasil register setelah diverifikasi. Harus 200.",
          body: { email: "{{registerEmail}}", password: "{{registerPassword}}" },
          test: [status(200), okCode("login_success"), ...saveRefresh],
        }),
      ],
    },

    {
      name: "Sesi",
      item: [
        req("Login", "POST", "/api/v1/auth/login", {
          body: { email: "{{email}}", password: "{{password}}" },
          test: [
            status(200),
            okCode("login_success"),
            "pm.test('access_token cookie diset', () => pm.expect(pm.cookies.has('access_token')).to.be.true);",
            "pm.test('refresh_token cookie diset', () => pm.expect(pm.cookies.has('refresh_token')).to.be.true);",
            ...saveRefresh,
          ],
        }),
        req("Me", "GET", "/api/v1/auth/me", {
          description: "Profil lengkap: emailVerified, hasPassword, providers. Tidak pernah berisi passwordHash.",
          test: [
            status(200),
            "pm.test('tanpa passwordHash', () => pm.expect(pm.response.text()).to.not.include('passwordHash'));",
          ],
        }),
        req("Refresh", "POST", "/api/v1/auth/refresh", {
          description: "Rotation: refresh token berganti setiap dipakai.",
          test: [
            status(204),
            "if (pm.cookies.has('refresh_token')) {",
            "  pm.collectionVariables.set('previousRefreshToken', pm.collectionVariables.get('currentRefreshToken'));",
            "  pm.collectionVariables.set('currentRefreshToken', pm.cookies.get('refresh_token'));",
            "  pm.test('refresh token berganti (rotation)', () => {",
            "    pm.expect(pm.collectionVariables.get('currentRefreshToken')).to.not.eql(pm.collectionVariables.get('previousRefreshToken'));",
            "  });",
            "}",
          ],
        }),
        req("Refresh - Reuse Token Lama (uji pencurian)", "POST", "/api/v1/auth/refresh", {
          description: "Mengirim refresh token yang SUDAH dipakai (variable previousRefreshToken).\n\nLangkah: Login → Refresh → tunggu > 10 detik → jalankan request ini. Hasil benar: 401, dan seluruh sesi dicabut (Refresh biasa setelahnya juga 401).\n\nCookie jar dimatikan supaya yang terkirim benar-benar token lama.",
          headers: [{ key: "Cookie", value: "refresh_token={{previousRefreshToken}}" }],
          disableCookies: true,
          pre: [
            "if (!pm.collectionVariables.get('previousRefreshToken')) {",
            "  console.warn('previousRefreshToken kosong: jalankan Login lalu Refresh dulu.');",
            "}",
          ],
          test: [status(401), errCode("invalid_session")],
        }),
        req("Logout", "POST", "/api/v1/auth/logout", {
          description: "Mencabut sesi perangkat ini. Tidak butuh access token, selalu 204.",
          test: [status(204)],
        }),
        req("Logout All Devices", "POST", "/api/v1/auth/logout-all", {
          description: "Mencabut sesi di semua perangkat. Butuh login.",
          test: [status(204)],
        }),
      ],
    },

    {
      name: "Login Google",
      description: [
        "Cara mendapatkan id_token tanpa frontend (Google OAuth Playground):",
        "",
        "1. Di Google Cloud Console, tambahkan `https://developers.google.com/oauthplayground` ke Authorized redirect URIs OAuth Client.",
        "2. Buka https://developers.google.com/oauthplayground, ikon gear → 'Use your own OAuth credentials', isi Client ID & Secret.",
        "3. Step 1: ketik `openid email profile`, Authorize APIs, login Google.",
        "4. Step 2: 'Exchange authorization code for tokens', salin `id_token` (diawali eyJ...).",
        "5. Tempel ke collection variable `googleIdToken`. Berlaku 1 jam.",
      ].join("\n"),
      item: [
        req("Login Google", "POST", "/api/v1/auth/google", {
          description: "Akun Google baru → user dibuat. Pernah login → dikenali lewat sub. Email sudah terdaftar → akun ditautkan (password dihapus jika user belum terverifikasi). Respons sama dengan /login.",
          body: { credential: "{{googleIdToken}}" },
          pre: [
            "const t = pm.collectionVariables.get('googleIdToken');",
            "if (!t) {",
            "  console.warn('googleIdToken kosong: ambil id_token dari OAuth Playground (lihat deskripsi folder).');",
            "} else {",
            "  try {",
            "    const payload = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));",
            "    const sisa = payload.exp - Math.floor(Date.now() / 1000);",
            "    if (sisa <= 0) console.warn('googleIdToken sudah kedaluwarsa: ambil ulang dari OAuth Playground.');",
            "    else console.log('googleIdToken untuk ' + payload.email + ', sisa ' + Math.floor(sisa / 60) + ' menit');",
            "  } catch (e) { console.warn('googleIdToken bukan JWT yang valid'); }",
            "}",
          ],
          test: [
            status(200),
            "if (pm.response.code === 200) {",
            `  ${okCode("login_success")}`,
            ...saveRefresh.map((l) => "  " + l),
            "}",
          ],
        }),
        req("Login Google - Token Palsu", "POST", "/api/v1/auth/google", {
          description: "id_token dengan signature palsu. Harus 401 invalid_google_token.",
          body: {
            credential:
              "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJlbWFpbCI6InBhbHN1QGdtYWlsLmNvbSJ9.tanda-tangan-palsu",
          },
          test: [status(401), errCode("invalid_google_token")],
        }),
      ],
    },

    {
      name: "Lupa Password",
      description: "Urutan: Forgot Password → tempel link dari email ke `resetToken` → Reset Password. Memakai `registerEmail` supaya akun admin tidak ikut ter-reset.",
      item: [
        req("Forgot Password", "POST", "/api/v1/auth/forgot-password", {
          description: "Selalu 202 dengan body yang sama. Email reset hanya terkirim jika akun ada, aktif, dan lewat 60 detik dari permintaan terakhir.",
          body: { email: "{{registerEmail}}" },
          test: [status(202), okCode("reset_email_sent")],
        }),
        req("Reset Password", "POST", "/api/v1/auth/reset-password", {
          description: "Pertama: 200, semua sesi user dicabut, email 'password diganti' terkirim. Token yang sama lagi: 400.\n\nSetelah 200, `registerPassword` otomatis diganti ke password baru.",
          body: { token: "{{resetToken}}", newPassword: "{{resetNewPassword}}" },
          pre: tokenFromUrl("resetToken"),
          test: [
            "pm.test('status 200 atau 400 (token sudah dipakai)', () => pm.expect(pm.response.code).to.be.oneOf([200, 400]));",
            "if (pm.response.code === 200) {",
            `  ${okCode("password_reset")}`,
            "  const oldPw = pm.collectionVariables.get('registerPassword');",
            "  pm.collectionVariables.set('registerPassword', pm.collectionVariables.get('resetNewPassword'));",
            "  pm.collectionVariables.set('resetNewPassword', oldPw);",
            "} else {",
            `  ${errCode("invalid_reset_token")}`,
            "}",
          ],
        }),
      ],
    },

    {
      name: "Akun & Profil",
      description: "Butuh login (request Login di folder Sesi).",
      item: [
        req("Update Profil - Nama", "PATCH", "/api/v1/auth/me", {
          description: "Hanya field yang dikirim yang berubah. Respons = profil terbaru (bentuk sama dengan GET /me).",
          body: { name: "{{profileName}}" },
          test: [
            status(200),
            "pm.test('nama berubah', () => pm.expect(pm.response.json().data.name).to.eql(pm.collectionVariables.get('profileName')));",
          ],
        }),
        req("Update Profil - Avatar", "PATCH", "/api/v1/auth/me", {
          description: "avatarUrl wajib https (maks. 2048 karakter).",
          body: { avatarUrl: "{{avatarUrl}}" },
          test: [
            status(200),
            "pm.test('avatar berubah', () => pm.expect(pm.response.json().data.avatarUrl).to.eql(pm.collectionVariables.get('avatarUrl')));",
          ],
        }),
        req("Update Profil - Hapus Avatar", "PATCH", "/api/v1/auth/me", {
          description: "avatarUrl: null menghapus avatar.",
          body: { avatarUrl: null },
          test: [status(200), "pm.test('avatar dihapus', () => pm.expect(pm.response.json().data.avatarUrl).to.be.null);"],
        }),
        req("Update Profil - Avatar Tidak Aman (ditolak)", "PATCH", "/api/v1/auth/me", {
          description: "URL selain https (javascript:, data:, http) ditolak. Harus 400.",
          body: { avatarUrl: "javascript:alert(1)" },
          test: [status(400), errCode("validation_failed")],
        }),
        req("Change Password", "POST", "/api/v1/auth/change-password", {
          description: "Memakai akun `email`/`password`. Perangkat ini tetap login (cookie baru), perangkat lain ter-logout. Setelah 200, `password` dan `newPassword` otomatis ditukar.",
          body: { currentPassword: "{{password}}", newPassword: "{{newPassword}}" },
          test: [
            status(200),
            "if (pm.response.code === 200) {",
            "  const oldPw = pm.collectionVariables.get('password');",
            "  pm.collectionVariables.set('password', pm.collectionVariables.get('newPassword'));",
            "  pm.collectionVariables.set('newPassword', oldPw);",
            ...saveRefresh.map((l) => "  " + l),
            "}",
          ],
        }),
      ],
    },

    {
      name: "Admin",
      description: "Hanya SUPER_ADMIN. Urutan: Login sebagai Admin → List Users (menyimpan id user non-admin pertama ke `targetUserId`) → Nonaktifkan → Aktifkan.\n\nAkun `email`/`password` harus ber-role SUPER_ADMIN (mis. hasil `npm run db:seed`).",
      item: [
        req("Login sebagai Admin", "POST", "/api/v1/auth/login", {
          body: { email: "{{email}}", password: "{{password}}" },
          test: [
            status(200),
            "pm.test('role SUPER_ADMIN', () => pm.expect(pm.response.json().data.role).to.eql('SUPER_ADMIN'));",
            ...saveRefresh,
          ],
        }),
        req("List Users", "GET", "/api/v1/admin/users", {
          description: "Query: page (≥1, default 1), pageSize (1–100, default 20), search (email atau nama, opsional). Kosongkan `adminSearch` untuk semua user.\n\nId user pertama yang bukan SUPER_ADMIN disimpan ke `targetUserId`.",
          query: [
            { key: "page", value: "1" },
            { key: "pageSize", value: "20" },
            { key: "search", value: "{{adminSearch}}", disabled: true },
          ],
          test: [
            status(200),
            "const body = pm.response.json();",
            "pm.test('ada meta pagination', () => pm.expect(body.meta).to.have.keys('page', 'pageSize', 'total', 'totalPages'));",
            "pm.test('tanpa passwordHash', () => pm.expect(pm.response.text()).to.not.include('passwordHash'));",
            "const target = (body.data || []).find((u) => u.role !== 'SUPER_ADMIN');",
            "if (target) {",
            "  pm.collectionVariables.set('targetUserId', target.id);",
            "  console.log('targetUserId = ' + target.id + ' (' + target.email + ')');",
            "} else {",
            "  console.warn('Tidak ada user non-admin. Register user dulu.');",
            "}",
          ],
        }),
        req("List Users - Tanpa Akses (user biasa)", "GET", "/api/v1/admin/users", {
          description: "Jalankan setelah login sebagai user biasa (mis. 'Login (Akun Baru)'). Harus 403 forbidden.",
          test: [status(403), errCode("forbidden")],
        }),
        req("Nonaktifkan User", "PATCH", "/api/v1/admin/users/{{targetUserId}}/status", {
          description: "Menonaktifkan `targetUserId` dan mencabut semua sesinya. Tidak bisa untuk diri sendiri (400) atau SUPER_ADMIN lain (403).",
          body: { active: false },
          pre: ["if (!pm.collectionVariables.get('targetUserId')) console.warn('targetUserId kosong: jalankan List Users dulu.');"],
          test: [status(200), "pm.test('active false', () => pm.expect(pm.response.json().data.active).to.eql(false));"],
        }),
        req("Aktifkan User", "PATCH", "/api/v1/admin/users/{{targetUserId}}/status", {
          description: "Mengaktifkan kembali `targetUserId`. Sesi lama tidak kembali; user harus login ulang.",
          body: { active: true },
          test: [status(200), "pm.test('active true', () => pm.expect(pm.response.json().data.active).to.eql(true));"],
        }),
        req("Update Status - ID Tidak Valid", "PATCH", "/api/v1/admin/users/bukan-uuid/status", {
          description: "Id bukan UUID → 400 validation_failed (bukan 500).",
          body: { active: false },
          test: [status(400), errCode("validation_failed")],
        }),
      ],
    },
  ],
};

fs.writeFileSync(out, JSON.stringify(collection, null, 2) + "\n");
const count = (items) => items.reduce((n, i) => n + (i.item ? count(i.item) : 1), 0);
console.log(`written ${out}: ${count(collection.item)} requests, ${collection.variable.length} variables`);
