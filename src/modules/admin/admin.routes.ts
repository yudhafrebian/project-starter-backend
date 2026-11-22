import { Router } from "express";
import { Role } from "../../generated/prisma/enums";
import { requireAuth } from "../../middlewares/requireAuth";
import { requireRole } from "../../middlewares/requireRole";
import { validateBody } from "../../middlewares/validate";
import * as controller from "./admin.controller";
import { updateUserStatusSchema } from "./admin.schema";

export const router = Router();

router.use(requireAuth, requireRole(Role.SUPER_ADMIN));

router.get("/users", controller.ListUsers);
router.patch(
  "/users/:id/status",
  validateBody(updateUserStatusSchema),
  controller.UpdateUserStatus,
);
