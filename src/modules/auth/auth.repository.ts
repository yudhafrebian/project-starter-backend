import { prisma } from "../../config/prisma";
import {
  OAuthProvider,
  VerificationTokenType,
} from "../../generated/prisma/enums";
import { IRefreshToken } from "./auth.types";

export const findByEmail = (email: string) =>
  prisma.user.findUnique({
    where: {
      email,
    },
  });

export const findUserById = (id: string) =>
  prisma.user.findUnique({ where: { id } });

export const updatePasswordHas = (id: string, passwordHash: string) =>
  prisma.user.update({
    where: {
      id,
    },
    data: {
      passwordHash,
    },
  });

export const createRefreshToken = (data: IRefreshToken) =>
  prisma.refreshToken.create({ data });

export const findRefreshToken = (tokenHash: string) =>
  prisma.refreshToken.findUnique({
    where: {
      tokenHash,
    },
    include: {
      user: {
        select: {
          active: true,
        },
      },
    },
  });

export const consumeRefreshToken = (id: string) =>
  prisma.refreshToken.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

export const revokeFamily = (familyId: string) =>
  prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

export const revokeAllUserTokens = (userId: string) =>
  prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

export const createUser = (data: {
  email: string;
  name: string;
  passwordHash: string;
}) => prisma.user.create({ data });

export const updateUnverifiedUser = (
  id: string,
  data: { name: string; passwordHash: string },
) => prisma.user.update({ where: { id }, data });

export const createVerificationToken = (data: {
  userId: string;
  type: VerificationTokenType;
  tokenHash: string;
  expiresAt: Date;
}) => prisma.verificationToken.create({ data });

export const findVerificationToken = (tokenHash: string) =>
  prisma.verificationToken.findUnique({ where: { tokenHash } });

export const findLatestVerificationToken = (
  userId: string,
  type: VerificationTokenType,
) =>
  prisma.verificationToken.findFirst({
    where: { userId, type },
    orderBy: { createdAt: "desc" },
  });

export const invalidateVerificationTokens = (
  userId: string,
  type: VerificationTokenType,
) =>
  prisma.verificationToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });

export const markEmailVerified = (tokenId: string, userId: string) =>
  prisma.$transaction(async (tx) => {
    const { count } = await tx.verificationToken.updateMany({
      where: { id: tokenId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) return false;

    await tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date() },
    });
    await tx.verificationToken.updateMany({
      where: {
        userId,
        type: VerificationTokenType.EMAIL_VERIFICATION,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    return true;
  });

export const resetPasswordWithToken = (
  tokenId: string,
  userId: string,
  passwordHash: string,
) =>
  prisma.$transaction(async (tx) => {
    const { count } = await tx.verificationToken.updateMany({
      where: { id: tokenId, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) return null;

    const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    const user = await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        emailVerifiedAt: current.emailVerifiedAt ?? new Date(),
      },
    });

    await tx.verificationToken.updateMany({
      where: {
        userId,
        type: VerificationTokenType.PASSWORD_RESET,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    await tx.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return user;
  });

export const findGoogleAccount = (sub: string) =>
  prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: OAuthProvider.GOOGLE,
        providerAccountId: sub,
      },
    },
    include: { user: true },
  });

export const linkGoogleAccount = (
  userId: string,
  google: { sub: string; email: string },
  wasVerified: boolean,
) =>
  prisma.user.update({
    where: { id: userId },
    data: {
      oauthAccounts: {
        create: {
          provider: OAuthProvider.GOOGLE,
          providerAccountId: google.sub,
          email: google.email,
        },
      },
      ...(!wasVerified && {
        emailVerifiedAt: new Date(),
        passwordHash: null,
        verificationTokens: {
          updateMany: {
            where: {
              type: VerificationTokenType.EMAIL_VERIFICATION,
              usedAt: null,
            },
            data: { usedAt: new Date() },
          },
        },
      }),
    },
  });

export const createUserWithGoogle = (data: {
  sub: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}) =>
  prisma.user.create({
    data: {
      email: data.email,
      name: data.name,
      avatarUrl: data.avatarUrl,
      emailVerifiedAt: new Date(),
      oauthAccounts: {
        create: {
          provider: OAuthProvider.GOOGLE,
          providerAccountId: data.sub,
          email: data.email,
        },
      },
    },
  });

const profileSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  role: true,
  emailVerifiedAt: true,
  passwordHash: true,
  createdAt: true,
  oauthAccounts: { select: { provider: true } },
} as const;

export const findProfileById = (id: string) =>
  prisma.user.findUnique({ where: { id }, select: profileSelect });

export const updateProfile = (
  id: string,
  data: { name?: string | undefined; avatarUrl?: string | null | undefined },
) =>
  prisma.user.update({ where: { id }, data, select: profileSelect });
