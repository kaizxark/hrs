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
  // Basic security headers on every response. HSTS is already applied at the
  // Vercel edge; nosniff/frame-deny/referrer hardening are set here so they
  // hold regardless of the hosting layer.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
    next();
  });
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // NOTE: the legacy /api/sync-events SSE endpoint was removed — it existed
  // to broadcast Google Sheets cache refreshes, and all reads now go straight
  // to Supabase, which is always current. Clients poll on a slow interval
  // instead of holding serverless connections open.

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
  // NOTE: no background poller — Supabase is queried live per request, so
  // there is nothing to pre-warm. Boot is instant.
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