import { decode as decodeJpeg } from "npm:@jsquash/jpeg@1.6.0";
import { decode as decodePng } from "npm:@jsquash/png@3.1.1";
import { decode as decodeWebp } from "npm:@jsquash/webp@1.5.0";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_MULTIPART_BYTES = MAX_UPLOAD_BYTES + 64 * 1024;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 12_000_000;
const BUCKET = "community-images";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SCRIPTABLE_MARKERS = ["<script", "<svg", "<!doctype html", "<html"];
const DEFAULT_ALLOWED_ORIGINS = new Set([
  "https://breadlab.ai",
  "https://www.breadlab.ai",
]);
const CORS_ALLOW_HEADERS =
  "authorization, apikey, content-type, x-client-info, x-idempotency-key";

type AcceptedMime = "image/jpeg" | "image/png" | "image/webp";
type ImageMetadata = {
  mimeType: AcceptedMime;
  byteSize: number;
  width: number;
  height: number;
};
type UploadIntent = {
  id: string;
  storagePath: string;
  objectExists: boolean;
};

export type UploadDependencies = {
  env(name: string): string | undefined;
  authenticate(authorization: string): Promise<{ id: string }>;
  reserveUpload(
    authorization: string,
    idempotencyKey: string,
  ): Promise<string>;
  refundReplay(
    authorization: string,
    reservationId: string,
    idempotencyKey: string,
    contentHash: string,
    metadata: ImageMetadata,
  ): Promise<boolean>;
  createIntent(
    authorization: string,
    idempotencyKey: string,
    contentHash: string,
    metadata: ImageMetadata,
  ): Promise<UploadIntent>;
  upload(
    path: string,
    bytes: Uint8Array,
    mimeType: AcceptedMime,
    contentHash: string,
  ): Promise<unknown>;
  objectMatches(
    path: string,
    mimeType: AcceptedMime,
    byteSize: number,
    contentHash: string,
  ): Promise<boolean>;
  markUploadFailed(
    authorization: string,
    attachmentId: string,
    storagePath: string,
  ): Promise<unknown>;
  log(entry: Record<string, unknown>): void;
};

export class UploadValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "UploadValidationError";
  }
}

export function validateFileSize(byteSize: number): void {
  if (
    !Number.isSafeInteger(byteSize) || byteSize < 1 ||
    byteSize > MAX_UPLOAD_BYTES
  ) {
    throw new UploadValidationError(
      "invalid_size",
      "File size must be between 1 byte and 5 MiB",
    );
  }
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.byteLength >= signature.length &&
    signature.every((value, index) => bytes[index] === value);
}

function detectMime(bytes: Uint8Array): AcceptedMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    bytes.byteLength >= 12 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

function containsScriptableMarker(bytes: Uint8Array): boolean {
  const markerBytes = SCRIPTABLE_MARKERS.map((marker) =>
    Uint8Array.from(marker, (character) => character.charCodeAt(0))
  );
  for (let offset = 0; offset < bytes.byteLength; offset += 1) {
    for (const marker of markerBytes) {
      if (offset + marker.byteLength > bytes.byteLength) continue;
      let matches = true;
      for (let index = 0; index < marker.byteLength; index += 1) {
        const byte = bytes[offset + index];
        const lower = byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
        if (lower !== marker[index]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
  }
  return false;
}

function readJpegDimensions(bytes: Uint8Array): [number, number] {
  const sofMarkers = new Set([
    0xc0,
    0xc1,
    0xc2,
    0xc3,
    0xc5,
    0xc6,
    0xc7,
    0xc9,
    0xca,
    0xcb,
    0xcd,
    0xce,
    0xcf,
  ]);
  let offset = 2;
  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.byteLength) break;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.byteLength) break;
    if (sofMarkers.has(marker) && length >= 7) {
      const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
      return [width, height];
    }
    offset += length;
  }
  throw new UploadValidationError(
    "invalid_image",
    "JPEG dimensions are missing",
  );
}

function readWebpDimensions(bytes: Uint8Array): [number, number] {
  if (bytes.byteLength < 30) {
    throw new UploadValidationError(
      "invalid_image",
      "WebP header is truncated",
    );
  }
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    return [width, height];
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) {
      throw new UploadValidationError(
        "invalid_image",
        "Invalid WebP lossless header",
      );
    }
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) |
      (bytes[24] << 24);
    return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
  }
  if (chunk === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      throw new UploadValidationError(
        "invalid_image",
        "Invalid WebP lossy header",
      );
    }
    return [
      (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    ];
  }
  throw new UploadValidationError("invalid_image", "Unsupported WebP chunk");
}

