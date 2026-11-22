import { execSync } from "node:child_process";
import dotenv from "dotenv";

export default async function globalSetup() {
  dotenv.config({ path: ".env.test", override: true, quiet: true });

  const dbName = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
  if (!dbName.includes("test")) {
    throw new Error(`DATABASE_URL harus mengarah ke database test, sekarang: "${dbName}"`);
  }

  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
}
