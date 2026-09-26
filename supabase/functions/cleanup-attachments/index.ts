const BUCKET = "community-images";
const CLAIM_LIMIT = 20;
const MAX_CONCURRENCY = 5;
const OPERATION_TIMEOUT_MS = 15_000;

export type CleanupCandidate = {
  id: string;
  storage_path: string;
  claim_token: string;
};

export type CleanupDependencies = {
  env: (name: string) => string | undefined;
  claim: (limit: number, signal: AbortSignal) => Promise<CleanupCandidate[]>;
  prepare: (
    candidate: CleanupCandidate,
    signal: AbortSignal,
  ) => Promise<boolean>;
  remove: (path: string, signal: AbortSignal) => Promise<unknown>;
  complete: (
    candidate: CleanupCandidate,
    signal: AbortSignal,
  ) => Promise<boolean>;
  release: (
    candidate: CleanupCandidate,
    reason: string,
    signal: AbortSignal,
  ) => Promise<boolean>;
  log: (entry: Record<string, unknown>) => void;
  operationTimeoutMs?: number;
};

class OperationTimeoutError extends Error {
  constructor() {
    super("cleanup operation timed out");
    this.name = "OperationTimeoutError";
  }
}

async function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new OperationTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    clearTimeout(timeout);
  }
}

function json(
  status: number,
  requestId: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      ...headers,
    },
  });
}

function defaultLog(entry: Record<string, unknown>): void {
  console.log(JSON.stringify(entry));
}

function logResult(
  log: CleanupDependencies["log"],
  requestId: string,
  result: string,
  startedAt: number,
): void {
  log({
    requestId,
    result,
    durationMs: Math.round(performance.now() - startedAt),
  });
}

export async function secureEqual(
  left: string,
  right: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = leftBytes.byteLength ^ rightBytes.byteLength;
  for (
    let index = 0;
    index < Math.max(leftBytes.byteLength, rightBytes.byteLength);
    index += 1
  ) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { status?: number; statusCode?: number | string };
  return Number(candidate.status ?? candidate.statusCode) === 404;
}