function dimensionsBeforeDecode(
  bytes: Uint8Array,
  mimeType: AcceptedMime,
): [number, number] {
  if (mimeType === "image/png") {
    if (
      bytes.byteLength < 24 ||
      String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR"
    ) {
      throw new UploadValidationError("invalid_image", "PNG IHDR is missing");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return [view.getUint32(16), view.getUint32(20)];
  }
  if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
  return readWebpDimensions(bytes);
}

function validateDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
    width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION ||
    height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS
  ) {
    throw new UploadValidationError(
      "invalid_dimensions",
      "Image dimensions exceed the safe decoding limit",
    );
  }
}

function jpegLogicalLength(bytes: Uint8Array): number {
  let offset = 2;
  let pendingMarker: number | null = null;
  while (offset < bytes.byteLength) {
    let marker: number;
    if (pendingMarker === null) {
      if (bytes[offset++] !== 0xff) {
        throw new UploadValidationError("invalid_image", "Invalid JPEG marker");
      }
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
      marker = bytes[offset++];
    } else {
      marker = pendingMarker;
      pendingMarker = null;
    }

    if (marker === 0xd9) return offset;
    if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
      throw new UploadValidationError(
        "invalid_image",
        "Invalid JPEG marker order",
      );
    }
    if (offset + 2 > bytes.byteLength) break;
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) break;
    offset += segmentLength;
    if (marker !== 0xda) continue;

    while (offset < bytes.byteLength) {
      if (bytes[offset++] !== 0xff) continue;
      while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
      const entropyMarker = bytes[offset++];
      if (
        entropyMarker === 0x00 ||
        (entropyMarker >= 0xd0 && entropyMarker <= 0xd7)
      ) {
        continue;
      }
      if (entropyMarker === 0xd9) return offset;
      pendingMarker = entropyMarker;
      break;
    }
  }
  throw new UploadValidationError("invalid_image", "JPEG EOI is missing");
}

function rejectTrailingPayload(
  bytes: Uint8Array,
  mimeType: AcceptedMime,
): void {
  let expectedLength: number;
  if (mimeType === "image/png") {
    let offset = 8;
    while (offset + 12 <= bytes.byteLength) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
      const chunkLength = view.getUint32(0);
      const chunkEnd = offset + 12 + chunkLength;
      if (chunkEnd > bytes.byteLength) break;
      if (
        String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)) ===
          "IEND"
      ) {
        expectedLength = chunkEnd;
        if (expectedLength !== bytes.byteLength) {
          throw new UploadValidationError(
            "invalid_image",
            "PNG has trailing payload",
          );
        }
        return;
      }
      offset = chunkEnd;
    }
    throw new UploadValidationError("invalid_image", "PNG IEND is missing");
  }
  if (mimeType === "image/webp") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expectedLength = view.getUint32(4, true) + 8;
    if (expectedLength !== bytes.byteLength) {
      throw new UploadValidationError(
        "invalid_image",
        "WebP length is invalid",
      );
    }
    return;
  }
  expectedLength = jpegLogicalLength(bytes);
  if (expectedLength !== bytes.byteLength) {
    throw new UploadValidationError(
      "invalid_image",
      "JPEG has trailing payload",
    );
  }
}

