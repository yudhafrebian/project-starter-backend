import { Router } from "express";
import { changePasswordSchema, loginSchema } from "./auth.schema";
import * as controller from "./auth.controller";
import { loginLimiter } from "../../middlewares/rateLimit";
import { validateBody } from "../../middlewares/validate";
import { requireAuth } from "../../middlewares/requireAuth";

export const router = Router();

router.post(
  "/login",
  loginLimiter,
  validateBody(loginSchema),
  controller.Login,
);
router.post("/refresh", controller.Refresh)
router.post("/logout", controller.Logout);
router.post("/logout-all", requireAuth, controller.LogoutAll)
router.get("/me", requireAuth, controller.Me);
router.post(
  "/change-password",
  requireAuth,
  validateBody(changePasswordSchema),
  controller.ChangePassword,
);
