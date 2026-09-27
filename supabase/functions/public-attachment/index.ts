const BUCKET = "community-images";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://breadlab.ai",
  "https://www.breadlab.ai",
]);
const PRIVATE_NO_STORE = "private, no-store, max-age=0, must-revalidate";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type AttachmentRecord = {
  id: string;
  ownerId: string;
  objectToken: string;
  storagePath: string;
  mimeType: string;
  byteSize: number;
};

export type PublicAttachmentDependencies = {
  env(name: string): string | undefined;
  resolveAttachment(id: string): Promise<AttachmentRecord | null>;
  fetchStorage(path: string, signal: AbortSignal): Promise<Response>;
  log(entry: Record<string, unknown>): void;
};

function configuredOrigins(
  dependencies: Pick<PublicAttachmentDependencies, "env">,
): Set<string> {
  const origins = new Set(DEFAULT_ALLOWED_ORIGINS);
  for (
    const candidate
      of (dependencies.env("PUBLIC_ATTACHMENT_ALLOWED_ORIGINS") ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
  ) {
    try {
      const parsed = new URL(candidate);
      if (
        (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        parsed.origin === candidate
      ) origins.add(candidate);
    } catch {
      // Invalid values never broaden the allowlist.
    }
  }
  return origins;
}

function isAllowedOrigin(
  origin: string | null,
  dependencies: Pick<PublicAttachmentDependencies, "env">,
): boolean {
  return origin === null || configuredOrigins(dependencies).has(origin);
}

function baseHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "cache-control": PRIVATE_NO_STORE,
    "cross-origin-resource-policy": "cross-origin",
    "expires": "0",
    "pragma": "no-cache",
    "vary": "Origin",
    "x-content-type-options": "nosniff",
  });
  if (origin) headers.set("access-control-allow-origin", origin);
  return headers;
}

function json(
  status: number,
  requestId: string,
  error: string,
  origin: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = baseHeaders(origin);
  headers.set("content-type", "application/json");
  headers.set("x-request-id", requestId);
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify({ error }), { status, headers });
}

function attachmentIdFromRequest(request: Request): string | null {
  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/\/public-attachment\/([^/]+)$/);
  if (!match || !UUID_PATTERN.test(match[1])) return null;
  return match[1];
}

function hasSafeMetadata(
  record: AttachmentRecord,
  requestedId: string,
): boolean {
  return record.id === requestedId &&
    UUID_PATTERN.test(record.id) &&
    UUID_PATTERN.test(record.ownerId) &&
    UUID_PATTERN.test(record.objectToken) &&
    record.storagePath === `${record.ownerId}/${record.objectToken}` &&
    ALLOWED_MIME_TYPES.has(record.mimeType) &&
    Number.isSafeInteger(record.byteSize) &&
    record.byteSize >= 1 &&
    record.byteSize <= MAX_ATTACHMENT_BYTES;
}

function encodedStorageObjectUrl(supabaseUrl: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return new URL(
    `/storage/v1/object/${encodeURIComponent(BUCKET)}/${encodedPath}`,
    supabaseUrl,
  ).toString();
}

function cancelUpstream(response: Response, controller: AbortController): void {
  controller.abort();
  response.body?.cancel().catch(() => undefined);
}

function boundedStorageStream(
  body: ReadableStream<Uint8Array>,
  expectedBytes: number,
  abortController: AbortController,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let receivedBytes = 0;

  function fail(controller: ReadableStreamDefaultController<Uint8Array>): void {
    abortController.abort();
    reader.cancel().catch(() => undefined);
    controller.error(new Error("storage_metadata_mismatch"));
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (receivedBytes !== expectedBytes) return fail(controller);
          controller.close();
          return;
        }
        if (!(value instanceof Uint8Array)) return fail(controller);
        receivedBytes += value.byteLength;
        if (
          receivedBytes > expectedBytes ||
          receivedBytes > MAX_ATTACHMENT_BYTES
        ) return fail(controller);
        controller.enqueue(value);
      } catch {
        fail(controller);
      }
    },
    cancel(reason) {
      abortController.abort();
      return reader.cancel(reason);
    },
  });
}

function normalizeAttachment(row: Record<string, unknown>): AttachmentRecord {
  return {
    id: typeof row.attachment_id === "string" ? row.attachment_id : "",
    ownerId: typeof row.owner_id === "string" ? row.owner_id : "",
    objectToken: typeof row.object_token === "string" ? row.object_token : "",
    storagePath: typeof row.storage_path === "string" ? row.storage_path : "",
    mimeType: typeof row.mime_type === "string" ? row.mime_type : "",
    byteSize: typeof row.byte_size === "number" ? row.byte_size : Number.NaN,
  };
}

