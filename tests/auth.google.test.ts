import { prisma } from "../src/config/prisma";
import { HttpError } from "../src/lib/errors";
import { verifyGoogleIdToken, type GoogleProfile } from "../src/lib/google";
import { createUser, DEFAULT_PASSWORD, resetDb } from "./helpers/db";
import { agent, getCookie } from "./helpers/http";
import { extractToken, lastEmailTo } from "./helpers/mail";

jest.mock("../src/lib/google", () => ({ verifyGoogleIdToken: jest.fn() }));
const mockedVerify = jest.mocked(verifyGoogleIdToken);

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const GOOGLE = "/api/v1/auth/google";
const LOGIN = "/api/v1/auth/login";

const profile = (overrides: Partial<GoogleProfile> = {}): GoogleProfile => ({
  sub: "google-sub-123",
  email: "g@test.com",
  name: "Google User",
  picture: "https://lh3.googleusercontent.com/foto.png",
  ...overrides,
});

const loginGoogle = (p: GoogleProfile) => {
  mockedVerify.mockResolvedValueOnce(p);
  return agent().post(GOOGLE).send({ credential: "id-token-palsu" });
};

describe("POST /auth/google", () => {
  it("akun Google baru: user dibuat (terverifikasi, tanpa password) + OAuthAccount", async () => {
    const res = await loginGoogle(profile());

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: "g@test.com", role: "USER" });
    expect(getCookie(res, "access_token")).toBeDefined();
    expect(getCookie(res, "refresh_token")).toBeDefined();

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "g@test.com" },
      include: { oauthAccounts: true },
    });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(user.avatarUrl).toBe("https://lh3.googleusercontent.com/foto.png");
    expect(user.oauthAccounts).toHaveLength(1);
    expect(user.oauthAccounts[0]).toMatchObject({ provider: "GOOGLE", providerAccountId: "google-sub-123" });
  });

  it("login kedua: dikenali lewat sub, tidak ada user/akun duplikat", async () => {
    await loginGoogle(profile());
    const res = await loginGoogle(profile());

    expect(res.status).toBe(200);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.oAuthAccount.count()).toBe(1);
  });

  it("email di Google berubah: tetap dikenali sebagai user yang sama (lewat sub)", async () => {
    await loginGoogle(profile());
    const res = await loginGoogle(profile({ email: "email-baru@test.com" }));

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe("g@test.com");
    expect(await prisma.user.count()).toBe(1);
  });

  it("tanpa nama dari Google: nama diambil dari bagian depan email", async () => {
    await loginGoogle(profile({ name: undefined }));
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "g@test.com" } });
    expect(user.name).toBe("g");
  });

  it("email sudah terdaftar & terverifikasi: akun ditautkan, password TETAP ada", async () => {
    const existing = await createUser({ email: "g@test.com" });
    const res = await loginGoogle(profile());

    expect(res.status).toBe(200);
    expect(await prisma.user.count()).toBe(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(user.passwordHash).toBe(existing.passwordHash);

    expect((await agent().post(LOGIN).send({ email: "g@test.com", password: DEFAULT_PASSWORD })).status).toBe(200);
  });

  it("email terdaftar tapi BELUM terverifikasi: password lama dihapus (anti pre-account takeover)", async () => {
    await agent()
      .post("/api/v1/auth/register")
      .send({ name: "Penyerang", email: "g@test.com", password: "password-penyerang" });
    const attackerVerifyToken = extractToken(lastEmailTo("g@test.com"));

    const res = await loginGoogle(profile());
    expect(res.status).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "g@test.com" } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();

    expect((await agent().post(LOGIN).send({ email: "g@test.com", password: "password-penyerang" })).status).toBe(401);
    expect((await agent().post("/api/v1/auth/verify-email").send({ token: attackerVerifyToken })).status).toBe(400);
  });

  it("user sudah tertaut ke akun Google LAIN → 409 google_account_conflict", async () => {
    await loginGoogle(profile({ sub: "sub-pertama" }));
    const res = await loginGoogle(profile({ sub: "sub-kedua" }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("google_account_conflict");
  });

  it("user nonaktif → 403 account_disabled", async () => {
    await createUser({ email: "g@test.com", active: false });
    const res = await loginGoogle(profile());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("account_disabled");
  });

  it("token Google tidak valid → 401 invalid_google_token", async () => {
    mockedVerify.mockRejectedValueOnce(
      new HttpError(401, "invalid_google_token", undefined, "Invalid Google token"),
    );
    const res = await agent().post(GOOGLE).send({ credential: "token-rusak" });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("invalid_google_token");
    expect(await prisma.user.count()).toBe(0);
  });

  it("body tanpa credential → 400", async () => {
    const res = await agent().post(GOOGLE).send({});
    expect(res.status).toBe(400);
  });
});
