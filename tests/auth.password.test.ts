import { prisma } from "../src/config/prisma";
import { createUser, DEFAULT_PASSWORD, resetDb } from "./helpers/db";
import { agent, loginAs } from "./helpers/http";
import { emailsTo, extractToken, lastEmailTo } from "./helpers/mail";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const FORGOT = "/api/v1/auth/forgot-password";
const RESET = "/api/v1/auth/reset-password";
const CHANGE = "/api/v1/auth/change-password";
const LOGIN = "/api/v1/auth/login";
const NEW_PASSWORD = "password-baru-12345";

const requestResetToken = async (email: string) => {
  await agent().post(FORGOT).send({ email });
  return extractToken(lastEmailTo(email));
};

describe("lupa & reset password", () => {
  it("alur lengkap: password berganti, semua sesi dicabut, email notifikasi terkirim", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: session } = await loginAs("a@test.com");

    const forgot = await agent().post(FORGOT).send({ email: "a@test.com" });
    expect(forgot.status).toBe(202);
    const resetMail = lastEmailTo("a@test.com");
    expect(resetMail.subject).toMatch(/Atur ulang password/);
    expect(resetMail.text).toContain("http://localhost:3000/reset-password?token=");

    const reset = await agent()
      .post(RESET)
      .send({ token: extractToken(resetMail), newPassword: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect(reset.body.code).toBe("password_reset");

    expect((await session.post("/api/v1/auth/refresh")).status).toBe(401);
    expect(lastEmailTo("a@test.com").subject).toMatch(/telah diganti/);

    expect((await agent().post(LOGIN).send({ email: "a@test.com", password: DEFAULT_PASSWORD })).status).toBe(401);
    await expect(loginAs("a@test.com", NEW_PASSWORD)).resolves.toBeDefined();
  });

  it("token reset hanya bisa dipakai sekali", async () => {
    await createUser({ email: "a@test.com" });
    const token = await requestResetToken("a@test.com");

    await agent().post(RESET).send({ token, newPassword: NEW_PASSWORD });
    const again = await agent().post(RESET).send({ token, newPassword: "lain-lagi-12345" });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("invalid_reset_token");
  });

  it("token reset kedaluwarsa → 400", async () => {
    await createUser({ email: "a@test.com" });
    const token = await requestResetToken("a@test.com");
    await prisma.verificationToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await agent().post(RESET).send({ token, newPassword: NEW_PASSWORD })).status).toBe(400);
  });

  it("email tidak terdaftar → 202 dengan respons yang SAMA, tidak ada email", async () => {
    await createUser({ email: "a@test.com" });
    const known = await agent().post(FORGOT).send({ email: "a@test.com" });
    const unknown = await agent().post(FORGOT).send({ email: "x@test.com" });

    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    expect(emailsTo("x@test.com")).toHaveLength(0);
  });

  it("user nonaktif → tidak ada email reset", async () => {
    await createUser({ email: "a@test.com", active: false });
    await agent().post(FORGOT).send({ email: "a@test.com" });
    expect(emailsTo("a@test.com")).toHaveLength(0);
  });

  it("cooldown: permintaan kedua langsung tidak mengirim email baru", async () => {
    await createUser({ email: "a@test.com" });
    await agent().post(FORGOT).send({ email: "a@test.com" });
    await agent().post(FORGOT).send({ email: "a@test.com" });
    expect(emailsTo("a@test.com")).toHaveLength(1);
  });

  it("token VERIFIKASI EMAIL tidak bisa dipakai untuk reset password", async () => {
    await agent()
      .post("/api/v1/auth/register")
      .send({ name: "B", email: "b@test.com", password: "password-b-12345" });
    const verifyToken = extractToken(lastEmailTo("b@test.com"));

    const res = await agent().post(RESET).send({ token: verifyToken, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
  });

  it("reset juga memverifikasi email user yang belum terverifikasi", async () => {
    await createUser({ email: "a@test.com", verified: false });
    const token = await requestResetToken("a@test.com");

    await agent().post(RESET).send({ token, newPassword: NEW_PASSWORD });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "a@test.com" } });
    expect(user.emailVerifiedAt).not.toBeNull();
    await expect(loginAs("a@test.com", NEW_PASSWORD)).resolves.toBeDefined();
  });

  it("user Google-only bisa membuat password lewat reset", async () => {
    await createUser({ email: "g@test.com", password: null });
    const token = await requestResetToken("g@test.com");

    expect((await agent().post(RESET).send({ token, newPassword: NEW_PASSWORD })).status).toBe(200);
    await expect(loginAs("g@test.com", NEW_PASSWORD)).resolves.toBeDefined();
  });
});

describe("POST /auth/change-password", () => {
  it("berhasil: perangkat ini tetap login, perangkat lain ter-logout", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: thisDevice } = await loginAs("a@test.com");
    const { agent: otherDevice } = await loginAs("a@test.com");

    const res = await thisDevice
      .post(CHANGE)
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);

    expect((await thisDevice.get("/api/v1/auth/me")).status).toBe(200);
    expect((await thisDevice.post("/api/v1/auth/refresh")).status).toBe(204);
    expect((await otherDevice.post("/api/v1/auth/refresh")).status).toBe(401);

    await expect(loginAs("a@test.com", NEW_PASSWORD)).resolves.toBeDefined();
  });

  it("password saat ini salah → 400 wrong_password", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: a } = await loginAs("a@test.com");

    const res = await a.post(CHANGE).send({ currentPassword: "salah-banget-123", newPassword: NEW_PASSWORD });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("wrong_password");
  });

  it("password baru sama dengan yang lama → 400", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: a } = await loginAs("a@test.com");

    const res = await a.post(CHANGE).send({ currentPassword: DEFAULT_PASSWORD, newPassword: DEFAULT_PASSWORD });
    expect(res.status).toBe(400);
  });

  it("tanpa login → 401", async () => {
    const res = await agent().post(CHANGE).send({ currentPassword: DEFAULT_PASSWORD, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });
});