async function runtimeDependencies(
  supabaseUrl: string,
  serviceRoleKey: string,
): Promise<PublicAttachmentDependencies> {
  const { createClient } = await import("npm:@supabase/supabase-js@2.117.0");
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    env: (name) => Deno.env.get(name),
    resolveAttachment: async (id) => {
      const { data, error } = await serviceClient.rpc(
        "resolve_public_attachment",
        { p_attachment_id: id },
      ).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return normalizeAttachment(data as Record<string, unknown>);
    },
    fetchStorage: (path, signal) => {
      return fetch(encodedStorageObjectUrl(supabaseUrl, path), {
        method: "GET",
        headers: {
          "apikey": serviceRoleKey,
          "authorization": `Bearer ${serviceRoleKey}`,
        },
        cache: "no-store",
        redirect: "error",
        signal,
      });
    },
    log: (entry) => console.log(JSON.stringify(entry)),
  };
}

export async function handlePublicAttachment(
  request: Request,
  injectedDependencies?: PublicAttachmentDependencies,
): Promise<Response> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("origin");
  const env = injectedDependencies?.env ??
    ((name: string) => Deno.env.get(name));
  const log = injectedDependencies?.log ??
    ((entry: Record<string, unknown>) => console.log(JSON.stringify(entry)));
  let result = "internal_error";

  try {
    if (!isAllowedOrigin(origin, { env })) {
      result = "origin_forbidden";
      return json(403, requestId, result, null);
    }
    if (request.method === "OPTIONS") {
      result = "preflight";
      const headers = baseHeaders(origin);
      headers.set("access-control-allow-methods", "GET");
      headers.set("allow", "GET, OPTIONS");
      headers.set("x-request-id", requestId);
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "GET") {
      result = "method_not_allowed";
      return json(405, requestId, result, origin, { allow: "GET, OPTIONS" });
    }

    const attachmentId = attachmentIdFromRequest(request);
    if (!attachmentId) {
      result = "invalid_attachment_id";
      return json(400, requestId, result, origin);
    }

    const supabaseUrl = env("SUPABASE_URL");
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      result = "server_misconfigured";
      return json(500, requestId, result, origin);
    }

    let dependencies = injectedDependencies;
    if (!dependencies) {
      dependencies = await runtimeDependencies(supabaseUrl, serviceRoleKey);
    }

    let record: AttachmentRecord | null;
    try {
      record = await dependencies.resolveAttachment(attachmentId);
    } catch {
      result = "metadata_lookup_failed";
      return json(502, requestId, "attachment_unavailable", origin);
    }
    if (!record) {
      result = "not_found";
      return json(404, requestId, result, origin);
    }
    if (!hasSafeMetadata(record, attachmentId)) {
      result = "unsafe_attachment_metadata";
      return json(502, requestId, "attachment_unavailable", origin);
    }

    const abortController = new AbortController();
    let storageResponse: Response;
    try {
      storageResponse = await dependencies.fetchStorage(
        record.storagePath,
        abortController.signal,
      );
    } catch {
      result = "storage_download_failed";
      return json(502, requestId, "attachment_unavailable", origin);
    }
    const contentLength = storageResponse.headers.get("content-length");
    const contentType = storageResponse.headers.get("content-type");
    if (
      storageResponse.status !== 200 || storageResponse.body === null ||
      contentLength === null || !/^(0|[1-9][0-9]*)$/.test(contentLength) ||
      Number(contentLength) !== record.byteSize ||
      Number(contentLength) > MAX_ATTACHMENT_BYTES ||
      contentType !== record.mimeType || !ALLOWED_MIME_TYPES.has(contentType)
    ) {
      cancelUpstream(storageResponse, abortController);
      result = "storage_metadata_mismatch";
      return json(502, requestId, "attachment_unavailable", origin);
    }

    result = "served";
    const headers = baseHeaders(origin);
    headers.set("content-type", record.mimeType);
    headers.set("content-length", String(record.byteSize));
    headers.set("x-request-id", requestId);
    return new Response(
      boundedStorageStream(
        storageResponse.body,
        record.byteSize,
        abortController,
      ),
      { status: 200, headers },
    );
  } catch {
    result = "internal_error";
    return json(500, requestId, result, origin);
  } finally {
    log({
      requestId,
      result,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}

if (typeof Deno !== "undefined" && import.meta.main) {
  Deno.serve((request) => handlePublicAttachment(request));
}
