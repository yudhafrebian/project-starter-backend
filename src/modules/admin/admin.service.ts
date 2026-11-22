import { HttpError } from "../../lib/errors";
import { Role } from "../../generated/prisma/enums";
import * as repo from "./admin.repository";

export const listUsers = async (params: {
  page: number;
  pageSize: number;
  search?: string | undefined;
}) => {
  const { items, total } = await repo.listUsers(params);
  return {
    items,
    meta: {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.ceil(total / params.pageSize),
    },
  };
};

export const updateUserStatus = async (
  actorId: string,
  targetId: string,
  active: boolean,
) => {
  if (actorId === targetId) {
    throw new HttpError(
      400,
      "cannot_change_own_status",
      undefined,
      "You cannot change your own status",
    );
  }

  const target = await repo.findUserById(targetId);
  if (!target)
    throw new HttpError(404, "user_not_found", undefined, "User not found");

  if (target.role === Role.SUPER_ADMIN) {
    throw new HttpError(
      403,
      "cannot_change_super_admin",
      undefined,
      "Super admin status cannot be changed",
    );
  }

  return repo.setUserActive(targetId, active);
};
