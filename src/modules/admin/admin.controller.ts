import type { Request, Response } from "express";
import z from "zod";
import { HttpError } from "../../lib/errors";
import * as adminService from "./admin.service";
import { listUsersQuerySchema, userIdParamSchema } from "./admin.schema";

const parseOrThrow = <T extends z.ZodType>(
  schema: T,
  data: unknown,
): z.infer<T> => {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(
      400,
      "validation_failed",
      z.flattenError(result.error).fieldErrors,
      "Invalid Data",
    );
  }
  return result.data;
};

export const ListUsers = async (req: Request, res: Response) => {
  const query = parseOrThrow(listUsersQuerySchema, req.query);
  const result = await adminService.listUsers(query);
  res
    .status(200)
    .send({ success: true, data: result.items, meta: result.meta });
};

export const UpdateUserStatus = async (req: Request, res: Response) => {
  const { id } = parseOrThrow(userIdParamSchema, req.params);
  const user = await adminService.updateUserStatus(
    req.user!.id,
    id,
    req.body.active,
  );
  res.status(200).send({ success: true, data: user });
};
