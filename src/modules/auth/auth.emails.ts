import { env } from "../../config/env";
import type { MailMessage } from "../../lib/mailer";
import { renderTemplate } from "../../lib/email-templates";

export const VERIFY_EMAIL_TTL_HOURS = 24;
export const RESET_PASSWORD_TTL_MINUTES = 60;

export const verificationEmail = (
  to: string,
  name: string,
  token: string,
): MailMessage => ({
  to,
  subject: `Verifikasi email kamu - ${env.APP_NAME}`,
  ...renderTemplate("verify-email", {
    name,
    link: `${env.WEB_ORIGIN}/verify-email?token=${encodeURIComponent(token)}`,
    expiresInHours: VERIFY_EMAIL_TTL_HOURS,
  }),
});

export const accountExistsEmail = (to: string): MailMessage => ({
  to,
  subject: `Percobaan pendaftaran - ${env.APP_NAME}`,
  ...renderTemplate("account-exists", {
    loginLink: `${env.WEB_ORIGIN}/login`,
  }),
});

export const resetPasswordEmail = (
  to: string,
  name: string,
  token: string,
): MailMessage => ({
  to,
  subject: `Atur ulang password - ${env.APP_NAME}`,
  ...renderTemplate("reset-password", {
    name,
    link: `${env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`,
    expiresInMinutes: RESET_PASSWORD_TTL_MINUTES,
  }),
});

export const passwordChangedEmail = (
  to: string,
  name: string,
): MailMessage => ({
  to,
  subject: `Password kamu telah diganti - ${env.APP_NAME}`,
  ...renderTemplate("password-changed", {
    name,
    forgotPasswordLink: `${env.WEB_ORIGIN}/forgot-password`,
  }),
});
