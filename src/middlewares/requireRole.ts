import type { Request, Response, NextFunction } from "express";
import type { Role } from "../generated/prisma/enums";
import { HttpError } from "../lib/errors";

export const requireRole =
  (...allowed: [Role, ...Role[]]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(
        new HttpError(401, "unauthenticated", undefined, "Please login first"),
      );
    }
    if (!allowed.includes(req.user.role)) {
      return next(
        new HttpError(
          403,
          "forbidden",
          undefined,
          "You do not have access to this resource",
        ),
      );
    }
    next();
  };
