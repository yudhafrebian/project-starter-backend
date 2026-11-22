const fs = require("node:fs");

fs.cpSync("src/emails/templates", "dist/emails/templates", { recursive: true });
console.log("✔ email templates copied to dist/");
