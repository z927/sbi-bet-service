import { buildServer } from "./server.ts";
import { getSettings } from "./config.ts";

const settings = getSettings();
const app = await buildServer();

try {
  await app.listen({ host: settings.host, port: settings.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
