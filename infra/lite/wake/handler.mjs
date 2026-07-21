import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const AUTH_WINDOW_MS = 60_000;
const NONCE_TTL_MS = 5 * 60_000;
const LEASE_DURATION_MS = 60 * 60_000;
const EXPECTED_TAG_KEY = "project";
const EXPECTED_TAG_VALUE = "inbound-lite";
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

class ControlPlaneError extends Error {}

function publicResponse(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  };
}

function requestBody(event) {
  if (!event.body) return "";
  if (!event.isBase64Encoded) return String(event.body);
  return Buffer.from(String(event.body), "base64").toString("utf8");
}

function header(event, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (key.toLowerCase() === target) return String(value ?? "");
  }
  return "";
}

function canonicalRequest({ method, path, timestamp, nonce, body }) {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return [method.toUpperCase(), path, timestamp, nonce, bodyHash].join("\n");
}

export function computeSignature({
  secret,
  method,
  path,
  timestamp,
  nonce,
  body = "",
}) {
  return createHmac("sha256", secret)
    .update(canonicalRequest({ method, path, timestamp, nonce, body }))
    .digest("hex");
}

function signaturesMatch(expected, received) {
  if (!/^[a-f0-9]{64}$/.test(received)) return false;
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function routeFor(event) {
  const method = event.requestContext?.http?.method?.toUpperCase() ?? "";
  const path = event.rawPath ?? event.requestContext?.http?.path ?? "";
  if (method === "POST" && path === "/wake")
    return { method, path, action: "wake" };
  if (method === "GET" && path === "/status") {
    return { method, path, action: "status" };
  }
  return null;
}

function publicState(instanceState) {
  switch (instanceState) {
    case "stopped":
      return "offline";
    case "pending":
      return "starting";
    case "running":
      return "online";
    case "stopping":
      return "stopping";
    default:
      return "unavailable";
  }
}

function leaseBody(state, lease, now) {
  const body = { state };
  if (lease?.expiresAt > now) {
    body.leaseExpiresAt = new Date(lease.expiresAt).toISOString();
  }
  return body;
}

function hasExpectedTag(instance, dependencies) {
  const key = dependencies.expectedTagKey ?? EXPECTED_TAG_KEY;
  const value = dependencies.expectedTagValue ?? EXPECTED_TAG_VALUE;
  return instance.tags?.[key] === value;
}

function safeErrorName(error) {
  const name = String(error?.name ?? "Error");
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "Error";
}

function validateAuthInput({ timestamp, nonce, signature, now }) {
  if (!/^\d{10}$/.test(timestamp)) return false;
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return false;
  if (!/^[a-f0-9]{64}$/.test(signature)) return false;
  return Math.abs(now - Number(timestamp) * 1000) <= AUTH_WINDOW_MS;
}

async function authenticate(event, route, dependencies, now) {
  const timestamp = header(event, "x-inbound-timestamp");
  const nonce = header(event, "x-inbound-nonce");
  const signature = header(event, "x-inbound-signature");
  if (!validateAuthInput({ timestamp, nonce, signature, now })) {
    return {
      ok: false,
      response: publicResponse(401, { error: "unauthorized" }),
    };
  }

  const body = requestBody(event);
  if (Buffer.byteLength(body, "utf8") > 1_024) {
    return {
      ok: false,
      response: publicResponse(413, { error: "payload_too_large" }),
    };
  }

  const secret = await dependencies.getSecret();
  const expected = computeSignature({
    secret,
    method: route.method,
    path: route.path,
    timestamp,
    nonce,
    body,
  });
  if (!signaturesMatch(expected, signature)) {
    return {
      ok: false,
      response: publicResponse(401, { error: "unauthorized" }),
    };
  }

  const claimed = await dependencies.claimNonce({
    nonce,
    expiresAt: now + NONCE_TTL_MS,
  });
  if (!claimed) {
    return {
      ok: false,
      response: publicResponse(409, { error: "replayed_request" }),
    };
  }

  return { ok: true };
}

async function verifiedInstance(dependencies) {
  const instance = await dependencies.describeInstance();
  if (!instance || !hasExpectedTag(instance, dependencies)) {
    throw new ControlPlaneError("instance identity check failed");
  }
  return instance;
}

async function handleStatus(dependencies, now) {
  const [instance, lease] = await Promise.all([
    verifiedInstance(dependencies),
    dependencies.readLease(),
  ]);
  return publicResponse(
    200,
    leaseBody(publicState(instance.state), lease, now),
  );
}

async function renewLease(dependencies, now) {
  const lease = {
    leaseId: `lease-${now}-${randomUUID()}`,
    expiresAt: now + LEASE_DURATION_MS,
  };
  await dependencies.saveLease(lease);
  try {
    await dependencies.scheduleStop(lease);
  } catch (error) {
    try {
      await dependencies.stopInstance();
    } catch {
      // The public response remains redacted. CloudWatch receives only names.
    }
    throw error;
  }
  return lease;
}

async function handleWake(dependencies, now) {
  const instance = await verifiedInstance(dependencies);
  if (instance.state === "stopping") {
    return publicResponse(409, { state: "stopping" });
  }
  if (!["stopped", "pending", "running"].includes(instance.state)) {
    throw new ControlPlaneError("unsupported instance state");
  }

  if (instance.state === "stopped") await dependencies.startInstance();
  const lease = await renewLease(dependencies, now);
  const state = instance.state === "running" ? "online" : "starting";
  return publicResponse(
    state === "online" ? 200 : 202,
    leaseBody(state, lease, now),
  );
}

async function handleLeaseExpiry(event, dependencies, now) {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(String(event.leaseId ?? ""))) {
    throw new ControlPlaneError("invalid lease event");
  }
  const lease = await dependencies.readLease();
  if (!lease || lease.leaseId !== event.leaseId || lease.expiresAt > now) {
    return { ok: true, action: "ignored" };
  }

  const instance = await verifiedInstance(dependencies);
  if (["stopped", "stopping"].includes(instance.state)) {
    return { ok: true, action: "ignored" };
  }
  if (instance.state !== "running") {
    throw new ControlPlaneError("instance not ready to stop");
  }
  await dependencies.stopInstance();
  return { ok: true, action: "stopping" };
}

