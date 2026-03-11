import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./types";
import { auth } from "./routes/auth";
import { me } from "./routes/me";
import { projects } from "./routes/projects";
import { keys } from "./routes/keys";
import { dashboard } from "./routes/dashboard";
import { ingest } from "./routes/ingest";
import { orgs } from "./routes/orgs";
import { publicApi } from "./routes/public";
import { symbols } from "./routes/symbols";
import { peFiles } from "./routes/pe_files";

const app = new Hono<AppEnv>();

// CORS for dashboard routes (cookies, credentialed). Ingest does NOT use cookies,
// so it skips this — clients call api directly with a Bearer token.
app.use("/api/projects/*", (c, next) =>
  cors({
    origin: c.env.APP_ORIGIN,
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })(c, next),
);
app.use("/api/me/*", (c, next) =>
  cors({ origin: c.env.APP_ORIGIN, credentials: true })(c, next),
);
app.use("/api/auth/*", (c, next) =>
  cors({ origin: c.env.APP_ORIGIN, credentials: true })(c, next),
);
app.use("/api/orgs/*", (c, next) =>
  cors({
    origin: c.env.APP_ORIGIN,
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })(c, next),
);
// Public dashboard routes: GET-only, no auth, allow any origin (so public
// dashboards can be embedded or hit from anywhere).
app.use("/p/*", (_c, next) =>
  cors({ origin: "*", credentials: false, allowMethods: ["GET", "OPTIONS"] })(_c, next),
);

app.get("/api/health", (c) => c.json({ ok: true }));

// Per-IP rate limit on unauthenticated, CPU/DB-touching surfaces. Prevents an
// attacker from flooding the OAuth callback or public dashboards to drive up
// Worker CPU + D1 read costs on our account.
async function ipRateLimit(c: Context<AppEnv>, next: Next) {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  const { success } = await c.env.PUBLIC_LIMITER.limit({ key: ip });
  if (!success) return c.json({ error: "rate_limited" }, 429);
  await next();
}
app.use("/api/auth/*", ipRateLimit);
app.use("/p/*", ipRateLimit);

app.route("/api/auth", auth);
app.route("/api/me", me);
app.route("/api/projects", projects);
app.route("/api/projects", keys);
app.route("/api/projects", dashboard);
app.route("/api/projects", symbols);
app.route("/api/projects", peFiles);
app.route("/api/orgs", orgs);
app.route("/api/v1", ingest);
app.route("/p", publicApi);

app.notFound((c) => c.json({ error: "not_found" }, 404));
app.onError((err, c) => {
  console.error("worker_error", {
    msg: err.message,
    stack: err.stack,
    path: c.req.path,
    method: c.req.method,
  });
  // Don't echo err.message — can leak internal paths, SQL, secrets.
  return c.json({ error: "internal" }, 500);
});

export default app;
