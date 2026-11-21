import { Role } from "../../generated/prisma/enums";
import { HttpError } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/hash-password";
import {
  generateRefreshToken,
  hashToken,
  REFRESH_TTL_SECONDS,
  signAccessToken,
} from "../../lib/token";

import * as repo from "./auth.repository";
import { AuthTokens, SessionMeta } from "./auth.types";

const invalidCredential = () =>
  new HttpError(
    401,
    "invalid_credentials",
    undefined,
    "Invalid email or password",
  );

const invalidSession = () =>
  new HttpError(
    401,
    "invalid_session",
    undefined,
    "Session expired, please login again",
  );

const REUSE_GRACE_MS = 10_000;

const issueToken = async (
  userId: string,
  familyId: string,
  meta: SessionMeta,
): Promise<AuthTokens> => {
  const refreshToken = generateRefreshToken();
  await repo.createRefreshToken({
    userId,
    familyId,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });
  return {
    accessToken: signAccessToken(userId),
    refreshToken,
  };
};

// Dipakai oleh login password, login Google, dll. → satu pintu untuk membuat sesi.
const createSession = async (userId: string, meta: SessionMeta) =>
  issueToken(userId, crypto.randomUUID(), meta);

export const refreshSession = async (
  refreshToken: string | undefined,
  meta: SessionMeta,
): Promise<AuthTokens> => {
  if (!refreshToken) throw invalidSession();

  const stored = await repo.findRefreshToken(hashToken(refreshToken));
  if (!stored) throw invalidSession();

  if (stored.revokedAt) {
    // Token yang sudah dipakai muncul lagi.
    // Baru saja dicabut (< 10 detik) → kemungkinan 2 tab refresh bersamaan, bukan pencurian.
    const isRace = Date.now() - stored.revokedAt.getTime() < REUSE_GRACE_MS;
    if (!isRace) await repo.revokeFamily(stored.familyId); // pencurian -> matikan sesi
    throw invalidSession();
  }

  if (stored.expiresAt < new Date() || !stored.user.active) {
    await repo.revokeFamily(stored.familyId);
    throw invalidSession();
  }

  const { count } = await repo.consumeRefreshToken(stored.id);
  if (count === 0) throw invalidSession();

  return issueToken(stored.userId, stored.familyId, meta);
};

// Dibuat dengan hashPassword agar cost-nya selalu sama dengan hash user asli.
// Langsung dibuat saat startup supaya login pertama tidak lebih lambat.
const dummyHash = hashPassword("dummy-password-not-used");

export const login = async (
  email: string,
  password: string,
  meta: SessionMeta,
) => {
  const user = await repo.findByEmail(email);
  const isPasswordValid = await verifyPassword(
    password,
    user?.passwordHash ?? (await dummyHash),
  );
  if (!user || !isPasswordValid || !user.active) throw invalidCredential();

  return {
    tokens: await createSession(user.id, meta),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
    },
  };
};

export const logout = async (refreshToken: string | undefined) => {
  if (!refreshToken) return;
  const stored = await repo.findRefreshToken(hashToken(refreshToken));
  if (stored) await repo.revokeFamily(stored.familyId);
};

export const logoutAll = async (userId: string) => {
  await repo.revokeAllUserTokens(userId);
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string,
  meta: SessionMeta,
) => {
  const user = await repo.findUserById(userId);
  if (
    !user ||
    !user.passwordHash ||
    !(await verifyPassword(currentPassword, user.passwordHash))
  ) {
    throw new HttpError(
      400,
      "wrong_password",
      { currentPassword: ["Current password is wrong"] },
      "Current password is wrong",
    );
  }
  await repo.updatePasswordHas(userId, await hashPassword(newPassword));
  await repo.revokeAllUserTokens(userId);
  return createSession(userId, meta);
};
