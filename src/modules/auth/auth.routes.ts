import { Router } from "express";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from "./auth.schema";
import * as controller from "./auth.controller";
import {
  emailLimiter,
  loginLimiter,
  passwordResetLimiter,
} from "../../middlewares/rateLimit";
import { validateBody } from "../../middlewares/validate";
import { requireAuth } from "../../middlewares/requireAuth";

export const router = Router();

router.post(
  "/login",
  loginLimiter,
  validateBody(loginSchema),
  controller.Login,
);
router.post("/refresh", controller.Refresh);
router.post("/logout", controller.Logout);
router.post("/logout-all", requireAuth, controller.LogoutAll);
router.get("/me", requireAuth, controller.Me);
router.post(
  "/change-password",
  requireAuth,
  validateBody(changePasswordSchema),
  controller.ChangePassword,
);
router.post(
  "/register",
  emailLimiter,
  validateBody(registerSchema),
  controller.Register,
);
router.post(
  "/verify-email",
  validateBody(verifyEmailSchema),
  controller.VerifyEmail,
);
router.post(
  "/resend-verification",
  emailLimiter,
  validateBody(resendVerificationSchema),
  controller.ResendVerification,
);

router.post(
  "/forgot-password",
  emailLimiter,
  validateBody(forgotPasswordSchema),
  controller.ForgotPassword,
);
router.post(
  "/reset-password",
  passwordResetLimiter,
  validateBody(resetPasswordSchema),
  controller.ResetPassword,
);

router.post(
  "/google",
  loginLimiter,
  validateBody(googleLoginSchema),
  controller.GoogleLogin,
);

router.patch(
  "/me",
  requireAuth,
  validateBody(updateProfileSchema),
  controller.UpdateMe,
);
