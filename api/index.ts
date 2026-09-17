/**
 * Vercel serverless entry point for HRS.
 *
 * The whole Express app lives in the pre-built `dist/index.js` bundle (esbuild
 * resolves the `@shared/*`/`@/` path aliases at build time, so this function
 * never needs tsconfig-aware bundling — Vercel's tracer follows the static
 * `import { createApp }` into `dist/` and pulls in the external node_modules).
 *
 * `createApp()` only builds middleware — it never binds a port or starts the
 * in-process poller (that is guarded by `VERCEL === "1"`), so a cold start is
 * just module load + Express setup. The module-level `appPromise` builds the
 * app once per warm instance and reuses it across requests.
 *
 * `maxDuration` must stay within your plan's fluid-compute limit:
 *   - Hobby: max 60s (opt in to "Fluid compute" and cap at 60)
 *   - Pro:   up to 300s — raise the value below if your write operations
 *            (Apps Script round-trips, 10–40s) run long
 * The default 10s limit is NOT enough for the write path.
 */

export const maxDuration = 60;

type NodeReq = import("node:http").IncomingMessage;
type NodeRes = import("node:http").ServerResponse;

let appPromise: any;

async function loadApp() {
  try {
    const mod = await import("../dist/index.js");
    return await mod.createApp();
  } catch (err: any) {
    console.error("[api/index] Failed to load app:", err?.message ?? err);
    console.error("[api/index] Stack:", err?.stack?.substring(0, 1000));
    throw err;
  }
}

export default async function handler(req: NodeReq, res: NodeRes): Promise<void> {
  try {
    const promise = appPromise ?? (appPromise = loadApp());
    const { app } = await promise;
    (app as unknown as (req: NodeReq, res: NodeRes) => void)(req, res);
  } catch (err: any) {
    console.error("[api/index] Handler error:", err?.message ?? err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain");
      res.end(`Internal Server Error: ${err?.message ?? "unknown"}`);
    }
  }
}