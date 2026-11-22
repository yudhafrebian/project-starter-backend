import rateLimit from "express-rate-limit";
import { env } from "../config/env";
import { HttpError } from "../lib/errors";

const createLimiter = (limit: number, windowMs = 15 * 60 * 1000) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => env.NODE_ENV === "test",
    handler: (_req, _res, next) =>
      next(
        new HttpError(
          429,
          "too_many_attempts",
          undefined,
          "Too many attempts, try again later",
        ),
      ),
  });

export const loginLimiter = createLimiter(10);
export const emailLimiter = createLimiter(5);
export const passwordResetLimiter = createLimiter(10);
