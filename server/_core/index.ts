import "dotenv/config";
import express from "express";
import { createServer, type Server } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import {
  startProfilePoller,
  addBroadcaster,
  removeBroadcaster,
} from "./googleSheetsApi";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

/**
 * Build the Express app — body parsing, OAuth routes, the SSE sync channel,
 * tRPC, and (in production) the static SPA fallback.
 *
 * Exported separately from boot so Vercel serverless functions can mount the
 * exact same app without starting the in-process poller or binding a port.
 */
export async function createApp(): Promise<{ app: express.Express; server: Server }> {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // SSE endpoint — pushes a notification to admin clients every time the
  // server's profile cache is refreshed (by the background poller locally, or
  // by lazy read-path top-ups on Vercel). On Vercel the broadcast only reaches
  // clients connected to *this* function instance — the client falls back to
  // polling (refetchInterval) so this is a latency bonus, not a dependency.
  app.get("/api/sync-events", (req, res) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
    // Send an initial comment so the client knows the connection is open
    res.write(": connected\n\n");
    const send = (data: string) => res.write(data);
    addBroadcaster(send);
    // Heartbeat to keep the connection alive through proxies
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      removeBroadcaster(send);
    });
  });

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  return { app, server };
}

/** True when running under Vercel's serverless runtime (no port, no poller). */
export const isServerless = process.env.VERCEL === "1";

async function startLocalServer() {
  // Start the Google Sheets profile poller in the background.
  // First fetch is blocking; subsequent fetches run every poll interval.
  // Skipped on Vercel — cold starts must stay fast and the lazy read-path
  // top-ups (ensureFreshCache) keep the cache fresh per instance instead.
  await startProfilePoller();

  const { server } = await createApp();

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

if (!isServerless) {
  startLocalServer().catch(console.error);
}