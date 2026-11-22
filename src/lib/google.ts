import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { HttpError } from "./errors";

const client = new OAuth2Client(env.GOOGLE_CLIENT_ID);

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string | undefined;
  picture: string | undefined;
};

export const verifyGoogleIdToken = async (
  idToken: string,
): Promise<GoogleProfile> => {
  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw new HttpError(
      401,
      "invalid_google_token",
      undefined,
      "Invalid Google token",
    );
  }

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new HttpError(
      401,
      "google_email_not_verified",
      undefined,
      "Google email is not verified",
    );
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name,
    picture: payload.picture,
  };
};
