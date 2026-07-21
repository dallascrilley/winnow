import assert from "node:assert/strict";
import { test } from "node:test";

import { computeSignature, createWakeHandler } from "./handler.mjs";

const NOW = Date.parse("2026-07-17T22:00:00.000Z");
const SECRET = "example-wake-secret-for-tests-only";
const INSTANCE_TAGS = { project: "inbound-lite", environment: "portfolio" };

function createDependencies(overrides = {}) {
  const calls = {
    claimNonce: [],
    describeInstance: 0,
    startInstance: 0,
    stopInstance: 0,
    saveLease: [],
    scheduleStop: [],
  };
  const claimedNonces = new Set();
  let instanceState = "stopped";
  let lease = null;

  const dependencies = {
    now: () => NOW,
    getSecret: async () => SECRET,
    claimNonce: async ({ nonce, expiresAt }) => {
      calls.claimNonce.push({ nonce, expiresAt });
      if (claimedNonces.has(nonce)) return false;
      claimedNonces.add(nonce);
      return true;
    },
    describeInstance: async () => {
      calls.describeInstance += 1;
      return { state: instanceState, tags: INSTANCE_TAGS };
    },
    startInstance: async () => {
      calls.startInstance += 1;
      instanceState = "pending";
    },
    stopInstance: async () => {
      calls.stopInstance += 1;
      instanceState = "stopping";
    },
    readLease: async () => lease,
    saveLease: async (nextLease) => {
      lease = nextLease;
      calls.saveLease.push(nextLease);
    },
    scheduleStop: async (nextLease) => {
      calls.scheduleStop.push(nextLease);
    },
    ...overrides,
  };

  return {
    calls,
    dependencies,
    getLease: () => lease,
    setInstanceState: (state) => {
      instanceState = state;
    },
    setLease: (nextLease) => {
      lease = nextLease;
    },
  };
}

function signedEvent({
  method = "POST",
  path = "/wake",
  nonce = "example-nonce-00000001",
  timestamp = Math.floor(NOW / 1000),
  body = "",
  signature,
} = {}) {
  const resolvedSignature =
    signature ??
    computeSignature({
      secret: SECRET,
      method,
      path,
      timestamp: String(timestamp),
      nonce,
      body,
    });

  return {
    rawPath: path,
    body,
    isBase64Encoded: false,
    headers: {
      "x-inbound-nonce": nonce,
      "x-inbound-signature": resolvedSignature,
      "x-inbound-timestamp": String(timestamp),
    },
    requestContext: { http: { method, path } },
  };
}

function jsonBody(response) {
  return JSON.parse(response.body);
}

test("rejects invalid signatures before reading instance state", async () => {
  const { calls, dependencies } = createDependencies();
  const handler = createWakeHandler(dependencies);

  const response = await handler(signedEvent({ signature: "0".repeat(64) }));

  assert.equal(response.statusCode, 401);
  assert.deepEqual(jsonBody(response), { error: "unauthorized" });
  assert.equal(calls.describeInstance, 0);
});

