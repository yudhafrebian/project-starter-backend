import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { logger } from "./lib/logger";
import { verifyMailer } from "./lib/mailer";

const server = app.listen(env.PORT, () => {
  logger.info(`project starter running on port ${env.PORT}`);
});

verifyMailer()
  .then(() => logger.info("SMTP ready"))
  .catch((err) => logger.warn({ err }, "SMTP not reachable"));

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