async function runtimeDependencies(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<CleanupDependencies> {
  const { createClient } = await import("npm:@supabase/supabase-js@2.117.0");
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return {
    env: (name) => Deno.env.get(name),
    claim: async (limit, signal) => {
      const { data, error } = await serviceClient.rpc(
        "claim_attachment_cleanup",
        { p_limit: limit },
      ).abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as CleanupCandidate[];
    },
    prepare: async (candidate, signal) => {
      const { data, error } = await serviceClient.rpc(
        "prepare_attachment_cleanup",
        {
          p_attachment_id: candidate.id,
          p_storage_path: candidate.storage_path,
          p_claim_token: candidate.claim_token,
        },
      ).abortSignal(signal);
      if (error) throw error;
      return data === true;
    },
    remove: async (path, _signal) => {
      const { error } = await serviceClient.storage.from(BUCKET).remove([path]);
      if (error) throw error;
    },
    complete: async (candidate, signal) => {
      const { data, error } = await serviceClient.rpc(
        "complete_attachment_cleanup",
        {
          p_attachment_id: candidate.id,
          p_storage_path: candidate.storage_path,
          p_claim_token: candidate.claim_token,
        },
      ).abortSignal(signal);
      if (error) throw error;
      return data === true;
    },
    release: async (candidate, reason, signal) => {
      const { data, error } = await serviceClient.rpc(
        "release_attachment_cleanup",
        {
          p_attachment_id: candidate.id,
          p_storage_path: candidate.storage_path,
          p_claim_token: candidate.claim_token,
          p_reason: reason,
        },
      ).abortSignal(signal);
      if (error) throw error;
      return data === true;
    },
    log: defaultLog,
  };
}

async function releaseQuietly(
  dependencies: CleanupDependencies,
  candidate: CleanupCandidate,
  reason:
    | "eligibility_changed"
    | "prepare_failed"
    | "prepare_timeout"
    | "storage_remove_failed"
    | "storage_remove_timeout"
    | "completion_failed"
    | "completion_timeout",
): Promise<boolean> {
  try {
    return await withTimeout(
      dependencies.operationTimeoutMs ?? OPERATION_TIMEOUT_MS,
      (signal) => dependencies.release(candidate, reason, signal),
    );
  } catch {
    // The fixed reason is the only failure detail persisted or exposed.
    return false;
  }
}

type CleanupOutcome = "deleted" | "skipped" | "failed";

async function processCandidate(
  dependencies: CleanupDependencies,
  candidate: CleanupCandidate,
): Promise<CleanupOutcome> {
  try {
    const prepared = await withTimeout(
      dependencies.operationTimeoutMs ?? OPERATION_TIMEOUT_MS,
      (signal) => dependencies.prepare(candidate, signal),
    );
    if (!prepared) {
      return await releaseQuietly(
          dependencies,
          candidate,
          "eligibility_changed",
        )
        ? "skipped"
        : "failed";
    }
  } catch (error) {
    await releaseQuietly(
      dependencies,
      candidate,
      error instanceof OperationTimeoutError
        ? "prepare_timeout"
        : "prepare_failed",
    );
    return "failed";
  }

  try {
    await withTimeout(
      dependencies.operationTimeoutMs ?? OPERATION_TIMEOUT_MS,
      (signal) => dependencies.remove(candidate.storage_path, signal),
    );
  } catch (error) {
    if (!isStorageNotFound(error)) {
      await releaseQuietly(
        dependencies,
        candidate,
        error instanceof OperationTimeoutError
          ? "storage_remove_timeout"
          : "storage_remove_failed",
      );
      return "failed";
    }
  }

  try {
    if (
      await withTimeout(
        dependencies.operationTimeoutMs ?? OPERATION_TIMEOUT_MS,
        (signal) => dependencies.complete(candidate, signal),
      )
    ) return "deleted";
  } catch (error) {
    await releaseQuietly(
      dependencies,
      candidate,
      error instanceof OperationTimeoutError
        ? "completion_timeout"
        : "completion_failed",
    );
    return "failed";
  }

  await releaseQuietly(dependencies, candidate, "completion_failed");
  return "failed";
}

async function processBounded(
  dependencies: CleanupDependencies,
  candidates: CleanupCandidate[],
): Promise<CleanupOutcome[]> {
  const results: CleanupOutcome[] = [];
  for (let index = 0; index < candidates.length; index += MAX_CONCURRENCY) {
    const batch = candidates.slice(index, index + MAX_CONCURRENCY);
    results.push(
      ...await Promise.all(
        batch.map((candidate) => processCandidate(dependencies, candidate)),
      ),
    );
  }
  return results;
}

export async function handleCleanup(
  request: Request,
  injectedDependencies?: CleanupDependencies,
): Promise<Response> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  const env = injectedDependencies?.env ??
    ((name: string) => Deno.env.get(name));
  const log = injectedDependencies?.log ?? defaultLog;
  let result = "internal_error";

  try {
    if (request.method !== "POST") {
      result = "method_not_allowed";
      return json(405, requestId, { error: result }, { allow: "POST" });
    }

    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) {
      result = "server_misconfigured";
      return json(500, requestId, { error: result });
    }

    const authorization = request.headers.get("authorization") ?? "";
    if (
      !authorization.startsWith("Bearer ") ||
      !(await secureEqual(authorization.slice(7), serviceRoleKey))
    ) {
      result = "service_authorization_required";
      return json(403, requestId, { error: result });
    }

    let dependencies = injectedDependencies;
    if (!dependencies) {
      const supabaseUrl = env("SUPABASE_URL");
      if (!supabaseUrl) {
        result = "server_misconfigured";
        return json(500, requestId, { error: result });
      }
      dependencies = await runtimeDependencies(supabaseUrl, serviceRoleKey);
    }

    let candidates: CleanupCandidate[];
    try {
      candidates = (await withTimeout(
        dependencies.operationTimeoutMs ?? OPERATION_TIMEOUT_MS,
        (signal) => dependencies.claim(CLAIM_LIMIT, signal),
      )).slice(
        0,
        CLAIM_LIMIT,
      );
    } catch {
      result = "claim_failed";
      return json(502, requestId, { error: result });
    }

    const outcomes = await processBounded(dependencies, candidates);
    const deleted = outcomes.filter((outcome) => outcome === "deleted").length;
    const skipped = outcomes.filter((outcome) => outcome === "skipped").length;
    const failed = outcomes.filter((outcome) => outcome === "failed").length;

    result = failed === 0 ? "completed" : "partial_failure";
    return json(failed === 0 ? 200 : 207, requestId, {
      claimed: candidates.length,
      deleted,
      skipped,
      failed,
    });
  } catch {
    result = "internal_error";
    return json(500, requestId, { error: result });
  } finally {
    logResult(log, requestId, result, startedAt);
  }
}

if (typeof Deno !== "undefined" && import.meta.main) {
  Deno.serve((request) => handleCleanup(request));
}
