# 12 · Email

## Komponen

| File | Peran |
|---|---|
| `src/lib/mailer.ts` | Transport SMTP (Nodemailer): `sendMail`, `trySendMail`, `verifyMailer` |
| `src/lib/email-templates.ts` | Memuat, mengompilasi, dan me-render template Handlebars |
| `src/emails/templates/*.hbs` | Template HTML dan teks |
| `src/modules/auth/auth.emails.ts` | Merakit email auth: subjek, link, masa berlaku |

## Mailer

```ts
sendMail(msg)      // kirim; melempar error kalau gagal
trySendMail(msg)   // kirim; kalau gagal hanya dicatat di log ("failed to send email")
verifyMailer()     // cek koneksi & login SMTP (dipanggil saat server start)
```

`MailMessage = { to, subject, html, text }`. Alamat pengirim selalu `MAIL_FROM`.

### Kenapa email auth memakai `trySendMail`

Kegagalan SMTP (server down, kuota habis) **tidak boleh** membuat register atau lupa password mengembalikan error 500. Alasannya:

- Respons yang berbeda bisa membocorkan informasi (misalnya "email ini memicu pengiriman, berarti terdaftar").
- User selalu bisa meminta kirim ulang.

Kegagalan tetap tercatat di log server, lengkap dengan subjek email.

### Kenapa dikirim dengan `await`, tidak di background

Aplikasi ini disiapkan untuk berjalan di **Vercel** (serverless). Di sana, pekerjaan yang masih berjalan setelah respons dikirim bisa dihentikan, sehingga email bisa tidak pernah terkirim. Karena itu email dikirim dengan `await` sebelum respons. Kalau nanti pindah ke server biasa dan ingin respons lebih cepat, pertimbangkan antrean (queue) seperti BullMQ.

### Satu pintu

Kode lain hanya memanggil `sendMail`/`trySendMail`. Kalau ingin pindah dari SMTP ke API penyedia email (misalnya API Resend), **hanya `mailer.ts` yang perlu diubah**.

## Setup Brevo

Brevo dipilih karena paket gratisnya 300 email per hari, mendukung SMTP, dan bisa dipakai sebelum punya domain. Penyedia lain yang mendukung SMTP (Resend, Amazon SES, Postmark, Mailjet) bisa dipakai cukup dengan mengganti env.

### 1. SMTP key

Dashboard Brevo → nama akun (kanan atas) → **SMTP & API** → tab **SMTP**:

| Di dashboard | Variabel |
|---|---|
| SMTP Server (`smtp-relay.brevo.com`) | `SMTP_HOST` |
| Port (`587`) | `SMTP_PORT` |
| Login (`xxxx@smtp-brevo.com`) | `SMTP_USER`. **Bukan** email login akun |
| **Generate a new SMTP key** → salin (hanya ditampilkan sekali) | `SMTP_PASS`. Diawali `xsmtpsib-`. **Bukan** API key (`xkeysib-`) |

Sebaiknya buat key terpisah per lingkungan (dev, prod), supaya kalau satu bocor, cukup key itu yang dihapus.

### 2. Domain dan sender

**Senders, Domains & Dedicated IPs**:

1. Tab **Domains** → **Add a domain** → autentikasi manual. Brevo memberi record DNS:

   | Type | Name | Fungsi |
   |---|---|---|
   | TXT | `@` | `brevo-code:...`: bukti kepemilikan domain |
   | CNAME | `brevo1._domainkey`, `brevo2._domainkey` | **DKIM**: tanda tangan digital email |
   | TXT | `_dmarc` | **DMARC**: kebijakan email palsu (mulai dengan `p=none`) |

   Hal yang perlu diperhatikan:
   - Satu domain hanya boleh punya **satu** record SPF dan **satu** record DMARC. Kalau sudah ada, gabungkan isinya, jangan menambah record baru.
   - Di Cloudflare, CNAME DKIM harus diset **DNS only** (awan abu-abu), bukan *Proxied*.
   - Di kolom Name, cukup tulis `brevo1._domainkey`. Banyak panel menambahkan nama domain secara otomatis.

2. Opsional: **branded subdomain** (misalnya `mail.domainkamu.com`). Subdomain ini dipakai sebagai *return-path*, sehingga SPF dicek lewat subdomain itu.
3. Tab **Senders** → **Add a sender**: `no-reply@domainkamu.com`. Alamat di `MAIL_FROM` harus **persis** sama dengan sender ini.

### 3. Matikan click tracking

Di pengaturan tracking email transaksional Brevo, **matikan click tracking**. Kalau aktif, Brevo mengganti link di email dengan link redirect miliknya. Akibatnya, token verifikasi dan reset melewati server pihak ketiga, link terlihat mencurigakan, dan skor spam naik.

### 4. Tes

Setelah env terisi, jalankan `npm run dev`. Log harus menampilkan `SMTP ready`. Kirim email lewat register, lalu periksa:

- **Brevo → Transactional → Logs** untuk status pengiriman (*delivered*, *blocked*, *bounce*).
- Di Gmail: **⋮ → Show original**. SPF, DKIM, dan DMARC harus **PASS**.

## Template

### Lokasi dan penamaan

