import assert from "node:assert/strict";
import {
  type CleanupCandidate,
  type CleanupDependencies,
  handleCleanup,
} from "./index.ts";

const CANDIDATES: CleanupCandidate[] = [
  {
    id: "a1000000-0000-4000-8000-000000000001",
    storage_path:
      "u1000000-0000-4000-8000-000000000001/o1000000-0000-4000-8000-000000000001",
    claim_token: "c1000000-0000-4000-8000-000000000001",
  },
  {
    id: "a1000000-0000-4000-8000-000000000002",
    storage_path:
      "u1000000-0000-4000-8000-000000000001/o1000000-0000-4000-8000-000000000002",
    claim_token: "c1000000-0000-4000-8000-000000000002",
  },
];

function dependencies(events: string[] = []): CleanupDependencies {
  return {
    env: (name) =>
      name === "SUPABASE_SERVICE_ROLE_KEY" ? "service-secret" : undefined,
    claim: async () => CANDIDATES,
    prepare: async (candidate) => {
      events.push(`prepare:${candidate.claim_token}`);
      return true;
    },
    remove: async (path) => events.push(`remove:${path}`),
    complete: async (candidate) => {
      events.push(`complete:${candidate.claim_token}`);
      return true;
    },
    release: async (candidate, reason) => {
      events.push(`release:${candidate.claim_token}:${reason}`);
      return true;
    },
    log: () => undefined,
  };
}

function request(
  method = "POST",
  token = "service-secret",
  origin?: string,
): Request {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (origin) headers.set("origin", origin);
  return new Request("http://edge.test", { method, headers });
}

Deno.test("cleanup is service-only, has no browser CORS, and 405 advertises POST", async () => {
  const method = await handleCleanup(
    request("OPTIONS", "service-secret", "https://breadlab.ai"),
    dependencies(),
  );
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");
  assert.equal(method.headers.get("access-control-allow-origin"), null);

  const denied = await handleCleanup(request("POST", "wrong"), dependencies());
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

Deno.test("cleanup completes object deletion with the matching lease token", async () => {
  const events: string[] = [];
  const response = await handleCleanup(request(), dependencies(events));
  assert.equal(response.status, 200);
  assert.deepEqual(events.map((event) => event.split(":")[0]), [
    "prepare",
    "prepare",
    "remove",
    "remove",
    "complete",
    "complete",
  ]);
  assert.deepEqual(await response.json(), {
    claimed: 2,
    deleted: 2,
    skipped: 0,
    failed: 0,
  });
});

Deno.test("claim timeout aborts the RPC and returns bounded 502 without processing", async () => {
  const events: string[] = [];
  const deps = dependencies(events) as CleanupDependencies & {
    operationTimeoutMs: number;
  };
  deps.operationTimeoutMs = 5;
  deps.claim = async (_limit, signal) => {
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => {
        events.push("claim:aborted");
        resolve();
      }, { once: true });
    });
    return CANDIDATES;
  };

  const response = await handleCleanup(request(), deps);

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "claim_failed" });
  assert.deepEqual(events, ["claim:aborted"]);
});

Deno.test("eligibility change before prepare releases without removing storage", async () => {
  const events: string[] = [];
  const deps = dependencies(events);
  deps.claim = async () => [CANDIDATES[0]];
  deps.prepare = async (candidate) => {
    events.push(`prepare:${candidate.claim_token}`);
    return false;
  };

  const response = await handleCleanup(request(), deps);

  assert.equal(response.status, 200);
  assert.deepEqual(events.map((event) => event.split(":")[0]), [
    "prepare",
    "release",
  ]);
  assert.equal(events[1].endsWith(":eligibility_changed"), true);
  assert.deepEqual(await response.json(), {
    claimed: 1,
    deleted: 0,
    skipped: 1,
    failed: 0,
  });
});

Deno.test("cleanup releases each failed claim for retry with a bounded reason", async () => {
  const events: string[] = [];
  const deps = dependencies(events);
  deps.remove = async (path) => {
    events.push(`remove:${path}`);
    if (path.endsWith("2")) {
      throw new Error("storage unavailable and secret=must-not-leak");
    }
  };
  const response = await handleCleanup(request(), deps);
  assert.equal(response.status, 207);
  const body = await response.json();
  assert.deepEqual(body, {
    claimed: 2,
    deleted: 1,
    skipped: 0,
    failed: 1,
  });
  assert.equal(
    events.some((event) =>
      event.startsWith(
        "release:c1000000-0000-4000-8000-000000000002:storage_remove_failed",
      )
    ),
    true,
  );
  assert.equal(JSON.stringify(body).includes("must-not-leak"), false);
});

