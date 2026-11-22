import { prisma } from "../src/config/prisma";
import { createUser, DEFAULT_PASSWORD, resetDb } from "./helpers/db";
import { agent, csrf, getCookie, loginAs, raw } from "./helpers/http";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const LOGIN = "/api/v1/auth/login";
const REFRESH = "/api/v1/auth/refresh";

describe("POST /auth/login", () => {
  it("berhasil: mengembalikan user dan mengeset 2 cookie", async () => {
    await createUser({ email: "a@test.com" });
    const { res } = await loginAs("a@test.com");

    expect(res.body.data).toMatchObject({ email: "a@test.com", role: "USER" });
    expect(getCookie(res, "access_token")).toBeDefined();
    expect(getCookie(res, "refresh_token")).toBeDefined();
    expect(await prisma.refreshToken.count()).toBe(1);
  });

  it("email di-normalisasi (spasi & huruf besar diabaikan)", async () => {
    await createUser({ email: "a@test.com" });
    const res = await agent().post(LOGIN).send({ email: "  A@Test.COM ", password: DEFAULT_PASSWORD });
    expect(res.status).toBe(200);
  });

  it("password salah dan email tidak terdaftar → error yang SAMA", async () => {
    await createUser({ email: "a@test.com" });
    const wrongPw = await agent().post(LOGIN).send({ email: "a@test.com", password: "salah-banget-123" });
    const noUser = await agent().post(LOGIN).send({ email: "x@test.com", password: "salah-banget-123" });

    expect(wrongPw.status).toBe(401);
    expect(noUser.status).toBe(401);
    expect(wrongPw.body).toEqual(noUser.body);
  });

  it("email belum terverifikasi → 403 email_not_verified", async () => {
    await createUser({ email: "a@test.com", verified: false });
    const res = await agent().post(LOGIN).send({ email: "a@test.com", password: DEFAULT_PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("email_not_verified");
  });

  it("email belum terverifikasi + password salah → 401 (status verifikasi tidak bocor)", async () => {
    await createUser({ email: "a@test.com", verified: false });
    const res = await agent().post(LOGIN).send({ email: "a@test.com", password: "salah-banget-123" });
    expect(res.status).toBe(401);
  });

  it("user nonaktif → 401", async () => {
    await createUser({ email: "a@test.com", active: false });
    const res = await agent().post(LOGIN).send({ email: "a@test.com", password: DEFAULT_PASSWORD });
    expect(res.status).toBe(401);
  });

  it("user Google-only (tanpa password) → 401 invalid_credentials", async () => {
    await createUser({ email: "g@test.com", password: null });
    const res = await agent().post(LOGIN).send({ email: "g@test.com", password: "apa-saja-12345" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_credentials");
  });

  it("body tidak valid → 400 validation_failed", async () => {
    const res = await agent().post(LOGIN).send({ email: "bukan-email", password: "" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });
});

describe("CSRF & auth guard", () => {
  it("POST tanpa header X-Requested-With → 403 csrf_blocked", async () => {
    const res = await raw().post(LOGIN).send({ email: "a@test.com", password: "x" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("csrf_blocked");
  });

  it("GET /me tanpa login → 401", async () => {
    const res = await agent().get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("access token palsu → 401", async () => {
    const res = await raw().get("/api/v1/auth/me").set("Cookie", "access_token=token-palsu");
    expect(res.status).toBe(401);
  });

  it("access token juga diterima lewat header Authorization: Bearer", async () => {
    await createUser({ email: "a@test.com" });
    const { res: loginRes } = await loginAs("a@test.com");
    const token = getCookie(loginRes, "access_token");

    const res = await raw().get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe("POST /auth/refresh", () => {
  it("rotation: refresh token berganti, token lama dicabut, familyId sama", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: a, res: loginRes } = await loginAs("a@test.com");
    const oldToken = getCookie(loginRes, "refresh_token");

    const res = await a.post(REFRESH);
    expect(res.status).toBe(204);
    expect(getCookie(res, "refresh_token")).toBeDefined();
    expect(getCookie(res, "refresh_token")).not.toBe(oldToken);

    const rows = await prisma.refreshToken.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.revokedAt).not.toBeNull();
    expect(rows[1]!.revokedAt).toBeNull();
    expect(rows[1]!.familyId).toBe(rows[0]!.familyId);
  });

  it("token disimpan sebagai hash, bukan nilai aslinya", async () => {
    await createUser({ email: "a@test.com" });
    const { res } = await loginAs("a@test.com");
    const token = getCookie(res, "refresh_token")!;

    const row = await prisma.refreshToken.findFirstOrThrow();
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reuse token lama (di luar masa toleransi) → 401 dan SELURUH sesi dicabut", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: a, res: loginRes } = await loginAs("a@test.com");
    const oldToken = getCookie(loginRes, "refresh_token")!;
    await a.post(REFRESH);

    await prisma.refreshToken.updateMany({
      where: { revokedAt: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const reuse = await raw().post(REFRESH).set(csrf).set("Cookie", `refresh_token=${oldToken}`);
    expect(reuse.status).toBe(401);

    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    expect((await a.post(REFRESH)).status).toBe(401);
  });

  it("reuse dalam masa toleransi (2 tab bersamaan) → 401 tapi sesi TIDAK dicabut", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: a, res: loginRes } = await loginAs("a@test.com");
    const oldToken = getCookie(loginRes, "refresh_token")!;
    await a.post(REFRESH);

    const reuse = await raw().post(REFRESH).set(csrf).set("Cookie", `refresh_token=${oldToken}`);
    expect(reuse.status).toBe(401);
    expect((await a.post(REFRESH)).status).toBe(204);
  });

  it("refresh token kedaluwarsa → 401", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: a } = await loginAs("a@test.com");
    await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await a.post(REFRESH)).status).toBe(401);
  });

  it("user dinonaktifkan → refresh 401", async () => {
    const user = await createUser({ email: "a@test.com" });
    const { agent: a } = await loginAs("a@test.com");
    await prisma.user.update({ where: { id: user.id }, data: { active: false } });

    expect((await a.post(REFRESH)).status).toBe(401);
  });

  it("tanpa cookie → 401", async () => {
    expect((await agent().post(REFRESH)).status).toBe(401);
  });
});

describe("logout", () => {
  it("POST /logout mencabut sesi di DB dan menghapus cookie", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: a } = await loginAs("a@test.com");

    const res = await a.post("/api/v1/auth/logout");
    expect(res.status).toBe(204);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    expect((await a.post(REFRESH)).status).toBe(401);
  });

  it("POST /logout tanpa sesi tetap 204", async () => {
    expect((await agent().post("/api/v1/auth/logout")).status).toBe(204);
  });

  it("POST /logout-all mencabut sesi di SEMUA perangkat", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: hp } = await loginAs("a@test.com");
    const { agent: laptop } = await loginAs("a@test.com");

    expect((await hp.post("/api/v1/auth/logout-all")).status).toBe(204);
    expect((await laptop.post(REFRESH)).status).toBe(401);
  });

  it("logout hanya mencabut sesi perangkat itu, perangkat lain tetap login", async () => {
    await createUser({ email: "a@test.com" });
    const { agent: hp } = await loginAs("a@test.com");
    const { agent: laptop } = await loginAs("a@test.com");

    await hp.post("/api/v1/auth/logout");
    expect((await laptop.post(REFRESH)).status).toBe(204);
  });
});
