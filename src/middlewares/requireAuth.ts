import { HttpError } from "../lib/errors";
import type { Request, Response, NextFunction } from "express";
import { prisma } from "../config/prisma";
import { Role } from "../generated/prisma/enums";
import { ACCESS_COOKIE, verifyAccessToken } from "../lib/token";

const unauthenticated = () =>
  new HttpError(401, "unauthenticated", undefined, "Please login First");

export async function requireAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const token: string | undefined = req.cookies?.[ACCESS_COOKIE] ?? bearer;

  const userId = token ? verifyAccessToken(token) : null;
  if (!userId) throw unauthenticated();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, active: true },
  });

  if (!user || !user.active) throw unauthenticated();

  req.user = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as Role,
  };

  next();
}
