import { config as dotenvConfig } from "dotenv";
import { existsSync } from "node:fs";
import { buildServer } from "./server.ts";
import { getSettings } from "./config.ts";

const envFile = [".env.local", ".env"].find((file) => existsSync(file));
if (envFile) {
  dotenvConfig({ path: envFile });
}

const settings = getSettings();
const app = await buildServer();

try {
  await app.listen({ host: settings.host, port: settings.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