```
src/emails/templates/
  layout.html.hbs            ← kerangka bersama (header, isi, footer)
  <nama>.html.hbs            ← versi HTML
  <nama>.text.hbs            ← versi teks biasa
```

Setiap email **wajib** punya kedua versi. Versi teks dipakai email client yang tidak menampilkan HTML, dan juga membantu skor anti-spam.

| Template | Variabel | Dipakai untuk |
|---|---|---|
| `verify-email` | `name`, `link`, `expiresInHours` | Verifikasi email |
| `account-exists` | `loginLink` | Percobaan register dengan email yang sudah terverifikasi |
| `reset-password` | `name`, `link`, `expiresInMinutes` | Lupa password |
| `password-changed` | `name`, `forgotPasswordLink` | Notifikasi setelah reset |

Variabel global yang tersedia di semua template: `appName` (dari `APP_NAME`) dan `year` (tahun berjalan).

### Layout

Template HTML membungkus isinya dengan partial `layout`:

```hbs
{{#> layout}}
<p>Halo {{name}},</p>
...
{{/layout}}
```

Isi disisipkan di `{{> @partial-block}}` milik `layout.html.hbs`. Styling ditulis **inline** dan memakai `<table>`, karena itu cara paling andal untuk tampil benar di Gmail, Outlook, dan Apple Mail.

### Escape (keamanan)

- `{{variabel}}` **otomatis di-escape**. Nama `<b>Tes</b>` tampil sebagai teks, bukan HTML. Pakai ini untuk **semua** data.
- `{{{variabel}}}` (tiga kurung) **tidak** di-escape. **Jangan pernah** dipakai untuk data dari user.
- Template teks dikompilasi dengan `noEscape: true`, karena di email teks, `&` tidak boleh berubah menjadi `&amp;`.
- Handlebars juga meng-escape `=` di HTML menjadi `&#x3D;`. Link seperti `?token=` tertulis `?token&#x3D;` di sumber HTML. Browser dan email client membacanya kembali sebagai `=`, jadi link tetap berfungsi.

### Cara kerja `email-templates.ts`

1. **Lokasi folder:** `path.join(__dirname, "../emails/templates")`. Saat development (`tsx`), lokasinya `src/emails/templates`. Setelah build, `dist/emails/templates` (disalin oleh `scripts/copy-assets.js`).
2. **Instance terpisah:** `Handlebars.create()`, supaya tidak bentrok dengan library lain yang memakai Handlebars global.
3. **Dikompilasi sekali** saat modul pertama kali di-import (saat server start), bukan setiap request. Kalau ada file yang hilang, server **langsung gagal start**. Lebih baik ketahuan saat deploy daripada saat user mendaftar.
4. **Mode `strict`:** variabel yang tidak ada (misalnya typo `{{nmae}}`) langsung menjadi error, bukan diam-diam menjadi string kosong.
5. **Type-safe:** tipe `TemplateContexts` menentukan variabel wajib per template. `renderTemplate("verify-email", {...})` dengan variabel yang kurang langsung menjadi error TypeScript.
6. **Daftar sinkron:** objek `TEMPLATES` diberi `satisfies Record<TemplateName, true>`. Kalau template ditambahkan ke `TemplateContexts` tapi lupa didaftarkan di `TEMPLATES`, TypeScript langsung protes.

### Menambah template baru

1. Buat `src/emails/templates/<nama>.html.hbs` (bungkus dengan `{{#> layout}}`) dan `<nama>.text.hbs`.
2. Di `src/lib/email-templates.ts`, tambahkan entri ke `TemplateContexts` **dan** ke `TEMPLATES`.
3. Buat fungsi perakit di modul terkait (misalnya `xxx.emails.ts`) yang memanggil `renderTemplate` dan mengembalikan `MailMessage`.
4. Kirim dengan `trySendMail` atau `sendMail`.

## Deliverability (supaya tidak masuk spam)

Email masuk spam saat development itu **normal**. Penyebab umumnya:

| Penyebab | Solusi |
|---|---|
| Link mengarah ke `http://localhost` | Hilang dengan sendirinya di production (`WEB_ORIGIN` berupa domain `https`) |
| Click/open tracking aktif | Matikan di Brevo |
| Domain baru, belum punya reputasi | Reputasi naik seiring waktu. Tandai "Not spam" di inbox sendiri |
| Nama pengirim tidak konsisten | Samakan `APP_NAME` dengan nama di `MAIL_FROM` |
| `no-reply` tanpa alamat balasan | Pertimbangkan menambahkan `replyTo` ke alamat yang benar-benar ada |
| SPF/DKIM/DMARC gagal | Periksa record DNS (Gmail → Show original) |

Alat bantu: **mail-tester.com**. Kirim email ke alamat acak yang diberikan situs itu, dan kamu akan mendapat skor 1–10 beserta alasannya. Untuk production, daftarkan domain di **Google Postmaster Tools**, lalu setelah beberapa minggu perketat DMARC dari `p=none` ke `p=quarantine`.

## Di test

`trySendMail`, `sendMail`, dan `verifyMailer` di-mock untuk semua test (`tests/setup/mocks.ts`). Tidak ada email yang benar-benar terkirim. Template tetap di-render sungguhan, sehingga test juga memastikan semua template valid. Lihat [15-testing.md](15-testing.md).