Deno.test("completion failure is released so a later 404 can finish it", async () => {
  const events: string[] = [];
  const deps = dependencies(events);
  deps.claim = async () => [CANDIDATES[0]];
  deps.complete = async (candidate) => {
    events.push(`complete:${candidate.claim_token}`);
    return false;
  };
  const response = await handleCleanup(request(), deps);
  assert.equal(response.status, 207);
  assert.equal(
    events.some((event) =>
      event.startsWith("release:") && event.endsWith(":completion_failed")
    ),
    true,
  );
});

Deno.test("storage 404 still completes the exact claimed candidate", async () => {
  const candidate = CANDIDATES[0];
  const deps = dependencies();
  let completed: CleanupCandidate | undefined;
  deps.claim = async (limit) => {
    assert.equal(limit, 20);
    return [candidate];
  };
  deps.remove = async () => {
    throw { statusCode: "404" };
  };
  deps.complete = async (value) => {
    completed = value;
    return true;
  };

  const response = await handleCleanup(request(), deps);
  assert.equal(response.status, 200);
  assert.deepEqual(completed, candidate);
  assert.deepEqual(await response.json(), {
    claimed: 1,
    deleted: 1,
    skipped: 0,
    failed: 0,
  });
});

Deno.test("cleanup bounds claimed work and never logs sensitive failure details", async () => {
  const logs: Record<string, unknown>[] = [];
  const deps = dependencies();
  deps.claim = async () =>
    Array.from({ length: 21 }, (_, index) => ({
      id: crypto.randomUUID(),
      storage_path: `private/path/${index}`,
      claim_token: `secret-token-${index}`,
    }));
  deps.remove = async () => {
    throw new Error("raw storage error secret=must-not-leak");
  };
  deps.log = (entry) => logs.push(entry);

  const response = await handleCleanup(request(), deps);
  assert.equal(response.status, 207);
  assert.deepEqual(await response.json(), {
    claimed: 20,
    deleted: 0,
    skipped: 0,
    failed: 20,
  });
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes("private/path"), false);
  assert.equal(serializedLogs.includes("secret-token"), false);
  assert.equal(serializedLogs.includes("must-not-leak"), false);
  assert.equal(serializedLogs.includes("service-secret"), false);
});

Deno.test("completion timeout releases the token and late completion cannot change the result", async () => {
  const events: string[] = [];
  const deps = dependencies(events) as CleanupDependencies & {
    operationTimeoutMs: number;
  };
  deps.operationTimeoutMs = 5;
  deps.claim = async () => [CANDIDATES[0]];
  deps.complete = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    events.push("complete:late");
    return true;
  };
  deps.release = async (candidate, reason) => {
    events.push(`release:${candidate.claim_token}:${reason}`);
    return await new Promise<boolean>(() => undefined);
  };

  const startedAt = performance.now();
  const response = await handleCleanup(request(), deps);
  const durationMs = performance.now() - startedAt;

  assert.equal(response.status, 207);
  assert.equal(durationMs < 100, true);
  assert.equal(
    events.some((event) => event.endsWith(":completion_timeout")),
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(events.at(-1), "complete:late");
  assert.deepEqual(await response.json(), {
    claimed: 1,
    deleted: 0,
    skipped: 0,
    failed: 1,
  });
});

Deno.test("remove timeout releases a prepared deletion while late remove may finish", async () => {
  const events: string[] = [];
  const deps = dependencies(events) as CleanupDependencies & {
    operationTimeoutMs: number;
  };
  deps.operationTimeoutMs = 5;
  deps.claim = async () => [CANDIDATES[0]];
  deps.remove = async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    events.push("remove:late");
  };

  const response = await handleCleanup(request(), deps);

  assert.equal(response.status, 207);
  assert.equal(
    events.some((event) => event.endsWith(":storage_remove_timeout")),
    true,
  );
  assert.equal(events.some((event) => event.startsWith("complete:")), false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(events.at(-1), "remove:late");
});

Deno.test("cleanup processes claims with bounded concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const deps = dependencies();
  deps.claim = async () =>
    Array.from({ length: 20 }, (_, index) => ({
      id: crypto.randomUUID(),
      storage_path: `user/${index}`,
      claim_token: crypto.randomUUID(),
    }));
  deps.remove = async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
  };
  const response = await handleCleanup(request(), deps);
  assert.equal(response.status, 200);
  assert.equal(maximum <= 5, true);
  assert.equal(maximum > 1, true);
});
