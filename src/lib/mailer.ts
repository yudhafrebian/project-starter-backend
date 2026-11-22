import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logger } from "./logger";

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export const sendMail = async (msg: MailMessage) => {
  await transporter.sendMail({ from: env.MAIL_FROM, ...msg });
};

export const trySendMail = async (msg: MailMessage) => {
  try {
    await sendMail(msg);
  } catch (err) {
    logger.error({ err, subject: msg.subject }, "failed to send email");
  }
};

export const verifyMailer = () => transporter.verify();