test("rejects expired timestamps", async () => {
  const { calls, dependencies } = createDependencies();
  const handler = createWakeHandler(dependencies);

  const response = await handler(
    signedEvent({ timestamp: Math.floor(NOW / 1000) - 61 }),
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(jsonBody(response), { error: "unauthorized" });
  assert.equal(calls.describeInstance, 0);
});

test("rejects a duplicate signed nonce", async () => {
  const { dependencies } = createDependencies();
  const handler = createWakeHandler(dependencies);
  const event = signedEvent();

  assert.equal((await handler(event)).statusCode, 202);
  const duplicate = await handler(event);

  assert.equal(duplicate.statusCode, 409);
  assert.deepEqual(jsonBody(duplicate), { error: "replayed_request" });
});

test("fails closed when the instance tag does not match", async () => {
  const { calls, dependencies } = createDependencies({
    describeInstance: async () => ({
      state: "stopped",
      tags: { project: "another-project" },
    }),
  });
  const handler = createWakeHandler(dependencies);

  const response = await handler(signedEvent());

  assert.equal(response.statusCode, 503);
  assert.deepEqual(jsonBody(response), { error: "temporarily_unavailable" });
  assert.equal(calls.startInstance, 0);
});

test("starts a stopped instance and creates a 60-minute lease", async () => {
  const { calls, dependencies, getLease } = createDependencies();
  const handler = createWakeHandler(dependencies);

  const response = await handler(signedEvent());

  assert.equal(response.statusCode, 202);
  assert.deepEqual(jsonBody(response), {
    state: "starting",
    leaseExpiresAt: "2026-07-17T23:00:00.000Z",
  });
  assert.equal(calls.startInstance, 1);
  assert.equal(calls.scheduleStop.length, 1);
  assert.equal(getLease().expiresAt, NOW + 60 * 60 * 1000);
});

test("renews pending and running instances without starting twice", async () => {
  const fixture = createDependencies();
  const handler = createWakeHandler(fixture.dependencies);

  fixture.setInstanceState("pending");
  const pending = await handler(
    signedEvent({ nonce: "example-nonce-00000002" }),
  );
  fixture.setInstanceState("running");
  const running = await handler(
    signedEvent({ nonce: "example-nonce-00000003" }),
  );

  assert.equal(pending.statusCode, 202);
  assert.equal(jsonBody(pending).state, "starting");
  assert.equal(running.statusCode, 200);
  assert.equal(jsonBody(running).state, "online");
  assert.equal(fixture.calls.startInstance, 0);
  assert.equal(fixture.calls.scheduleStop.length, 2);
});

test("serializes concurrent activations and starts once", async () => {
  let now = NOW;
  const fixture = createDependencies({ now: () => now++ });
  const handler = createWakeHandler(fixture.dependencies);

  const responses = await Promise.all([
    handler(signedEvent({ nonce: "example-nonce-00000004" })),
    handler(signedEvent({ nonce: "example-nonce-00000005" })),
  ]);

  assert.equal(fixture.calls.startInstance, 1);
  assert.equal(fixture.calls.scheduleStop.length, 2);
  assert.ok(
    fixture.calls.scheduleStop[1].expiresAt >=
      fixture.calls.scheduleStop[0].expiresAt,
  );
  assert.deepEqual(
    responses.map((response) => jsonBody(response).state),
    ["starting", "starting"],
  );
});

test("returns a minimized authenticated status response", async () => {
  const fixture = createDependencies();
  fixture.setInstanceState("running");
  fixture.setLease({
    leaseId: "lease-example",
    expiresAt: NOW + 10 * 60 * 1000,
  });
  const handler = createWakeHandler(fixture.dependencies);

  const response = await handler(
    signedEvent({
      method: "GET",
      path: "/status",
      nonce: "example-nonce-00000006",
    }),
  );
  const body = jsonBody(response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(body, {
    state: "online",
    leaseExpiresAt: "2026-07-17T22:10:00.000Z",
  });
  assert.doesNotMatch(response.body, /arn:aws|i-[a-f0-9]+|172\.|10\./i);
});

test("stops only the current expired lease", async () => {
  const fixture = createDependencies({ now: () => NOW + 60_000 });
  fixture.setInstanceState("running");
  fixture.setLease({ leaseId: "lease-current", expiresAt: NOW });
  const handler = createWakeHandler(fixture.dependencies);

  const response = await handler({
    operation: "lease-expired",
    leaseId: "lease-current",
  });

  assert.deepEqual(response, { ok: true, action: "stopping" });
  assert.equal(fixture.calls.stopInstance, 1);
});

test("ignores stale or early lease-expiry events", async () => {
  const fixture = createDependencies();
  fixture.setInstanceState("running");
  fixture.setLease({
    leaseId: "lease-current",
    expiresAt: NOW + 60_000,
  });
  const handler = createWakeHandler(fixture.dependencies);

  const stale = await handler({
    operation: "lease-expired",
    leaseId: "lease-old",
  });
  const early = await handler({
    operation: "lease-expired",
    leaseId: "lease-current",
  });

  assert.deepEqual(stale, { ok: true, action: "ignored" });
  assert.deepEqual(early, { ok: true, action: "ignored" });
  assert.equal(fixture.calls.stopInstance, 0);
});

test("redacts AWS failures from public responses", async () => {
  const { dependencies } = createDependencies({
    describeInstance: async () => {
      throw new Error(
        "AccessDenied for arn:aws:ec2:us-east-1:111122223333:instance/i-secret",
      );
    },
  });
  const handler = createWakeHandler(dependencies);

  const response = await handler(signedEvent());

  assert.equal(response.statusCode, 503);
  assert.deepEqual(jsonBody(response), { error: "temporarily_unavailable" });
  assert.doesNotMatch(response.body, /AccessDenied|arn:aws|i-secret/);
});

test("returns 404 for unrecognized routes without touching AWS", async () => {
  const { calls, dependencies } = createDependencies();
  const handler = createWakeHandler(dependencies);

  const response = await handler(
    signedEvent({ method: "GET", path: "/unknown" }),
  );

  assert.equal(response.statusCode, 404);
  assert.deepEqual(jsonBody(response), { error: "not_found" });
  assert.equal(calls.describeInstance, 0);
});
