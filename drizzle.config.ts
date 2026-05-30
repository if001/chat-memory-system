import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.db_migration" });
console.log("process.env.POSTGRES_URL", process.env.POSTGRES_URL);

export default defineConfig({
  schema: "./src/memory_system/infrastructure/postgres/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  verbose: true,
  dbCredentials: {
    url: process.env.POSTGRES_URL ?? "",
  },
});
