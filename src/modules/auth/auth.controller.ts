import type { Request, Response, NextFunction } from "express";
import * as authService from "./auth.service";
import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  accessCookieOptions,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
  refreshCookieOptions,
} from "../../lib/token";
import { AuthTokens, SessionMeta } from "./auth.types";

const sessionMeta = (req: Request): SessionMeta => ({
  userAgent: req.get("user-agent")?.slice(0, 512),
  ip: req.ip,
});

const setAuthCookies = (res: Response, tokens: AuthTokens) => {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...accessCookieOptions,
    maxAge: ACCESS_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...refreshCookieOptions,
    maxAge: REFRESH_TTL_SECONDS * 1000,
  });
};

const clearAuthCookies = (res: Response) => {
  res.clearCookie(ACCESS_COOKIE, accessCookieOptions);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
};

export const Login = async (req: Request, res: Response) => {
  const { tokens, user } = await authService.login(
    req.body.email,
    req.body.password,
    sessionMeta(req),
  );
  setAuthCookies(res, tokens);
  res.status(200).send({
    success: true,
    code: "login_success",
    message: "Login Success",
    data: user,
  });
};

export const Refresh = async (req: Request, res: Response) => {
  try {
    const tokens = await authService.refreshSession(
      req.cookies?.[REFRESH_COOKIE],
      sessionMeta(req),
    );
    setAuthCookies(res, tokens);
    res.status(204).end();
  } catch (err) {
    clearAuthCookies(res);
    throw err;
  }
};

export const Logout = async (req: Request, res: Response) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE]);
  clearAuthCookies(res);
  res.status(204).end();
};

export const LogoutAll = async (req: Request, res: Response) => {
  await authService.logoutAll(req.user!.id);
  clearAuthCookies(res);
  res.status(204).end();
};

export const Me = async (req: Request, res: Response) => {
  res.status(200).send({ success: true, data: req.user });
};

export const ChangePassword = async (req: Request, res: Response) => {
  const tokens = await authService.changePassword(
    req.user!.id,
    req.body.currentPassword,
    req.body.newPassword,
    sessionMeta(req),
  );
  setAuthCookies(res, tokens);
  res
    .status(200)
    .send({ success: true, message: "Password Changed Successfully" });
};
