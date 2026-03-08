import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "@mini-terminal/shared";
import { overviewRoutes } from "./routes/overview.js";
import { metricsRoutes } from "./routes/metrics.js";
import { walletRoutes } from "./routes/wallets.js";
import { lineageRoutes } from "./routes/lineage.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

await app.register(overviewRoutes);
await app.register(metricsRoutes);
await app.register(walletRoutes);
await app.register(lineageRoutes);

app.get("/api/health", async () => ({ status: "ok" }));

try {
  await app.listen({ port: config.apiPort, host: "0.0.0.0" });
  console.log(`API listening on http://localhost:${config.apiPort}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
