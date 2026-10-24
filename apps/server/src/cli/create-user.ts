import "reflect-metadata";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { NestFactory } from "@nestjs/core";
import { ROLE_IDS, type RoleId } from "@platerelay/shared";
import { AppModule } from "../app.module.js";
import { SYSTEM } from "../auth/actor.js";
import { AuthService } from "../auth/auth.service.js";
import { loadConfig } from "../config/config.js";

/*
 * Creates an account, e.g. the first Coreteam one:
 *   pnpm --filter @platerelay/server user:create -- --username admin --name 管理员 --role coreteam
 * The password is read from standard input, never from the command line.
 */
async function main() {
  const { values } = parseArgs({ options: { username: { type: "string" }, name: { type: "string" }, role: { type: "string", default: "user" } } });
  if (!values.username || !ROLE_IDS.includes(values.role as RoleId)) {
    console.error(`usage: user:create -- --username <name> [--name <display name>] [--role ${ROLE_IDS.join("|")}]`);
    process.exit(2);
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const password = (await rl.question("password: ")).trim();
  rl.close();
  if (password.length < 8) {
    console.error("password must be at least 8 characters");
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(loadConfig()), { logger: ["error", "warn"] });
  try {
    const id = await app.get(AuthService).createUser({ ...SYSTEM, device: "cli" }, { username: values.username, displayName: values.name ?? values.username, password, role: values.role as RoleId });
    console.log(`created ${values.username} (${values.role}) ${id}`);
  } finally {
    await app.close();
  }
}

void main();
