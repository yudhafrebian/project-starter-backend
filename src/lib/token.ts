import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export const ACCESS_COOKIE = "access_token";
export const REFRESH_COOKIE = "refresh_token";
export const ACCESS_TTL_SECONDS = 15 * 60; // 15 menit
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 hari

// ---- Access token (JWT) ----
export const signAccessToken = (userId: string): string =>
  jwt.sign({}, env.JWT_SECRET, {
    subject: userId,
    expiresIn: ACCESS_TTL_SECONDS,
    algorithm: "HS256",
  });

export const verifyAccessToken = (token: string): string | null => {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
    });
    return typeof payload === "object" && typeof payload.sub === "string"
      ? payload.sub
      : null;
  } catch {
    return null;
  }
};

// ---- Refresh token (string acak) ----
export const generateRefreshToken = () =>
  crypto.randomBytes(32).toString("base64url");

// SHA-256 cukup (bukan bcrypt): token sudah acak 256-bit, tidak bisa ditebak,
// dan kita perlu mencarinya di DB berdasarkan hash.
export const hashToken = (token: string) =>
  crypto.createHash("sha256").update(token).digest("hex");

// ---- Cookie ----
const baseCookie = {
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax" as const,
};

export const accessCookieOptions = { ...baseCookie, path: "/" };
// Refresh token hanya dikirim browser ke endpoint auth, tidak ikut ke setiap request.
export const refreshCookieOptions = { ...baseCookie, path: "/api/v1/auth" };
