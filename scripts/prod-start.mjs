/**
 * Production workspace runner (U8): one container, all five apps.
 *
 * Spawns each app's Nitro build (apps/<id>/.output/server/index.mjs) on a
 * fixed loopback port, then serves a tiny proxy on 0.0.0.0:8080 that routes
 * /<appId>/* to the matching app — the same contract as the dev gateway,
 * plus an optional public prefix strip (the demo lives at
 * demos.dallascrilley.com/inbound, and the ALB forwards the path as-is).
 *
 * Per-app DATABASE_URL is derived from DATABASE_URL_BASE + "_" + appId so a
 * single RDS instance carries all five databases.
 */
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const APPS = [
  { id: "analytics", port: 8100 },
  { id: "dispatch", port: 8101 },
  { id: "forms", port: 8102 },
  { id: "qualify", port: 8103 },
  { id: "scheduler", port: 8104 },
];
const GATEWAY_PORT = Number(process.env.WORKSPACE_PORT ?? 8080);
const PREFIX = (process.env.WORKSPACE_PUBLIC_PREFIX ?? "").replace(/\/$/, "");
const DB_BASE = process.env.DATABASE_URL_BASE; // e.g. postgres://u:p@host:5432

// RDS starts with only the master `postgres` database — create one database
// per app before anything boots. App db plugins then apply their own
// migrations on first connection.
if (DB_BASE) {
  const { default: postgres } = await import("postgres");
  const sql = postgres(`${DB_BASE}/postgres?sslmode=require`, {
    max: 1,
    connect_timeout: 20,
  });
  for (const app of APPS) {
    const dbName = `inbound_${app.id}`;
    const exists =
      await sql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
    if (exists.length === 0) {
      await sql.unsafe(`CREATE DATABASE "${dbName}"`);
      console.log(`[runner] created database ${dbName}`);
    }
  }
  await sql.end();
}

const children = [];
for (const app of APPS) {
  const entry = path.join(
    ROOT,
    "apps",
    app.id,
    ".output",
    "server",
    "index.mjs",
  );
  const env = {
    ...process.env,
    PORT: String(app.port),
    HOST: "127.0.0.1",
    NITRO_PORT: String(app.port),
    NITRO_HOST: "127.0.0.1",
  };
  if (DB_BASE)
    env.DATABASE_URL = `${DB_BASE}/inbound_${app.id}?sslmode=require`;
  const child = spawn("node", [entry], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${app.id}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${app.id}] ${d}`));
  child.on("exit", (code) => {
    console.error(
      `[runner] ${app.id} exited (${code}) — shutting down for restart`,
    );
    process.exit(1);
  });
  children.push(child);
  console.log(`[runner] spawned ${app.id} on 127.0.0.1:${app.port}`);
}

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    sock.once("connect", () => {
      sock.end();
      resolve(true);
    });
    sock.once("error", () => resolve(false));
    setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, 1500);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    let urlPath = req.url ?? "/";
    if (PREFIX && (urlPath === PREFIX || urlPath.startsWith(`${PREFIX}/`))) {
      urlPath = urlPath.slice(PREFIX.length) || "/";
    }
    if (urlPath === "/healthz") {
      const checks = await Promise.all(APPS.map((a) => portOpen(a.port)));
      const ok = checks.every(Boolean);
      res.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok,
          apps: APPS.map((a, i) => ({ id: a.id, up: checks[i] })),
        }),
      );
      return;
    }
    if (urlPath === "/") {
      res.writeHead(302, { location: `${PREFIX}/forms/f/talk-to-sales` });
      res.end();
      return;
    }
    const seg = urlPath.split("/")[1] ?? "";
    const app = APPS.find((a) => a.id === seg);
    if (!app) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("unknown app path");
      return;
    }
    const proxy = http.request(
      {
        host: "127.0.0.1",
        port: app.port,
        path: urlPath,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${app.port}` },
        timeout: 120_000,
      },
      (upstream) => {
        res.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(res);
      },
    );
    proxy.on("timeout", () => {
      proxy.destroy();
      if (!res.headersSent) res.writeHead(504);
      res.end();
    });
    proxy.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(proxy);
  } catch (err) {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(GATEWAY_PORT, "0.0.0.0", () => {
  console.log(
    `[runner] gateway on :${GATEWAY_PORT} (prefix "${PREFIX || "/"}")`,
  );
});
