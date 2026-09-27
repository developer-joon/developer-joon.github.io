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
const SUCCESS_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type AttachmentRecord = {
  id: string;
  postId: string | null;
  storagePath: string;
  mimeType: string;
  byteSize: number;
  status: string;
  deletedAt: string | null;
  post: {
    status: string;
    deletedAt: string | null;
  } | null;
};

export type PublicAttachmentDependencies = {
  env(name: string): string | undefined;
  findAttachment(id: string): Promise<AttachmentRecord | null>;
  download(path: string): Promise<Blob>;
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

function baseHeaders(
  origin: string | null,
  cacheControl = "no-store",
): Headers {
  const headers = new Headers({
    "cache-control": cacheControl,
    "cross-origin-resource-policy": "same-origin",
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

function isEligible(record: AttachmentRecord, requestedId: string): boolean {
  return record.id === requestedId &&
    record.postId !== null &&
    record.status === "attached" &&
    record.deletedAt === null &&
    typeof record.storagePath === "string" &&
    record.storagePath.length > 0 &&
    record.post?.status === "published" &&
    record.post.deletedAt === null;
}

function hasSafeMetadata(record: AttachmentRecord): boolean {
  return ALLOWED_MIME_TYPES.has(record.mimeType) &&
    Number.isSafeInteger(record.byteSize) &&
    record.byteSize >= 1 &&
    record.byteSize <= MAX_ATTACHMENT_BYTES;
}

function normalizeAttachment(row: Record<string, unknown>): AttachmentRecord {
  const rawPost = Array.isArray(row.posts) ? row.posts[0] : row.posts;
  const post = rawPost && typeof rawPost === "object"
    ? rawPost as Record<string, unknown>
    : null;
  return {
    id: typeof row.id === "string" ? row.id : "",
    postId: typeof row.post_id === "string" ? row.post_id : null,
    storagePath: typeof row.storage_path === "string" ? row.storage_path : "",
    mimeType: typeof row.mime_type === "string" ? row.mime_type : "",
    byteSize: typeof row.byte_size === "number" ? row.byte_size : Number.NaN,
    status: typeof row.status === "string" ? row.status : "",
    deletedAt: typeof row.deleted_at === "string" ? row.deleted_at : null,
    post: post
      ? {
        status: typeof post.status === "string" ? post.status : "",
        deletedAt: typeof post.deleted_at === "string" ? post.deleted_at : null,
      }
      : null,
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
    findAttachment: async (id) => {
      const { data, error } = await serviceClient
        .from("attachments")
        .select(
          "id,post_id,storage_path,mime_type,byte_size,status,deleted_at,posts!inner(status,deleted_at)",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return normalizeAttachment(data as Record<string, unknown>);
    },
    download: async (path) => {
      const { data, error } = await serviceClient.storage.from(BUCKET).download(
        path,
      );
      if (error || !data) throw error ?? new Error("storage_download_failed");
      return data;
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
    if (request.method !== "GET") {
      result = "method_not_allowed";
      return json(405, requestId, result, origin, { allow: "GET" });
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
      record = await dependencies.findAttachment(attachmentId);
    } catch {
      result = "metadata_lookup_failed";
      return json(502, requestId, "attachment_unavailable", origin);
    }
    if (!record || !isEligible(record, attachmentId)) {
      result = "not_found";
      return json(404, requestId, result, origin);
    }
    if (!hasSafeMetadata(record)) {
      result = "unsafe_attachment_metadata";
      return json(502, requestId, "attachment_unavailable", origin);
    }

    let blob: Blob;
    try {
      blob = await dependencies.download(record.storagePath);
    } catch {
      result = "storage_download_failed";
      return json(502, requestId, "attachment_unavailable", origin);
    }
    if (
      blob.size !== record.byteSize || blob.size > MAX_ATTACHMENT_BYTES ||
      blob.type !== record.mimeType || !ALLOWED_MIME_TYPES.has(blob.type)
    ) {
      result = "storage_metadata_mismatch";
      return json(502, requestId, "attachment_unavailable", origin);
    }

    result = "served";
    const headers = baseHeaders(origin, SUCCESS_CACHE_CONTROL);
    headers.set("content-type", record.mimeType);
    headers.set("content-length", String(record.byteSize));
    headers.set("x-request-id", requestId);
    return new Response(blob.stream(), { status: 200, headers });
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
