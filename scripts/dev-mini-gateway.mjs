#!/usr/bin/env node
/**
 * Minimal local gateway for live form→qualify E2E without full workspace
 * (avoids Dispatch :8100 startup loop). Prefix-stripping reverse proxy:
 *   /forms/*     -> 127.0.0.1:8102/*
 *   /qualify/*   -> 127.0.0.1:8103/*
 *   /scheduler/* -> 127.0.0.1:8104/* (optional)
 *   /analytics/* -> 127.0.0.1:8101/* (optional)
 */
import http from "node:http";
import { request as httpRequest } from "node:http";

const PORT = Number(process.env.MINI_GATEWAY_PORT || 8080);
const MAP = {
  forms: Number(process.env.FORMS_PORT || 8102),
  qualify: Number(process.env.QUALIFY_PORT || 8103),
  scheduler: Number(process.env.SCHEDULER_PORT || 8104),
  analytics: Number(process.env.ANALYTICS_PORT || 8101),
};

function proxy(req, res, targetPort, restPath) {
  const headers = { ...req.headers, host: `127.0.0.1:${targetPort}` };
  const opts = {
    hostname: "127.0.0.1",
    port: targetPort,
    path: restPath || "/",
    method: req.method,
    headers,
  };
  const upstream = httpRequest(opts, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`upstream error: ${err.message}`);
  });
  req.pipe(upstream);
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  const m = url.match(/^\/(forms|qualify|scheduler|analytics)(\/.*)?(\?.*)?$/);
  if (!m) {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(
      "mini-gateway ok\npaths: /forms /qualify /scheduler /analytics\n",
    );
    return;
  }
  const app = m[1];
  const rest = `${m[2] || "/"}${m[3] || ""}`;
  proxy(req, res, MAP[app], rest);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mini-gateway listening http://127.0.0.1:${PORT}`);
  for (const [k, p] of Object.entries(MAP)) {
    console.log(`  /${k} -> 127.0.0.1:${p}`);
  }
});
