import { prisma } from "../../config/prisma";
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

// Atomic: hanya berhasil kalau token BELUM dicabut. count = 0 → sudah dipakai request lain.
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
