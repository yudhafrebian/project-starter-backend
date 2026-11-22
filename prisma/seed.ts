import z from "zod";
import { prisma } from "../src/config/prisma";
import { hashPassword } from "../src/lib/hash-password";
import { Role } from "../src/generated/prisma/enums";

const seedEnv = z
  .object({
    SEED_SUPERADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
    SEED_SUPERADMIN_PASSWORD: z.string().min(12, "minimal 12 karakter").max(256),
    SEED_SUPERADMIN_NAME: z.string().trim().min(1).default("Super Admin"),
  })
  .safeParse(process.env);

if (!seedEnv.success) {
  console.error("Env seed tidak valid:");
  console.error(seedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

const { SEED_SUPERADMIN_EMAIL, SEED_SUPERADMIN_PASSWORD, SEED_SUPERADMIN_NAME } =
  seedEnv.data;

async function seedSuperAdmin() {
  const existing = await prisma.user.findUnique({
    where: { email: SEED_SUPERADMIN_EMAIL },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: { role: Role.SUPER_ADMIN, active: true },
    });
    console.log(`✔ Super admin sudah ada: ${SEED_SUPERADMIN_EMAIL} (password tidak diubah)`);
    return;
  }

  await prisma.user.create({
    data: {
      email: SEED_SUPERADMIN_EMAIL,
      name: SEED_SUPERADMIN_NAME,
      passwordHash: await hashPassword(SEED_SUPERADMIN_PASSWORD),
      role: Role.SUPER_ADMIN,
      emailVerifiedAt: new Date(),
    },
  });
  console.log(`✔ Super admin dibuat: ${SEED_SUPERADMIN_EMAIL}`);
}

async function main() {
  await seedSuperAdmin();
}

main()
  .catch((err) => {
    console.error("✖ Seed gagal:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
