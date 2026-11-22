import { prisma } from "../../config/prisma";
import type { Prisma } from "../../generated/prisma/client";

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  role: true,
  active: true,
  emailVerifiedAt: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

export const listUsers = async (params: {
  page: number;
  pageSize: number;
  search?: string | undefined;
}) => {
  const where: Prisma.UserWhereInput = params.search
    ? {
        OR: [
          { email: { contains: params.search, mode: "insensitive" } },
          { name: { contains: params.search, mode: "insensitive" } },
        ],
      }
    : {};

  const [items, total] = await prisma.$transaction([
    prisma.user.findMany({
      where,
      select: publicUserSelect,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.user.count({ where }),
  ]);

  return { items, total };
};

export const findUserById = (id: string) =>
  prisma.user.findUnique({ where: { id }, select: publicUserSelect });

export const setUserActive = (id: string, active: boolean) =>
  prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: { active },
      select: publicUserSelect,
    });
    if (!active) {
      await tx.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return user;
  });