export async function validateImageUpload(
  bytes: Uint8Array,
  declaredMime: string,
): Promise<ImageMetadata> {
  validateFileSize(bytes.byteLength);
  const mimeType = detectMime(bytes);
  if (!mimeType) {
    throw new UploadValidationError(
      "unsupported_signature",
      "Only JPEG, PNG, and WebP signatures are accepted",
    );
  }
  if (declaredMime !== mimeType) {
    throw new UploadValidationError(
      "mime_mismatch",
      "Declared MIME does not match the file signature",
    );
  }
  if (containsScriptableMarker(bytes)) {
    throw new UploadValidationError(
      "scriptable_content",
      "Scriptable image polyglots are not accepted",
    );
  }

  const [headerWidth, headerHeight] = dimensionsBeforeDecode(bytes, mimeType);
  validateDimensions(headerWidth, headerHeight);
  rejectTrailingPayload(bytes, mimeType);

  try {
    const decodeInput = bytes.slice().buffer;
    const decoded = mimeType === "image/jpeg"
      ? await decodeJpeg(decodeInput)
      : mimeType === "image/png"
      ? await decodePng(decodeInput)
      : await decodeWebp(decodeInput);
    validateDimensions(decoded.width, decoded.height);
    if (
      decoded.width !== headerWidth || decoded.height !== headerHeight ||
      decoded.data.byteLength !== decoded.width * decoded.height * 4
    ) {
      throw new UploadValidationError(
        "invalid_image",
        "Decoded image does not match its header",
      );
    }
    return {
      mimeType,
      byteSize: bytes.byteLength,
      width: decoded.width,
      height: decoded.height,
    };
  } catch (error) {
    if (error instanceof UploadValidationError) throw error;
    throw new UploadValidationError("invalid_image", "Image decoding failed");
  }
}

