import { prisma } from "../src/config/prisma";
import { OAuthProvider } from "../src/generated/prisma/enums";
import { signAccessToken } from "../src/lib/token";
import { createUser, resetDb } from "./helpers/db";
import { agent, getCookie, loginAs, raw } from "./helpers/http";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const ME = "/api/v1/auth/me";

describe("GET /auth/me", () => {
  it("user password: hasPassword true, providers kosong, tanpa passwordHash", async () => {
    await createUser({ email: "a@test.com", name: "Andi" });
    const { agent: a } = await loginAs("a@test.com");

    const res = await a.get(ME);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      email: "a@test.com",
      name: "Andi",
      role: "USER",
      emailVerified: true,
      hasPassword: true,
      providers: [],
    });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("user Google-only: hasPassword false, providers [GOOGLE]", async () => {
    const user = await createUser({ email: "g@test.com", password: null });
    await prisma.oAuthAccount.create({
      data: { provider: OAuthProvider.GOOGLE, providerAccountId: "sub-1", userId: user.id },
    });

    const res = await raw().get(ME).set("Cookie", `access_token=${signAccessToken(user.id)}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ hasPassword: false, providers: ["GOOGLE"] });
  });
});

describe("PATCH /auth/me", () => {
  const login = async () => {
    await createUser({ email: "a@test.com", name: "Andi" });
    return (await loginAs("a@test.com")).agent;
  };

  it("ubah nama saja: avatar tidak berubah", async () => {
    const a = await login();
    await a.patch(ME).send({ avatarUrl: "https://example.com/a.png" });

    const res = await a.patch(ME).send({ name: "Nama Baru" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: "Nama Baru", avatarUrl: "https://example.com/a.png" });
  });

  it("ubah avatar lalu hapus dengan null", async () => {
    const a = await login();

    const set = await a.patch(ME).send({ avatarUrl: "https://example.com/a.png" });
    expect(set.body.data.avatarUrl).toBe("https://example.com/a.png");

    const clear = await a.patch(ME).send({ avatarUrl: null });
    expect(clear.status).toBe(200);
    expect(clear.body.data.avatarUrl).toBeNull();
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["http (bukan https)", "http://example.com/a.png"],
    ["data:", "data:image/png;base64,AAAA"],
    ["bukan URL", "bukan-url"],
  ])("avatar %s ditolak → 400", async (_label, avatarUrl) => {
    const a = await login();
    expect((await a.patch(ME).send({ avatarUrl })).status).toBe(400);
  });

  it("body kosong → 400", async () => {
    const a = await login();
    expect((await a.patch(ME).send({})).status).toBe(400);
  });

  it("nama hanya spasi → 400", async () => {
    const a = await login();
    expect((await a.patch(ME).send({ name: "   " })).status).toBe(400);
  });

  it("role dan email di body diabaikan (tidak bisa naik jadi admin)", async () => {
    const a = await login();
    await a.patch(ME).send({ name: "Andi", role: "SUPER_ADMIN", email: "lain@test.com" });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: "a@test.com" } });
    expect(user.role).toBe("USER");
  });

  it("tanpa login → 401", async () => {
    expect((await agent().patch(ME).send({ name: "X" })).status).toBe(401);
  });

  it("cookie sesi tidak berubah saat update profil", async () => {
    const a = await login();
    const res = await a.patch(ME).send({ name: "X" });
    expect(getCookie(res, "access_token")).toBeUndefined();
  });
});
