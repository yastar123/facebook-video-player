import { config } from "dotenv"
import { defineConfig, env } from "prisma/config"

config({ path: ".env.development.local" })
config()

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
})
