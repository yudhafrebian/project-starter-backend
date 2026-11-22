import z from "zod";

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
});

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

export const updateUserStatusSchema = z.object({
  active: z.boolean(),
});
