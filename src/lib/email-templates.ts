import fs from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";
import { env } from "../config/env";

const TEMPLATE_DIR = path.join(__dirname, "../emails/templates");

type TemplateContexts = {
  "verify-email": { name: string; link: string; expiresInHours: number };
  "account-exists": { loginLink: string };
  "reset-password": { name: string; link: string; expiresInMinutes: number };
  "password-changed": { name: string; forgotPasswordLink: string };
};

export type TemplateName = keyof TemplateContexts;

const TEMPLATES = {
  "verify-email": true,
  "account-exists": true,
  "reset-password": true,
  "password-changed": true,
} satisfies Record<TemplateName, true>;

const hbs = Handlebars.create();
type Template = ReturnType<typeof hbs.compile>;

const read = (file: string) =>
  fs.readFileSync(path.join(TEMPLATE_DIR, file), "utf8");

hbs.registerPartial("layout", read("layout.html.hbs"));

const compiled = Object.fromEntries(
  (Object.keys(TEMPLATES) as TemplateName[]).map((name) => [
    name,
    {
      html: hbs.compile(read(`${name}.html.hbs`), { strict: true }),
      text: hbs.compile(read(`${name}.text.hbs`), {
        strict: true,
        noEscape: true,
      }),
    },
  ]),
) as Record<TemplateName, { html: Template; text: Template }>;

export const renderTemplate = <K extends TemplateName>(
  name: K,
  context: TemplateContexts[K],
) => {
  const ctx = {
    ...context,
    appName: env.APP_NAME,
    year: new Date().getFullYear(),
  };
  const template = compiled[name];
  return { html: template.html(ctx), text: template.text(ctx) };
};
