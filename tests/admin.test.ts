import { prisma } from "../src/config/prisma";
import { Role } from "../src/generated/prisma/enums";
import { createUser, resetDb } from "./helpers/db";
import { agent, loginAs } from "./helpers/http";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const USERS = "/api/v1/admin/users";

const setup = async () => {
  const admin = await createUser({ email: "admin@test.com", name: "Admin", role: Role.SUPER_ADMIN });
  const user = await createUser({ email: "user@test.com", name: "Budi" });
  return { admin, user };
};

describe("requireRole", () => {
  it("tanpa login → 401, user biasa → 403, super admin → 200", async () => {
    await setup();
    expect((await agent().get(USERS)).status).toBe(401);

    const { agent: asUser } = await loginAs("user@test.com");
    const forbidden = await asUser.get(USERS);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe("forbidden");

    const { agent: asAdmin } = await loginAs("admin@test.com");
    expect((await asAdmin.get(USERS)).status).toBe(200);
  });

  it("role diturunkan → akses admin langsung hilang (role dibaca dari DB tiap request)", async () => {
    const { admin } = await setup();
    const { agent: asAdmin } = await loginAs("admin@test.com");
    await prisma.user.update({ where: { id: admin.id }, data: { role: Role.USER } });

    expect((await asAdmin.get(USERS)).status).toBe(403);
  });
});

describe("GET /admin/users", () => {
  it("daftar user + meta pagination, tanpa passwordHash", async () => {
    await setup();
    const { agent: asAdmin } = await loginAs("admin@test.com");

    const res = await asAdmin.get(USERS);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("pencarian berdasarkan email atau nama (tidak peka huruf besar)", async () => {
    await setup();
    const { agent: asAdmin } = await loginAs("admin@test.com");

    const byName = await asAdmin.get(USERS).query({ search: "BUDI" });
    expect(byName.body.data).toHaveLength(1);
    expect(byName.body.data[0].email).toBe("user@test.com");
  });

  it("pagination", async () => {
    await setup();
    for (let i = 0; i < 3; i++) await createUser({ email: `extra${i}@test.com` });
    const { agent: asAdmin } = await loginAs("admin@test.com");

    const res = await asAdmin.get(USERS).query({ page: 2, pageSize: 2 });
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
  });

  it("pageSize di atas batas → 400", async () => {
    await setup();
    const { agent: asAdmin } = await loginAs("admin@test.com");
    expect((await asAdmin.get(USERS).query({ pageSize: 500 })).status).toBe(400);
  });
});

describe("PATCH /admin/users/:id/status", () => {
  it("menonaktifkan user → sesi user itu langsung mati, lalu bisa diaktifkan lagi", async () => {
    const { user } = await setup();
    const { agent: asUser } = await loginAs("user@test.com");
    const { agent: asAdmin } = await loginAs("admin@test.com");

    const off = await asAdmin.patch(`${USERS}/${user.id}/status`).send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.data.active).toBe(false);

    expect((await asUser.get("/api/v1/auth/me")).status).toBe(401);
    expect((await asUser.post("/api/v1/auth/refresh")).status).toBe(401);
    await expect(loginAs("user@test.com")).rejects.toThrow();

    const on = await asAdmin.patch(`${USERS}/${user.id}/status`).send({ active: true });
    expect(on.status).toBe(200);
    await expect(loginAs("user@test.com")).resolves.toBeDefined();
  });

  it("admin tidak bisa mengubah status dirinya sendiri → 400", async () => {
    const { admin } = await setup();
    const { agent: asAdmin } = await loginAs("admin@test.com");
    const res = await asAdmin.patch(`${USERS}/${admin.id}/status`).send({ active: false });
    expect(res.status).toBe(400);
  });

  it("super admin lain tidak bisa dinonaktifkan → 403", async () => {
    await setup();
    const other = await createUser({ email: "admin2@test.com", role: Role.SUPER_ADMIN });
    const { agent: asAdmin } = await loginAs("admin@test.com");
    const res = await asAdmin.patch(`${USERS}/${other.id}/status`).send({ active: false });
    expect(res.status).toBe(403);
  });

  it("user tidak ditemukan → 404", async () => {
    await setup();
    const { agent: asAdmin } = await loginAs("admin@test.com");
    const res = await asAdmin
      .patch(`${USERS}/00000000-0000-4000-8000-000000000000/status`)
      .send({ active: false });
    expect(res.status).toBe(404);
  });

  it("id bukan UUID → 400, bukan 500", async () => {
    await setup();
    const { agent: asAdmin } = await loginAs("admin@test.com");
    expect((await asAdmin.patch(`${USERS}/bukan-uuid/status`).send({ active: false })).status).toBe(400);
  });

  it("body tidak valid → 400", async () => {
    const { user } = await setup();
    const { agent: asAdmin } = await loginAs("admin@test.com");
    expect((await asAdmin.patch(`${USERS}/${user.id}/status`).send({ active: "ya" })).status).toBe(400);
  });

  it("user biasa tidak bisa memakai endpoint ini → 403", async () => {
    const { admin } = await setup();
    const { agent: asUser } = await loginAs("user@test.com");
    expect((await asUser.patch(`${USERS}/${admin.id}/status`).send({ active: false })).status).toBe(403);
  });
});
