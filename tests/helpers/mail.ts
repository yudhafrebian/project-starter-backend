import { trySendMail } from "../../src/lib/mailer";
import type { MailMessage } from "../../src/lib/mailer";

const mocked = jest.mocked(trySendMail);

export const sentEmails = (): MailMessage[] => mocked.mock.calls.map(([msg]) => msg);

export const emailsTo = (to: string) => sentEmails().filter((m) => m.to === to);

export const lastEmailTo = (to: string): MailMessage => {
  const list = emailsTo(to);
  const last = list[list.length - 1];
  if (!last) throw new Error(`tidak ada email ke ${to}`);
  return last;
};

export const extractToken = (msg: MailMessage): string => {
  const match = msg.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error("token tidak ditemukan di email");
  return match[1];
};
