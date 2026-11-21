export interface IRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  userAgent: string | null;
  ip: string | null;
}

export type SessionMeta = {
  userAgent: string | undefined;
  ip: string | undefined;
};

export type AuthTokens = { accessToken: string; refreshToken: string };
