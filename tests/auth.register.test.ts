import { prisma } from "../src/config/prisma";
import { createUser, resetDb } from "./helpers/db";
import { agent } from "./helpers/http";
import { emailsTo, extractToken, lastEmailTo } from "./helpers/mail";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const REGISTER = "/api/v1/auth/register";
const VERIFY = "/api/v1/auth/verify-email";
const RESEND = "/api/v1/auth/resend-verification";
const LOGIN = "/api/v1/auth/login";

const body = { name: "Sari", email: "sari@test.com", password: "password-sari-123" };

describe("register & verifikasi email", () => {
  it("alur lengkap: register → login ditolak → verifikasi → login berhasil", async () => {
    const reg = await agent().post(REGISTER).send(body);
    expect(reg.status).toBe(202);
    expect(reg.body.code).toBe("registration_received");

    const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.role).toBe("USER");

    const mail = lastEmailTo(body.email);
    expect(mail.subject).toMatch(/Verifikasi/);
    expect(mail.text).toContain("http://localhost:3000/verify-email?token=");

    expect((await agent().post(LOGIN).send(body)).status).toBe(403);

    const verify = await agent().post(VERIFY).send({ token: extractToken(mail) });
    expect(verify.status).toBe(200);
    expect(verify.body.code).toBe("email_verified");

    expect((await agent().post(LOGIN).send(body)).status).toBe(200);
  });

  it("token verifikasi hanya bisa dipakai sekali", async () => {
    await agent().post(REGISTER).send(body);
    const token = extractToken(lastEmailTo(body.email));

    expect((await agent().post(VERIFY).send({ token })).status).toBe(200);
    const again = await agent().post(VERIFY).send({ token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("invalid_verification_token");
  });

  it("token verifikasi kedaluwarsa → 400", async () => {
    await agent().post(REGISTER).send(body);
    const token = extractToken(lastEmailTo(body.email));
    await prisma.verificationToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await agent().post(VERIFY).send({ token })).status).toBe(400);
  });

  it("token asal-asalan → 400", async () => {
    expect((await agent().post(VERIFY).send({ token: "token-ngawur" })).status).toBe(400);
  });

  it("nama di email di-escape (anti XSS)", async () => {
    await agent().post(REGISTER).send({ ...body, name: "<b>Tes</b>" });
    const mail = lastEmailTo(body.email);
    expect(mail.html).toContain("&lt;b&gt;Tes&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>Tes</b>");
  });

  it("email sudah terverifikasi → respons SAMA, kirim email 'akun sudah ada', password tidak berubah", async () => {
    const existing = await createUser({ email: body.email });
    const fresh = await agent().post(REGISTER).send({ ...body, email: "baru@test.com" });
    const dup = await agent().post(REGISTER).send(body);

    expect(dup.status).toBe(202);
    expect(dup.body).toEqual(fresh.body);
    expect(lastEmailTo(body.email).subject).toMatch(/Percobaan pendaftaran/);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(after.passwordHash).toBe(existing.passwordHash);
  });

  it("email belum terverifikasi → password ditimpa, link lama tidak berlaku (anti pre-account takeover)", async () => {
    await agent().post(REGISTER).send({ ...body, password: "password-penyerang" });
    const attackerToken = extractToken(lastEmailTo(body.email));

    await agent().post(REGISTER).send(body);
    const ownerToken = extractToken(lastEmailTo(body.email));

    expect((await agent().post(VERIFY).send({ token: attackerToken })).status).toBe(400);
    expect((await agent().post(VERIFY).send({ token: ownerToken })).status).toBe(200);

    const attackerLogin = await agent()
      .post(LOGIN)
      .send({ email: body.email, password: "password-penyerang" });
    expect(attackerLogin.status).toBe(401);
    expect((await agent().post(LOGIN).send(body)).status).toBe(200);
  });

  it("email di-normalisasi ke huruf kecil", async () => {
    await agent().post(REGISTER).send({ ...body, email: "  SARI@Test.com " });
    const user = await prisma.user.findUnique({ where: { email: "sari@test.com" } });
    expect(user).not.toBeNull();
  });

  it("role dari body diabaikan (tidak bisa daftar sebagai SUPER_ADMIN)", async () => {
    await agent().post(REGISTER).send({ ...body, role: "SUPER_ADMIN" });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: body.email } });
    expect(user.role).toBe("USER");
  });

  it("validasi: password terlalu pendek → 400", async () => {
    const res = await agent().post(REGISTER).send({ ...body, password: "pendek" });
    expect(res.status).toBe(400);
  });

  it("validasi: password lebih dari 72 byte → 400 (batas bcrypt)", async () => {
    expect((await agent().post(REGISTER).send({ ...body, password: "a".repeat(73) })).status).toBe(400);
    expect((await agent().post(REGISTER).send({ ...body, password: "a".repeat(72) })).status).toBe(202);
  });

  it("validasi: password multibyte dihitung per byte, bukan per karakter", async () => {
    const res = await agent().post(REGISTER).send({ ...body, password: "é".repeat(37) });
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/resend-verification", () => {
  it("email tidak terdaftar → 202, tidak ada email", async () => {
    const res = await agent().post(RESEND).send({ email: "x@test.com" });
    expect(res.status).toBe(202);
    expect(emailsTo("x@test.com")).toHaveLength(0);
  });

  it("email sudah terverifikasi → 202, tidak ada email", async () => {
    await createUser({ email: "a@test.com" });
    const res = await agent().post(RESEND).send({ email: "a@test.com" });
    expect(res.status).toBe(202);
    expect(emailsTo("a@test.com")).toHaveLength(0);
  });

  it("cooldown: resend langsung setelah register tidak mengirim email baru", async () => {
    await agent().post(REGISTER).send(body);
    await agent().post(RESEND).send({ email: body.email });
    expect(emailsTo(body.email)).toHaveLength(1);
  });

  it("setelah cooldown: email baru terkirim dan link lama tidak berlaku", async () => {
    await agent().post(REGISTER).send(body);
    const oldToken = extractToken(lastEmailTo(body.email));

    await prisma.verificationToken.updateMany({ data: { createdAt: new Date(Date.now() - 120_000) } });

    await agent().post(RESEND).send({ email: body.email });
    expect(emailsTo(body.email)).toHaveLength(2);
    const newToken = extractToken(lastEmailTo(body.email));

    expect((await agent().post(VERIFY).send({ token: oldToken })).status).toBe(400);
    expect((await agent().post(VERIFY).send({ token: newToken })).status).toBe(200);
  });
});