export function createWakeHandler(dependencies) {
  let queue = Promise.resolve();

  const dispatch = async (event) => {
    const now = dependencies.now();
    if (event?.operation === "lease-expired") {
      return handleLeaseExpiry(event, dependencies, now);
    }

    const route = routeFor(event ?? {});
    if (!route) return publicResponse(404, { error: "not_found" });

    try {
      const auth = await authenticate(event, route, dependencies, now);
      if (!auth.ok) return auth.response;
      return route.action === "status"
        ? await handleStatus(dependencies, now)
        : await handleWake(dependencies, now);
    } catch (error) {
      console.error("inbound-lite control failure", {
        name: safeErrorName(error),
      });
      return publicResponse(503, { error: "temporarily_unavailable" });
    }
  };

  return (event) => {
    const result = queue.then(
      () => dispatch(event),
      () => dispatch(event),
    );
    queue = result.catch(() => undefined);
    return result;
  };
}

async function createAwsDependencies() {
  const [dynamodb, ec2, scheduler, ssm] = await Promise.all([
    import("@aws-sdk/client-dynamodb"),
    import("@aws-sdk/client-ec2"),
    import("@aws-sdk/client-scheduler"),
    import("@aws-sdk/client-ssm"),
  ]);
  const dynamo = new dynamodb.DynamoDBClient({});
  const ec2Client = new ec2.EC2Client({});
  const schedulerClient = new scheduler.SchedulerClient({});
  const ssmClient = new ssm.SSMClient({});
  let secret;

  const required = (name) => {
    const value = process.env[name];
    if (!value) throw new ControlPlaneError(`missing ${name}`);
    return value;
  };

  return {
    now: () => Date.now(),
    getSecret: async () => {
      if (secret) return secret;
      const result = await ssmClient.send(
        new ssm.GetParameterCommand({
          Name: required("WAKE_SECRET_PARAMETER"),
          WithDecryption: true,
        }),
      );
      secret = result.Parameter?.Value;
      if (!secret) throw new ControlPlaneError("wake secret unavailable");
      return secret;
    },
    claimNonce: async ({ nonce, expiresAt }) => {
      try {
        await dynamo.send(
          new dynamodb.PutItemCommand({
            TableName: required("CONTROL_TABLE_NAME"),
            Item: {
              pk: { S: `nonce#${nonce}` },
              expires_at: { N: String(Math.ceil(expiresAt / 1000)) },
            },
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
        return true;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },
    describeInstance: async () => {
      const result = await ec2Client.send(
        new ec2.DescribeInstancesCommand({
          InstanceIds: [required("INSTANCE_ID")],
        }),
      );
      const instance = result.Reservations?.[0]?.Instances?.[0];
      if (!instance) throw new ControlPlaneError("instance unavailable");
      return {
        state: instance.State?.Name,
        tags: Object.fromEntries(
          (instance.Tags ?? []).map((tag) => [tag.Key, tag.Value]),
        ),
      };
    },
    startInstance: async () => {
      await ec2Client.send(
        new ec2.StartInstancesCommand({
          InstanceIds: [required("INSTANCE_ID")],
        }),
      );
    },
    stopInstance: async () => {
      await ec2Client.send(
        new ec2.StopInstancesCommand({
          InstanceIds: [required("INSTANCE_ID")],
        }),
      );
    },
    readLease: async () => {
      const result = await dynamo.send(
        new dynamodb.GetItemCommand({
          TableName: required("CONTROL_TABLE_NAME"),
          Key: { pk: { S: "lease" } },
          ConsistentRead: true,
        }),
      );
      if (!result.Item) return null;
      return {
        leaseId: result.Item.lease_id?.S,
        expiresAt: Number(result.Item.expires_at_ms?.N),
      };
    },
    saveLease: async ({ leaseId, expiresAt }) => {
      await dynamo.send(
        new dynamodb.PutItemCommand({
          TableName: required("CONTROL_TABLE_NAME"),
          Item: {
            pk: { S: "lease" },
            lease_id: { S: leaseId },
            expires_at_ms: { N: String(expiresAt) },
            expires_at: {
              N: String(Math.ceil((expiresAt + 24 * 60 * 60_000) / 1000)),
            },
          },
        }),
      );
    },
    scheduleStop: async ({ leaseId, expiresAt }) => {
      const name = required("STOP_SCHEDULE_NAME");
      const groupName = required("STOP_SCHEDULE_GROUP");
      const params = {
        Name: name,
        GroupName: groupName,
        ActionAfterCompletion: "DELETE",
        FlexibleTimeWindow: { Mode: "OFF" },
        ScheduleExpression: `at(${new Date(expiresAt)
          .toISOString()
          .replace(/\.\d{3}Z$/, "")})`,
        ScheduleExpressionTimezone: "UTC",
        State: "ENABLED",
        Target: {
          Arn: required("FUNCTION_ARN"),
          RoleArn: required("STOP_SCHEDULE_ROLE_ARN"),
          Input: JSON.stringify({ operation: "lease-expired", leaseId }),
          RetryPolicy: {
            MaximumEventAgeInSeconds: 300,
            MaximumRetryAttempts: 3,
          },
        },
      };
      try {
        await schedulerClient.send(new scheduler.UpdateScheduleCommand(params));
      } catch (error) {
        if (error?.name !== "ResourceNotFoundException") throw error;
        await schedulerClient.send(new scheduler.CreateScheduleCommand(params));
      }
    },
  };
}

let productionHandler;

export async function handler(event) {
  if (!productionHandler) {
    productionHandler = createWakeHandler(await createAwsDependencies());
  }
  return productionHandler(event);
}
