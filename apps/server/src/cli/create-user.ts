import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { isRole } from "@platerelay/shared";
import { AppModule } from "../app.module.js";
import { AuthService } from "../auth/auth.service.js";
import { SYSTEM } from "../common/ctx.js";
import { loadConfig } from "../config/config.js";

/*
 * Creates an account from the command line: pnpm user:create <username> <display name> [role]
 * The password is read from standard input, so it never appears in the process list or the shell history.
 */
async function main() {
  const [username, displayName, role = "APPLICANT"] = process.argv.slice(2);
  let password = "";
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) password += String(chunk);
  password = password.replace(/\r?\n$/, "");
  if (!username || !displayName || !isRole(role) || !password || password.length < 8) {
    console.error("usage: pnpm user:create <username> <display name> [APPLICANT|STAFF|ADMIN] < file-with-the-password (8 characters or more)");
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), { logger: ["error", "warn"] });
  const user = await app.get(AuthService).createUser(SYSTEM, { username, displayName, password, role });
  console.log(`created ${user.role} ${user.username} (${user.id})`);
  await app.close();
}

void main();
