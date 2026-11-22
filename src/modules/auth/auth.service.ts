import { Role } from "../../generated/prisma/enums";
import { HttpError } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/hash-password";
import {
  generateRefreshToken,
  hashToken,
  REFRESH_TTL_SECONDS,
  signAccessToken,
} from "../../lib/token";
import { Prisma } from "../../generated/prisma/client";
import { VerificationTokenType } from "../../generated/prisma/enums";
import { generateRandomToken } from "../../lib/token";
import { trySendMail } from "../../lib/mailer";
import {
  accountExistsEmail,
  passwordChangedEmail,
  RESET_PASSWORD_TTL_MINUTES,
  resetPasswordEmail,
  verificationEmail,
  VERIFY_EMAIL_TTL_HOURS,
} from "./auth.emails";

import * as repo from "./auth.repository";
import { AuthTokens, SessionMeta } from "./auth.types";
import { GoogleProfile, verifyGoogleIdToken } from "../../lib/google";

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

const accountDisabled = () =>
  new HttpError(403, "account_disabled", undefined, "Account is disabled");

const REUSE_GRACE_MS = 10_000;

const VERIFY_TTL_MS = VERIFY_EMAIL_TTL_HOURS * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const RESET_TTL_MS = RESET_PASSWORD_TTL_MINUTES * 60 * 1000;

const emailNotVerified = () =>
  new HttpError(
    403,
    "email_not_verified",
    undefined,
    "Please verify your email first",
  );

const invalidVerificationToken = () =>
  new HttpError(
    400,
    "invalid_verification_token",
    undefined,
    "Verification link is invalid or expired",
  );

const issueVerificationToken = async (
  userId: string,
  type: VerificationTokenType,
  ttlMs: number,
) => {
  await repo.invalidateVerificationTokens(userId, type);
  const token = generateRandomToken();
  await repo.createVerificationToken({
    userId,
    type,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
};

const sendVerification = async (user: {
  id: string;
  email: string;
  name: string;
}) => {
  const token = await issueVerificationToken(
    user.id,
    VerificationTokenType.EMAIL_VERIFICATION,
    VERIFY_TTL_MS,
  );
  await trySendMail(verificationEmail(user.email, user.name, token));
};

export const register = async (input: {
  name: string;
  email: string;
  password: string;
}) => {
  const passwordHash = await hashPassword(input.password);
  const existing = await repo.findByEmail(input.email);

  if (!existing) {
    try {
      const user = await repo.createUser({
        email: input.email,
        name: input.name,
        passwordHash,
      });
      await sendVerification(user);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      )
        return;
      throw err;
    }
    return;
  }

  if (!existing.emailVerifiedAt) {
    const user = await repo.updateUnverifiedUser(existing.id, {
      name: input.name,
      passwordHash,
    });
    await sendVerification(user);
    return;
  }

  await trySendMail(accountExistsEmail(existing.email));
};

export const verifyEmail = async (token: string) => {
  const stored = await repo.findVerificationToken(hashToken(token));
  if (
    !stored ||
    stored.type !== VerificationTokenType.EMAIL_VERIFICATION ||
    stored.usedAt ||
    stored.expiresAt < new Date()
  ) {
    throw invalidVerificationToken();
  }

  const ok = await repo.markEmailVerified(stored.id, stored.userId);
  if (!ok) throw invalidVerificationToken();
};

export const resendVerification = async (email: string) => {
  const user = await repo.findByEmail(email);
  if (!user || user.emailVerifiedAt || !user.active) return;

  const last = await repo.findLatestVerificationToken(
    user.id,
    VerificationTokenType.EMAIL_VERIFICATION,
  );
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS)
    return;

  await sendVerification(user);
};

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
    const isRace = Date.now() - stored.revokedAt.getTime() < REUSE_GRACE_MS;
    if (!isRace) await repo.revokeFamily(stored.familyId);
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
  if (!user.emailVerifiedAt) throw emailNotVerified();

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

const invalidResetToken = () =>
  new HttpError(
    400,
    "invalid_reset_token",
    undefined,
    "Reset link is invalid or expired",
  );

export const forgotPassword = async (email: string) => {
  const user = await repo.findByEmail(email);
  if (!user || !user.active) return;

  const last = await repo.findLatestVerificationToken(
    user.id,
    VerificationTokenType.PASSWORD_RESET,
  );
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS)
    return;

  const token = await issueVerificationToken(
    user.id,
    VerificationTokenType.PASSWORD_RESET,
    RESET_TTL_MS,
  );
  await trySendMail(resetPasswordEmail(user.email, user.name, token));
};

export const resetPassword = async (token: string, newPassword: string) => {
  const stored = await repo.findVerificationToken(hashToken(token));
  if (
    !stored ||
    stored.type !== VerificationTokenType.PASSWORD_RESET ||
    stored.usedAt ||
    stored.expiresAt < new Date()
  ) {
    throw invalidResetToken();
  }

  const user = await repo.resetPasswordWithToken(
    stored.id,
    stored.userId,
    await hashPassword(newPassword),
  );
  if (!user) throw invalidResetToken();

  await trySendMail(passwordChangedEmail(user.email, user.name));
};

const resolveGoogleUser = async (google: GoogleProfile) => {
  const account = await repo.findGoogleAccount(google.sub);
  if (account) return account.user;

  const existing = await repo.findByEmail(google.email);
  if (existing) {
    return repo.linkGoogleAccount(
      existing.id,
      google,
      existing.emailVerifiedAt !== null,
    );
  }

  return repo.createUserWithGoogle({
    sub: google.sub,
    email: google.email,
    name: google.name ?? google.email.split("@")[0]!,
    avatarUrl: google.picture ?? null,
  });
};

export const loginWithGoogle = async (
  credential: string,
  meta: SessionMeta,
) => {
  const google = await verifyGoogleIdToken(credential);

  let user;
  try {
    user = await resolveGoogleUser(google);
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const account = await repo.findGoogleAccount(google.sub);
      if (!account) {
        throw new HttpError(
          409,
          "google_account_conflict",
          undefined,
          "This email is already linked to a different Google account",
        );
      }
      user = account.user;
    } else {
      throw err;
    }
  }

  if (!user.active) throw accountDisabled();

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

type ProfileRow = NonNullable<Awaited<ReturnType<typeof repo.findProfileById>>>;

const toProfileDto = (u: ProfileRow) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  role: u.role as Role,
  emailVerified: u.emailVerifiedAt !== null,
  hasPassword: u.passwordHash !== null,
  providers: u.oauthAccounts.map((a) => a.provider),
  createdAt: u.createdAt,
});

export const getProfile = async (userId: string) => {
  const user = await repo.findProfileById(userId);
  if (!user)
    throw new HttpError(404, "user_not_found", undefined, "User not found");
  return toProfileDto(user);
};

export const updateProfile = async (
  userId: string,
  data: { name?: string | undefined; avatarUrl?: string | null | undefined },
) => {
  const user = await repo.updateProfile(userId, data);
  return toProfileDto(user);
};
