import { prisma } from "../../src/config/prisma";
import { hashPassword } from "../../src/lib/hash-password";
import { Role } from "../../src/generated/prisma/enums";

export const DEFAULT_PASSWORD = "password-tes-12345";

export const resetDb = async () => {
  const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (!dbName.includes("test")) throw new Error("resetDb hanya boleh di database test");

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "RefreshToken", "VerificationToken", "OAuthAccount", "User" RESTART IDENTITY CASCADE`,
  );
};

type CreateUserOptions = {
  email: string;
  name: string;
  password: string | null;
  role: Role;
  active: boolean;
  verified: boolean;
};

export const createUser = async (overrides: Partial<CreateUserOptions> = {}) => {
  const password = overrides.password === undefined ? DEFAULT_PASSWORD : overrides.password;
  return prisma.user.create({
    data: {
      email: overrides.email ?? "user@test.com",
      name: overrides.name ?? "User Test",
      passwordHash: password ? await hashPassword(password) : null,
      role: overrides.role ?? Role.USER,
      active: overrides.active ?? true,
      emailVerifiedAt: overrides.verified === false ? null : new Date(),
    },
  });
};
