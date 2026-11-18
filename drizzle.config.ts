import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/v2/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
});