function allowedOrigins(deps: UploadDependencies): Set<string> {
  const configured = (deps.env("UPLOAD_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  return configured.length > 0 ? new Set(configured) : DEFAULT_ALLOWED_ORIGINS;
}

function isAllowedOrigin(
  origin: string | null,
  deps: UploadDependencies,
): boolean {
  if (origin === null) return true;
  return allowedOrigins(deps).has(origin);
}

function responseHeaders(origin: string | null): Headers {
  const headers = new Headers({ vary: "Origin" });
  if (origin) headers.set("access-control-allow-origin", origin);
  return headers;
}

function json(
  status: number,
  requestId: string,
  body: Record<string, unknown>,
  origin: string | null,
  extraHeaders?: Record<string, string>,
): Response {
  const headers = responseHeaders(origin);
  headers.set("content-type", "application/json");
  headers.set("x-request-id", requestId);
  for (const [name, value] of Object.entries(extraHeaders ?? {})) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function validContentLength(request: Request): boolean {
  const raw = request.headers.get("content-length");
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return false;
  const size = Number(raw);
  return Number.isSafeInteger(size) && size <= MAX_MULTIPART_BYTES;
}

function validUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function errorStatus(error: unknown, fallback = 502): number {
  if (!error || typeof error !== "object") return fallback;
  const record = error as Record<string, unknown>;
  if (record.status === 429 || record.code === "PT429") return 429;
  if (
    record.status === 409 || record.code === "PT409" || record.code === "23505"
  ) return 409;
  if (record.status === 422 || record.code === "PT422") return 422;
  if (record.code === "22023") return 409;
  const message = typeof record.message === "string"
    ? record.message.toLowerCase()
    : "";
  if (message.includes("rate limit")) return 429;
  if (message.includes("count limit")) return 409;
  if (message.includes("byte limit") || message.includes("quota")) return 422;
  if (record.code === "23514") return 409;
  return fallback;
}

function rpcErrorResponse(
  error: unknown,
  requestId: string,
  origin: string | null,
  fallbackCode: string,
): Response {
  const status = errorStatus(error);
  const sqlState = error && typeof error === "object"
    ? (error as Record<string, unknown>).code
    : undefined;
  const code = sqlState === "22023" || sqlState === "23505"
    ? "upload_intent_conflict"
    : status === 429
    ? "rate_limit_exceeded"
    : status === 409
    ? "upload_quota_conflict"
    : status === 422
    ? "upload_quota_exceeded"
    : fallbackCode;
  return json(status, requestId, { error: code }, origin);
}

function runtimeDependencies(): UploadDependencies {
  const getClients = async (authorization: string) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("server_misconfigured");
    }
    const { createClient } = await import("npm:@supabase/supabase-js@2.117.0");
    return {
      user: createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      service: createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    };
  };

  return {
    env: (name) => Deno.env.get(name),
    authenticate: async (authorization) => {
      const { user } = await getClients(authorization);
      const token = authorization.slice(7);
      const { data, error } = await user.auth.getUser(token);
      if (error || !data.user) throw new Error("authentication_required");
      return { id: data.user.id };
    },
    reserveUpload: async (authorization, idempotencyKey) => {
      const { user } = await getClients(authorization);
      const { data, error } = await user.rpc("reserve_attachment_upload", {
        p_idempotency_key: idempotencyKey,
      });
      if (error) throw error;
      if (!validUuid(data)) throw new Error("invalid_upload_reservation");
      return data;
    },
    refundReplay: async (
      authorization,
      reservationId,
      idempotencyKey,
      contentHash,
      metadata,
    ) => {
      const { user } = await getClients(authorization);
      const { data, error } = await user.rpc(
        "refund_attachment_upload_replay",
        {
          p_reservation_id: reservationId,
          p_idempotency_key: idempotencyKey,
          p_content_hash: contentHash,
          p_mime_type: metadata.mimeType,
          p_byte_size: metadata.byteSize,
        },
      );
      if (error) throw error;
      return data === true;
    },
    createIntent: async (
      authorization,
      idempotencyKey,
      contentHash,
      metadata,
    ) => {
      const { user } = await getClients(authorization);
      const { data, error } = await user.rpc(
        "create_attachment_upload_intent",
        {
          p_mime_type: metadata.mimeType,
          p_byte_size: metadata.byteSize,
          p_idempotency_key: idempotencyKey,
          p_content_hash: contentHash,
        },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const id = row?.id;
      const storagePath = row?.storage_path;
      const objectExists = row?.object_exists;
      if (
        !validUuid(id) || typeof storagePath !== "string" ||
        typeof objectExists !== "boolean"
      ) {
        throw new Error("invalid_upload_intent");
      }
      return { id, storagePath, objectExists };
    },
    upload: async (path, bytes, mimeType, contentHash) => {
      const { service } = await getClients("");
      const { error } = await service.storage.from(BUCKET).upload(path, bytes, {
        contentType: mimeType,
        upsert: false,
        metadata: { sha256: contentHash },
      });
      if (error) throw error;
    },
    objectMatches: async (path, mimeType, byteSize, contentHash) => {
      const { service } = await getClients("");
      const { data, error } = await service.storage.from(BUCKET).info(path);
      if (error) throw error;
      if (!data) return false;
      const metadata = data.metadata && typeof data.metadata === "object"
        ? data.metadata as Record<string, unknown>
        : undefined;
      return data.contentType === mimeType &&
        Number(data.size) === byteSize &&
        metadata?.sha256 === contentHash;
    },
    markUploadFailed: async (authorization, attachmentId, storagePath) => {
      const { user } = await getClients(authorization);
      const { data, error } = await user.rpc("fail_attachment_upload", {
        p_attachment_id: attachmentId,
        p_storage_path: storagePath,
      });
      if (error || data !== true) {
        throw error ?? new Error("failure_mark_rejected");
      }
    },
    log: (entry) => console.log(JSON.stringify(entry)),
  };
}

export async function handleUpload(
  request: Request,
  dependencies: UploadDependencies = runtimeDependencies(),
): Promise<Response> {
  const startedAt = performance.now();
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("origin");
  let result = "internal_error";

  try {
    if (!isAllowedOrigin(origin, dependencies)) {
      result = "origin_forbidden";
      return json(403, requestId, { error: result }, null);
    }
    if (request.method === "OPTIONS") {
      if (
        request.headers.get("access-control-request-method")?.toUpperCase() !==
          "POST"
      ) {
        result = "preflight_method_forbidden";
        return json(403, requestId, { error: result }, null);
      }
      result = "preflight_allowed";
      const headers = responseHeaders(origin);
      headers.set("access-control-allow-methods", "POST");
      headers.set("access-control-allow-headers", CORS_ALLOW_HEADERS);
      headers.set("access-control-max-age", "86400");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      result = "method_not_allowed";
      return json(405, requestId, { error: result }, origin, { allow: "POST" });
    }
    if (!validContentLength(request)) {
      result = "invalid_content_length";
      return json(413, requestId, { error: result }, origin);
    }

    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
      result = "authentication_required";
      return json(401, requestId, { error: result }, origin);
    }
    try {
      await dependencies.authenticate(authorization);
    } catch {
      result = "authentication_required";
      return json(401, requestId, { error: result }, origin);
    }

    const idempotencyKey = request.headers.get("x-idempotency-key");
    if (!idempotencyKey || !validUuid(idempotencyKey)) {
      result = "invalid_idempotency_key";
      return json(400, requestId, { error: result }, origin);
    }
    let reservationId: string;
    try {
      reservationId = await dependencies.reserveUpload(
        authorization,
        idempotencyKey,
      );
      if (!validUuid(reservationId)) {
        throw new Error("invalid_upload_reservation");
      }
    } catch (error) {
      const status = errorStatus(error);
      result = status === 429
        ? "rate_limit_exceeded"
        : "upload_reservation_failed";
      return rpcErrorResponse(
        error,
        requestId,
        origin,
        "upload_reservation_failed",
      );
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      result = "form_parse_failed";
      return json(400, requestId, { error: result }, origin);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      result = "file_required";
      return json(400, requestId, { error: result }, origin);
    }
    try {
      validateFileSize(file.size);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        result = error.code;
        return json(400, requestId, { error: result }, origin);
      }
      throw error;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    let validated: ImageMetadata;
    try {
      validated = await validateImageUpload(bytes, file.type);
    } catch (error) {
      if (error instanceof UploadValidationError) {
        result = error.code;
        return json(400, requestId, { error: result }, origin);
      }
      throw error;
    }

    const contentHash = await sha256Hex(bytes);

    let intent: UploadIntent;
    try {
      intent = await dependencies.createIntent(
        authorization,
        idempotencyKey,
        contentHash,
        validated,
      );
      if (
        !validUuid(intent.id) || typeof intent.storagePath !== "string" ||
        typeof intent.objectExists !== "boolean"
      ) {
        throw new Error("invalid_upload_intent");
      }
    } catch (error) {
      const status = errorStatus(error);
      const sqlState = error && typeof error === "object"
        ? (error as Record<string, unknown>).code
        : undefined;
      result = sqlState === "22023" || sqlState === "23505"
        ? "upload_intent_conflict"
        : status === 429
        ? "rate_limit_exceeded"
        : status === 409
        ? "upload_quota_conflict"
        : status === 422
        ? "upload_quota_exceeded"
        : "intent_creation_failed";
      return rpcErrorResponse(
        error,
        requestId,
        origin,
        "intent_creation_failed",
      );
    }

    if (intent.objectExists) {
      try {
        const refunded = await dependencies.refundReplay(
          authorization,
          reservationId,
          idempotencyKey,
          contentHash,
          validated,
        );
        result = refunded ? "replayed" : "replayed_rate_charged";
      } catch {
        result = "replayed_rate_charged";
      }
      return json(200, requestId, {
        attachmentId: intent.id,
        storagePath: intent.storagePath,
        mimeType: validated.mimeType,
        byteSize: validated.byteSize,
        width: validated.width,
        height: validated.height,
      }, origin);
    }

    try {
      await dependencies.upload(
        intent.storagePath,
        bytes,
        validated.mimeType,
        contentHash,
      );
    } catch {
      let matches = false;
      try {
        matches = await dependencies.objectMatches(
          intent.storagePath,
          validated.mimeType,
          validated.byteSize,
          contentHash,
        );
      } catch {
        matches = false;
      }
      if (matches) {
        try {
          const refunded = await dependencies.refundReplay(
            authorization,
            reservationId,
            idempotencyKey,
            contentHash,
            validated,
          );
          result = refunded
            ? "created_concurrently"
            : "created_concurrently_rate_charged";
        } catch {
          result = "created_concurrently_rate_charged";
        }
        return json(201, requestId, {
          attachmentId: intent.id,
          storagePath: intent.storagePath,
          mimeType: validated.mimeType,
          byteSize: validated.byteSize,
          width: validated.width,
          height: validated.height,
        }, origin);
      }

      result = "object_upload_failed";
      try {
        await dependencies.markUploadFailed(
          authorization,
          intent.id,
          intent.storagePath,
        );
      } catch {
        result = "object_upload_failed_mark_failed";
      }
      return json(502, requestId, { error: result }, origin);
    }

    result = "created";
    return json(201, requestId, {
      attachmentId: intent.id,
      storagePath: intent.storagePath,
      mimeType: validated.mimeType,
      byteSize: validated.byteSize,
      width: validated.width,
      height: validated.height,
    }, origin);
  } catch {
    return json(500, requestId, { error: result }, origin);
  } finally {
    dependencies.log({
      requestId,
      result,
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}

if (typeof Deno !== "undefined" && import.meta.main) {
  Deno.serve((request) => handleUpload(request));
}
