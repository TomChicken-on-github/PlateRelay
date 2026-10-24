import { defineConfig } from "drizzle-kit";

/* Only used to generate migrations (pnpm db:generate); the app migrates itself on start. */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
});
