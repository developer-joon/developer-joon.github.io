const MAX_REQUEST_BYTES = 16_384;
const MAX_NTS_RESPONSE_BYTES = 65_536;
const OPERATION_DEADLINE_MS = 8_000;
const PERSISTENCE_MARGIN_MS = 2_000;
const MAX_HMAC_SECRET_BYTES = 8_192;
const MAX_BEARER_BYTES = 4_096;
const EXPECTED_PENDING = "pending";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_64_PATTERN = /^[0-9a-f]{64}$/;
const CORS_HEADERS = "authorization, content-type, idempotency-key";
const OWNER_KEYS = [
  "created_at",
  "proposed_name",
  "region",
  "request_id",
  "resolved_company_id",
  "revision",
  "status",
  "updated_at",
  "verification_status",
  "website",
  "industry",
].sort();
const ENV_NAMES = [
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NTS_SERVICE_KEY",
  "BUSINESS_NUMBER_HMAC_SECRET",
  "BENEFIT_COMPANY_ALLOWED_ORIGINS",
] as const;

type SafeCompanyFields = {
  proposedName: string;
  region: string | null;
  industry: string | null;
  website: string | null;
};
type Input = SafeCompanyFields & {
  businessNumber: string;
  openingDate: string;
  representativeName: string;
};
type AuthenticatedIdentity = { id: string; currentGoogleIdentity: boolean };
type Reservation = {
  request_id: string;
  proposed_name: string;
  region: string | null;
  industry: string | null;
  website: string | null;
  verification_status:
    | "pending"
    | "matched"
    | "mismatched"
    | "unavailable"
    | "rejected";
  status: "pending_review" | "approved" | "merged" | "rejected";
  revision: number;
  resolved_company_id: string | null;
  created_at: string;
  updated_at: string;
  verification_method?: "nts_full";
};
type FinalizeArguments = {
  requestId: string;
  expectedVerificationStatus: "pending";
  payloadFingerprint: string;
  businessNumberDigest: string;
  externalVerifiedAt: string;
};
type FailureArguments = {
  requestId: string;
  expectedVerificationStatus: "pending";
  payloadFingerprint: string;
  category: "mismatched" | "unavailable" | "rejected";
};

export type VerificationDependencies = {
  env(name: string): string | undefined;
  authenticate(
    authorization: string,
    signal: AbortSignal,
  ): Promise<AuthenticatedIdentity>;
  reserve(
    authorization: string,
    idempotencyKey: string,
    fields: SafeCompanyFields,
    signal: AbortSignal,
  ): Promise<unknown>;
  finalize(args: FinalizeArguments, signal: AbortSignal): Promise<unknown>;
  fail(args: FailureArguments, signal: AbortSignal): Promise<unknown>;
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  now(): Date;
  monotonicNow(): number;
  requestId(): string;
  log(entry: Record<string, unknown>): void;
  setTimeout(
    callback: () => void,
    delay: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
};

type Config = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  ntsServiceKey: string;
  hmacSecret: string;
  origins: Set<string>;
};

class PublicError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly messageKo: string,
    readonly category: string,
  ) {
    super(code);
  }
}

class NtsError extends Error {}
class RpcIndeterminateError extends Error {}
class RpcDefiniteError extends Error {
  constructor(readonly publicError: PublicError) {
    super(publicError.code);
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length &&
    actual.every((key, index) => key === sorted[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseOriginList(raw: string): Set<string> | null {
  if (raw.length < 1 || utf8Length(raw) > 2_048) return null;
  const values = raw.split(",");
  if (
    values.length < 1 || values.length > 10 ||
    values.some((value) => value.length === 0 || value !== value.trim())
  ) return null;
  const result = new Set<string>();
  for (const value of values) {
    if (value === "*" || /[\u0000-\u0020\u007f]/u.test(value)) return null;
    try {
      const url = new URL(value);
      if (
        url.protocol !== "https:" || url.username !== "" ||
        url.password !== "" ||
        url.pathname !== "/" || url.search !== "" || url.hash !== "" ||
        url.origin !== value || url.hostname.length === 0
      ) return null;
      result.add(value);
    } catch {
      return null;
    }
  }
  return result.size === values.length ? result : null;
}

function normalizeSupabaseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash || !url.hostname
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function loadConfig(deps: VerificationDependencies): Config | null {
  const values = Object.fromEntries(
    ENV_NAMES.map((name) => [name, deps.env(name)]),
  ) as Record<typeof ENV_NAMES[number], string | undefined>;
  if (
    ENV_NAMES.some((name) => !values[name] || utf8Length(values[name]!) > 8_192)
  ) return null;
  const supabaseOrigin = normalizeSupabaseOrigin(values.SUPABASE_URL);
  const origins = parseOriginList(values.BENEFIT_COMPANY_ALLOWED_ORIGINS!);
  if (
    !origins || !supabaseOrigin ||
    utf8Length(values.BUSINESS_NUMBER_HMAC_SECRET!) < 32 ||
    utf8Length(values.BUSINESS_NUMBER_HMAC_SECRET!) > MAX_HMAC_SECRET_BYTES
  ) return null;
  return {
    supabaseUrl: supabaseOrigin,
    anonKey: values.SUPABASE_ANON_KEY!,
    serviceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY!,
    ntsServiceKey: values.NTS_SERVICE_KEY!,
    hmacSecret: values.BUSINESS_NUMBER_HMAC_SECRET!,
    origins,
  };
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    vary: "Origin",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  if (origin) headers.set("access-control-allow-origin", origin);
  return headers;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  origin: string | null,
  extra: Record<string, string> = {},
): Response {
  const headers = corsHeaders(origin);
  headers.set("content-type", "application/json; charset=utf-8");
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  return new Response(JSON.stringify(body), { status, headers });
}

function safeError(error: PublicError, origin: string | null): Response {
  return jsonResponse(error.status, {
    code: error.code,
    message: error.messageKo,
  }, origin);
}

function validBearer(value: string | null): value is string {
  if (!value || utf8Length(value) > MAX_BEARER_BYTES) return false;
  return /^Bearer [!-~]+$/.test(value) && !value.slice(7).includes(" ") &&
    value.length > 7;
}

function validUuid(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value) &&
    value !== "00000000-0000-0000-0000-000000000000";
}

class BodyTooLargeError extends Error {}
class DeadlineExceededError extends Error {}
class StreamAbortedError extends Error {
  constructor(readonly signal: AbortSignal) {
    super("stream aborted");
  }
}

function contentLengthHint(request: Request): number | null {
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  if (!/^(0|[1-9][0-9]*)$/.test(raw)) throw new BodyTooLargeError();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > MAX_REQUEST_BYTES) {
    throw new BodyTooLargeError();
  }
  return value;
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signals: readonly AbortSignal[],
  onRead?: (value: ReadableStreamReadResult<Uint8Array>) => void,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  const alreadyAborted = signals.find((signal) => signal.aborted);
  if (alreadyAborted) throw new StreamAbortedError(alreadyAborted);

  const read = reader.read().then(
    (value) => {
      onRead?.(value);
      return { kind: "read" as const, value };
    },
    (error) => ({ kind: "error" as const, error }),
  );
  let listeners: Array<[AbortSignal, () => void]> = [];
  const aborted = new Promise<{ kind: "abort"; signal: AbortSignal }>(
    (resolve) => {
      listeners = signals.map((signal) => {
        const listener = () => resolve({ kind: "abort", signal });
        signal.addEventListener("abort", listener, { once: true });
        return [signal, listener];
      });
    },
  );
  const result = await Promise.race([read, aborted]);
  for (const [signal, listener] of listeners) {
    signal.removeEventListener("abort", listener);
  }
  if (result.kind === "abort") {
    // The underlying stream is allowed to ignore cancellation. Its eventual
    // settlement is converted to a handled value and cannot reject unobserved.
    void read.then(() => undefined);
    throw new StreamAbortedError(result.signal);
  }
  if (result.kind === "error") throw result.error;
  return result.value;
}

async function readRequestText(
  request: Request,
  deadlineSignal: AbortSignal,
  clientSignal: AbortSignal,
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    void reader.cancel().catch(() => {});
  };
  try {
    while (true) {
      const { done, value } = await readChunk(
        reader,
        [deadlineSignal, clientSignal],
        (item) => {
          if (!item.done && total + item.value.byteLength > MAX_REQUEST_BYTES) {
            cancel();
          }
        },
      );
      if (done) break;
      if (total + value.byteLength > MAX_REQUEST_BYTES) {
        cancel();
        throw new BodyTooLargeError();
      }
      total += value.byteLength;
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      cancel();
      throw error;
    } finally {
      bytes.fill(0);
    }
  } catch (error) {
    cancel();
    if (
      error instanceof StreamAbortedError &&
      error.signal === deadlineSignal
    ) throw new DeadlineExceededError();
    throw error;
  } finally {
    chunks.length = 0;
    try {
      reader.releaseLock();
    } catch {
      // A non-cooperative pending read keeps its lock until it settles.
    }
  }
}

class OperationDeadline {
  readonly overallDeadline: number;
  readonly externalCutoff: number;
  #closed = false;
  #controllers = new Set<AbortController>();

  constructor(
    private readonly deps: VerificationDependencies,
    milliseconds: number,
    persistenceMargin: number,
  ) {
    const started = deps.monotonicNow();
    this.overallDeadline = started + milliseconds;
    this.externalCutoff = this.overallDeadline - persistenceMargin;
  }

  checkExternal(): void {
    this.#check(this.externalCutoff);
  }

  async runExternal<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return await this.#runUntil(this.externalCutoff, operation);
  }

  async runPersistence<T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    return await this.#runUntil(this.overallDeadline, operation);
  }

  async #runUntil<T>(
    cutoff: number,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    this.#check(cutoff);
    const controller = new AbortController();
    this.#controllers.add(controller);
    const remaining = cutoff - this.deps.monotonicNow();
    const timeoutMarker = Symbol("deadline");
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<typeof timeoutMarker>((resolve) => {
      timer = this.deps.setTimeout(() => {
        resolve(timeoutMarker);
        controller.abort();
      }, remaining);
    });
    // Convert both branches to values so a transport settling after the race
    // cannot become an unhandled rejection or mutate this request's state.
    let operationPromise: Promise<T>;
    try {
      operationPromise = operation(controller.signal);
    } catch (error) {
      operationPromise = Promise.reject(error);
    }
    const settled = operationPromise.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
    try {
      const result = await Promise.race([settled, timeout]);
      if (result === timeoutMarker) {
        void settled.then(() => undefined);
        throw new DeadlineExceededError();
      }
      this.#check(cutoff);
      if (!result.ok) throw result.error;
      return result.value;
    } finally {
      if (timer !== null) this.deps.clearTimeout(timer);
      this.#controllers.delete(controller);
    }
  }

  #check(cutoff: number): void {
    if (this.#closed || this.deps.monotonicNow() >= cutoff) {
      throw new DeadlineExceededError();
    }
  }

  close(): void {
    this.#closed = true;
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
  }
}

// JSON.parse accepts duplicate names. This scanner rejects them at every object depth.
function rejectDuplicateJsonKeys(source: string): void {
  let offset = 0;
  const whitespace = () => {
    while (/\s/.test(source[offset] ?? "")) offset++;
  };
  const stringToken = (): string => {
    const start = offset;
    if (source[offset++] !== '"') throw new Error("json");
    let escaped = false;
    while (offset < source.length) {
      const char = source[offset++];
      if (!escaped && char === '"') {
        return JSON.parse(source.slice(start, offset));
      }
      if (!escaped && char === "\\") escaped = true;
      else escaped = false;
    }
    throw new Error("json");
  };
  const value = (depth: number): void => {
    if (depth > 16) throw new Error("json");
    whitespace();
    if (source[offset] === "{") {
      offset++;
      whitespace();
      const keys = new Set<string>();
      if (source[offset] === "}") {
        offset++;
        return;
      }
      while (true) {
        whitespace();
        const key = stringToken();
        if (keys.has(key)) throw new Error("duplicate");
        keys.add(key);
        whitespace();
        if (source[offset++] !== ":") throw new Error("json");
        value(depth + 1);
        whitespace();
        const char = source[offset++];
        if (char === "}") return;
        if (char !== ",") throw new Error("json");
      }
    }
    if (source[offset] === "[") {
      offset++;
      whitespace();
      if (source[offset] === "]") {
        offset++;
        return;
      }
      while (true) {
        value(depth + 1);
        whitespace();
        const char = source[offset++];
        if (char === "]") return;
        if (char !== ",") throw new Error("json");
      }
    }
    if (source[offset] === '"') {
      stringToken();
      return;
    }
    const match =
      /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/
        .exec(source.slice(offset));
    if (!match) throw new Error("json");
    offset += match[0].length;
  };
  value(0);
  whitespace();
  if (offset !== source.length) throw new Error("json");
}

function boundedText(
  value: unknown,
  maxCodePoints: number,
  maxBytes: number,
  nullable = false,
): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string") throw new Error("field");
  if (
    value.length === 0 || [...value].length > maxCodePoints ||
    utf8Length(value) > maxBytes ||
    value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value) ||
    /\s{2,}/u.test(value)
  ) throw new Error("field");
  return value;
}

function strictTimestamp(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/
      .exec(value);
  if (!match) return null;
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    zone,
    ,
    zoneHour,
    zoneMinute,
  ] = match;
  if (
    !validCalendarDate(`${year}${month}${day}`) || Number(hour) > 23 ||
    Number(minute) > 59 || Number(second) > 59 ||
    (zone !== "Z" &&
      (Number(zoneHour) > 14 || Number(zoneMinute) > 59 ||
        (Number(zoneHour) === 14 && Number(zoneMinute) !== 0)))
  ) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasCurrentGoogleIdentity(user: {
  last_sign_in_at?: unknown;
  identities?: unknown;
  app_metadata?: unknown;
}): boolean {
  const current = strictTimestamp(user.last_sign_in_at);
  if (current === null || !Array.isArray(user.identities)) return false;
  const matching = user.identities.filter((identity) =>
    isRecord(identity) && strictTimestamp(identity.last_sign_in_at) === current
  );
  return matching.length === 1 && matching[0].provider === "google";
}

function validCalendarDate(value: string): boolean {
  if (!/^[0-9]{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (year < 1900 || month < 1 || month > 12 || day < 1) return false;
  const days = [
    31,
    ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= days[month - 1];
}

function validateWebsite(value: unknown): string | null {
  const website = boundedText(value, 2_048, 8_192, true);
  if (website === null) return null;
  try {
    const url = new URL(website);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      !url.hostname.includes(".") ||
      ["localhost", "test", "invalid", "local", "internal"].some((suffix) =>
        url.hostname === suffix || url.hostname.endsWith(`.${suffix}`)
      ) ||
      /^[0-9.]+$/.test(url.hostname)
    ) throw new Error("website");
  } catch {
    throw new Error("website");
  }
  return website;
}

function parseInput(raw: string): Input {
  rejectDuplicateJsonKeys(raw);
  const parsed: unknown = JSON.parse(raw);
  const required = [
    "businessName",
    "businessNumber",
    "openingDate",
    "representativeName",
  ];
  const allowed = [...required, "region", "industry", "website"];
  if (
    !isRecord(parsed) || !required.every((key) => Object.hasOwn(parsed, key)) ||
    Object.keys(parsed).some((key) => !allowed.includes(key))
  ) throw new Error("shape");
  const proposedName = boundedText(parsed.businessName, 200, 800)!;
  const representativeName = boundedText(parsed.representativeName, 100, 400)!;
  const region = Object.hasOwn(parsed, "region")
    ? boundedText(parsed.region, 100, 400, true)
    : null;
  const industry = Object.hasOwn(parsed, "industry")
    ? boundedText(parsed.industry, 100, 400, true)
    : null;
  const website = Object.hasOwn(parsed, "website")
    ? validateWebsite(parsed.website)
    : null;
  if (
    typeof parsed.businessNumber !== "string" ||
    !/^(?:[0-9]{10}|[0-9]{3}-[0-9]{2}-[0-9]{5})$/.test(parsed.businessNumber)
  ) throw new Error("number");
  if (
    typeof parsed.openingDate !== "string" ||
    !validCalendarDate(parsed.openingDate)
  ) throw new Error("date");
  return {
    proposedName,
    businessNumber: parsed.businessNumber.replaceAll("-", ""),
    openingDate: parsed.openingDate,
    representativeName,
    region,
    industry,
    website,
  };
}

function jsonbString(value: string | null): string {
  return value === null ? "null" : JSON.stringify(value);
}

async function safePayloadFingerprint(
  fields: SafeCompanyFields,
): Promise<string> {
  // PostgreSQL jsonb emits this deterministic length-first key order with a space after separators.
  const canonical = `{"region": ${jsonbString(fields.region)}, "website": ${
    jsonbString(fields.website)
  }, "industry": ${jsonbString(fields.industry)}, "proposed_name": ${
    jsonbString(fields.proposedName)
  }, "verification_method": "nts_full"}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return hex(new Uint8Array(digest));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function businessNumberDigest(
  secret: string,
  digits: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const input = new Uint8Array(
    new TextEncoder().encode("breadlab:business-number:v1\0" + digits),
  );
  const digest = await crypto.subtle.sign("HMAC", key, input);
  input.fill(0);
  return hex(new Uint8Array(digest));
}

const COMPANY_ID_PATTERN =
  /^(?:KR-CRN-[0-9]{13}|KR-BIZ-[0-9]{10}|KR-CAN-[0-9a-f]{32})$/;

type RpcResultKind = "reserve" | "finalize" | "failure";

function decodeReservation(
  value: unknown,
  kind: RpcResultKind,
  expectedRequestId?: string,
  expectedFailure?: FailureArguments["category"],
): Reservation {
  if (!isRecord(value)) throw new Error("reservation");
  const expectedKeys = kind === "reserve"
    ? OWNER_KEYS
    : [...OWNER_KEYS, "verification_method"];
  if (!exactKeys(value, expectedKeys)) throw new Error("reservation");
  const created = strictTimestamp(value.created_at);
  const updated = strictTimestamp(value.updated_at);
  const nullableText = (item: unknown) =>
    item === null || (typeof item === "string" && utf8Length(item) <= 8_192);
  if (
    !validUuid(
      typeof value.request_id === "string" ? value.request_id : null,
    ) ||
    (expectedRequestId !== undefined &&
      value.request_id !== expectedRequestId) ||
    typeof value.proposed_name !== "string" || value.proposed_name.length < 1 ||
    utf8Length(value.proposed_name) > 800 ||
    !nullableText(value.region) || !nullableText(value.industry) ||
    !nullableText(value.website) ||
    !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 ||
    created === null || updated === null || updated < created ||
    !(value.resolved_company_id === null ||
      (typeof value.resolved_company_id === "string" &&
        COMPANY_ID_PATTERN.test(value.resolved_company_id))) ||
    (kind !== "reserve" && value.verification_method !== "nts_full")
  ) throw new Error("reservation");

  const pending = value.status === "pending_review" &&
    value.verification_status === "pending" &&
    value.resolved_company_id === null;
  const success = (value.status === "approved" || value.status === "merged") &&
    value.verification_status === "matched" &&
    typeof value.resolved_company_id === "string";
  const failure = value.status === "rejected" &&
    ["mismatched", "unavailable", "rejected"].includes(
      String(value.verification_status),
    ) && value.resolved_company_id === null;
  if (!(pending || success || failure)) throw new Error("reservation");
  if (kind === "reserve") {
    if (
      (pending && value.revision !== 1) || (!pending && value.revision !== 2)
    ) {
      throw new Error("reservation");
    }
  } else if (value.revision !== 2) {
    throw new Error("reservation");
  }
  if (kind === "finalize" && !success) throw new Error("reservation");
  if (
    kind === "failure" &&
    (!failure || value.verification_status !== expectedFailure)
  ) throw new Error("reservation");
  return value as Reservation;
}

function terminalReplay(reservation: Reservation): boolean {
  return reservation.status !== "pending_review";
}

function publicResult(reservation: Reservation, origin: string): Response {
  const accepted = reservation.status === "approved" ||
    reservation.status === "merged";
  return jsonResponse(200, {
    requestId: reservation.request_id,
    status: reservation.status,
    verificationStatus: reservation.verification_status,
    message: accepted
      ? "사업자 확인이 완료되었습니다."
      : "사업자 확인이 완료되지 않았습니다.",
  }, origin);
}

function indeterminateResult(
  status: 202 | 503,
  requestId: string,
  origin: string,
): Response {
  return jsonResponse(status, {
    code: "verification_indeterminate",
    requestId,
    message:
      "처리 결과를 확인할 수 없습니다. 같은 멱등성 키로 다시 시도해 주세요.",
  }, origin);
}

function reservationIndeterminateResult(origin: string): Response {
  return jsonResponse(503, {
    code: "reservation_indeterminate",
    message:
      "예약 결과를 확인할 수 없습니다. 같은 멱등성 키로 다시 시도해 주세요.",
  }, origin);
}

const VALIDATE_KEYS = ["status_code", "request_cnt", "valid_cnt", "data"];
const VALIDATE_DATA_KEYS = [
  "b_no",
  "valid",
  "valid_msg",
  "request_param",
  "status",
];
const PARAM_KEYS = [
  "b_no",
  "start_dt",
  "p_nm",
  "p_nm2",
  "b_nm",
  "corp_no",
  "b_sector",
  "b_type",
  "b_adr",
];
const STATUS_KEYS = [
  "b_no",
  "b_stt",
  "b_stt_cd",
  "tax_type",
  "tax_type_cd",
  "end_dt",
  "utcc_yn",
  "tax_type_change_dt",
  "invoice_apply_dt",
  "rbf_tax_type",
  "rbf_tax_type_cd",
];

async function readBoundedJsonValue(
  response: Response,
  signal: AbortSignal,
  requireSuccess: boolean,
): Promise<unknown> {
  if (
    response.redirected ||
    (requireSuccess && (response.status < 200 || response.status >= 300))
  ) throw new NtsError();
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !/^application\/json(?:\s*;\s*charset=(?:utf-8|UTF-8))?$/.test(contentType)
  ) throw new NtsError();
  const declared = response.headers.get("content-length");
  if (
    declared &&
    (!/^[0-9]+$/.test(declared) || Number(declared) > MAX_NTS_RESPONSE_BYTES)
  ) throw new NtsError();
  const reader = response.body?.getReader();
  if (!reader) throw new NtsError();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    void reader.cancel().catch(() => {});
  };
  try {
    while (true) {
      const { done, value } = await readChunk(reader, [signal]);
      if (done) break;
      if (total + value.byteLength > MAX_NTS_RESPONSE_BYTES) {
        cancel();
        throw new NtsError();
      }
      total += value.byteLength;
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      rejectDuplicateJsonKeys(text);
      return JSON.parse(text);
    } catch {
      cancel();
      throw new NtsError();
    } finally {
      bytes.fill(0);
    }
  } catch (error) {
    cancel();
    if (error instanceof StreamAbortedError) {
      throw new DOMException("aborted", "AbortError");
    }
    throw error;
  } finally {
    chunks.length = 0;
    try {
      reader.releaseLock();
    } catch {
      // A non-cooperative pending read keeps its lock until it settles.
    }
  }
}

async function readBoundedJson(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  return await readBoundedJsonValue(response, signal, true);
}

function decodeValidate(
  value: unknown,
  input: Input,
): "matched" | "mismatched" {
  if (
    !isRecord(value) || !exactKeys(value, VALIDATE_KEYS) ||
    value.status_code !== "OK" || value.request_cnt !== 1 ||
    !Array.isArray(value.data) || value.data.length !== 1
  ) throw new NtsError();
  const row = value.data[0];
  if (
    !isRecord(row) || !exactKeys(row, VALIDATE_DATA_KEYS) ||
    !isRecord(row.request_param) || !exactKeys(row.request_param, PARAM_KEYS) ||
    !isRecord(row.status) || !exactKeys(row.status, STATUS_KEYS)
  ) throw new NtsError();
  if (
    row.b_no !== input.businessNumber ||
    row.request_param.b_no !== input.businessNumber ||
    row.request_param.start_dt !== input.openingDate ||
    row.request_param.p_nm !== input.representativeName ||
    row.request_param.b_nm !== input.proposedName ||
    !["01", "02"].includes(String(row.valid)) ||
    typeof row.valid_msg !== "string"
  ) throw new NtsError();
  if (row.valid === "01" && value.valid_cnt === 1) return "matched";
  if (row.valid === "02" && value.valid_cnt === 0) return "mismatched";
  throw new NtsError();
}

function decodeStatus(value: unknown, businessNumber: string): boolean {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["status_code", "request_cnt", "match_cnt", "data"]) ||
    value.status_code !== "OK" || value.request_cnt !== 1 ||
    value.match_cnt !== 1 || !Array.isArray(value.data) ||
    value.data.length !== 1
  ) throw new NtsError();
  const row = value.data[0];
  if (
    !isRecord(row) || !exactKeys(row, STATUS_KEYS) ||
    row.b_no !== businessNumber || typeof row.b_stt !== "string" ||
    typeof row.b_stt_cd !== "string"
  ) throw new NtsError();
  const labels: Record<string, string> = {
    "01": "계속사업자",
    "02": "휴업자",
    "03": "폐업자",
  };
  if (!(row.b_stt_cd in labels) || row.b_stt !== labels[row.b_stt_cd]) {
    throw new NtsError();
  }
  return row.b_stt_cd === "01";
}

function ntsUrl(endpoint: "validate" | "status", serviceKey: string): string {
  return `https://api.odcloud.kr/api/nts-businessman/v1/${endpoint}?serviceKey=${
    encodeURIComponent(serviceKey)
  }`;
}

async function callNts(
  deps: VerificationDependencies,
  config: Config,
  endpoint: "validate" | "status",
  payload: unknown,
  deadline: OperationDeadline,
): Promise<unknown> {
  return await deadline.runExternal(async (signal) => {
    const response = await deps.fetch(ntsUrl(endpoint, config.ntsServiceKey), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    return await readBoundedJson(response, signal);
  });
}

function safeRpcRejection(code: string): PublicError {
  if (code === "PT429") {
    return new PublicError(
      429,
      "rate_limited",
      "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
      "rate_limited",
    );
  }
  if (["22023", "23505", "23514", "40001", "42501"].includes(code)) {
    return new PublicError(
      409,
      "request_conflict",
      "요청 상태가 변경되었습니다. 새 요청으로 다시 시도해 주세요.",
      "conflict",
    );
  }
  return new PublicError(
    503,
    "verification_unavailable",
    "사업자 확인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    "unavailable",
  );
}

function definiteRpcError(error: unknown): PublicError | null {
  return error instanceof RpcDefiniteError ? error.publicError : null;
}

function durationBucket(milliseconds: number): string {
  if (milliseconds < 100) return "lt100ms";
  if (milliseconds < 500) return "lt500ms";
  if (milliseconds < 2_000) return "lt2s";
  if (milliseconds < 8_000) return "lt8s";
  return "gte8s";
}

export async function handleVerifyBenefitCompany(
  request: Request,
  deps: VerificationDependencies = createRuntimeDependencies(),
): Promise<Response> {
  const started = performance.now();
  const edgeRequestId = deps.requestId();
  let result = "internal_error";
  let statusCategory = "internal";
  let allowedOrigin: string | null = null;
  let input: Input | null = null;
  let authorization: ReturnType<Headers["get"]> = null;
  let deadline: OperationDeadline | null = null;
  try {
    const config = loadConfig(deps);
    if (!config) {
      result = "misconfigured";
      statusCategory = "configuration";
      return safeError(
        new PublicError(
          503,
          "service_unavailable",
          "사업자 확인 서비스가 준비되지 않았습니다.",
          "configuration",
        ),
        null,
      );
    }
    const origin = request.headers.get("origin");
    if (origin === null || !config.origins.has(origin)) {
      result = "origin_forbidden";
      statusCategory = "forbidden";
      return safeError(
        new PublicError(
          403,
          "origin_forbidden",
          "허용되지 않은 요청 출처입니다.",
          "forbidden",
        ),
        null,
      );
    }
    allowedOrigin = origin;
    if (request.method === "OPTIONS") {
      const requestedMethod = request.headers.get(
        "access-control-request-method",
      );
      const requestedHeaders =
        (request.headers.get("access-control-request-headers") ?? "")
          .toLowerCase().split(",").map((item) => item.trim()).filter(Boolean);
      if (
        requestedMethod !== "POST" ||
        requestedHeaders.some((header) =>
          !CORS_HEADERS.split(", ").includes(header)
        )
      ) {
        result = "preflight_forbidden";
        statusCategory = "forbidden";
        return safeError(
          new PublicError(
            403,
            "preflight_forbidden",
            "허용되지 않은 사전 요청입니다.",
            "forbidden",
          ),
          null,
        );
      }
      result = "preflight_allowed";
      statusCategory = "success";
      const headers = corsHeaders(origin);
      headers.set("access-control-allow-methods", "POST");
      headers.set("access-control-allow-headers", CORS_HEADERS);
      headers.set("access-control-max-age", "600");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      result = "method_not_allowed";
      statusCategory = "client_error";
      return safeError(
        new PublicError(
          405,
          "method_not_allowed",
          "POST 요청만 허용됩니다.",
          "client_error",
        ),
        origin,
      );
    }
    if (request.headers.get("content-type") !== "application/json") {
      result = "unsupported_media_type";
      statusCategory = "client_error";
      return safeError(
        new PublicError(
          415,
          "unsupported_media_type",
          "JSON 요청만 허용됩니다.",
          "client_error",
        ),
        origin,
      );
    }
    try {
      contentLengthHint(request);
    } catch {
      result = "body_too_large";
      statusCategory = "client_error";
      return safeError(
        new PublicError(
          413,
          "body_too_large",
          "요청 본문이 너무 큽니다.",
          "client_error",
        ),
        origin,
      );
    }
    authorization = request.headers.get("authorization");
    if (!validBearer(authorization)) {
      result = "authentication_required";
      statusCategory = "unauthenticated";
      return safeError(
        new PublicError(
          401,
          "authentication_required",
          "로그인이 필요합니다.",
          "unauthenticated",
        ),
        origin,
      );
    }
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!validUuid(idempotencyKey)) {
      result = "invalid_idempotency_key";
      statusCategory = "client_error";
      return safeError(
        new PublicError(
          400,
          "invalid_idempotency_key",
          "멱등성 키가 올바르지 않습니다.",
          "client_error",
        ),
        origin,
      );
    }
    deadline = new OperationDeadline(
      deps,
      OPERATION_DEADLINE_MS,
      PERSISTENCE_MARGIN_MS,
    );
    let identity: AuthenticatedIdentity;
    try {
      identity = await deadline.runExternal((signal) =>
        deps.authenticate(authorization!, signal)
      );
    } catch (error) {
      if (error instanceof DeadlineExceededError) throw error;
      result = "authentication_required";
      statusCategory = "unauthenticated";
      return safeError(
        new PublicError(
          401,
          "authentication_required",
          "로그인이 필요합니다.",
          "unauthenticated",
        ),
        origin,
      );
    }
    if (!validUuid(identity.id) || !identity.currentGoogleIdentity) {
      result = "google_identity_required";
      statusCategory = "forbidden";
      return safeError(
        new PublicError(
          403,
          "google_identity_required",
          "Google 로그인 사용자만 요청할 수 있습니다.",
          "forbidden",
        ),
        origin,
      );
    }
    let raw: string;
    try {
      raw = await deadline.runExternal((signal) =>
        readRequestText(request, signal, request.signal)
      );
      input = parseInput(raw);
      raw = "";
    } catch (error) {
      if (error instanceof DeadlineExceededError) throw error;
      if (error instanceof BodyTooLargeError) {
        result = "body_too_large";
        statusCategory = "client_error";
        return safeError(
          new PublicError(
            413,
            "body_too_large",
            "요청 본문이 너무 큽니다.",
            "client_error",
          ),
          origin,
        );
      }
      result = "invalid_request";
      statusCategory = "client_error";
      return safeError(
        new PublicError(
          400,
          "invalid_request",
          "요청 형식이 올바르지 않습니다.",
          "client_error",
        ),
        origin,
      );
    }
    const fields: SafeCompanyFields = {
      proposedName: input.proposedName,
      region: input.region,
      industry: input.industry,
      website: input.website,
    };
    const payloadFingerprint = await deadline.runExternal(() =>
      safePayloadFingerprint(fields)
    );
    let reservation: Reservation;
    try {
      reservation = decodeReservation(
        await deadline.runExternal((signal) =>
          deps.reserve(authorization!, idempotencyKey, fields, signal)
        ),
        "reserve",
      );
    } catch (error) {
      const safe = definiteRpcError(error);
      if (!safe) {
        result = "reservation_indeterminate";
        statusCategory = "indeterminate";
        return reservationIndeterminateResult(origin);
      }
      result = safe.code;
      statusCategory = safe.category;
      return safeError(safe, origin);
    }
    if (terminalReplay(reservation)) {
      result = "terminal_replay";
      statusCategory = reservation.status;
      return publicResult(reservation, origin);
    }
    if (
      reservation.status !== "pending_review" ||
      reservation.verification_status !== EXPECTED_PENDING
    ) {
      result = "reservation_invalid";
      statusCategory = "conflict";
      return safeError(
        new PublicError(
          409,
          "request_conflict",
          "요청 상태가 변경되었습니다. 새 요청으로 다시 시도해 주세요.",
          "conflict",
        ),
        origin,
      );
    }

    let failureCategory: FailureArguments["category"] | null = null;
    let digest: string | null = null;
    try {
      const validate = await callNts(deps, config, "validate", {
        businesses: [{
          b_no: input.businessNumber,
          start_dt: input.openingDate,
          p_nm: input.representativeName,
          p_nm2: "",
          b_nm: input.proposedName,
          corp_no: "",
          b_sector: "",
          b_type: "",
          b_adr: "",
        }],
      }, deadline);
      if (decodeValidate(validate, input) === "mismatched") {
        failureCategory = "mismatched";
      }
      if (!failureCategory) {
        const status = await callNts(deps, config, "status", {
          b_no: [input.businessNumber],
        }, deadline);
        if (!decodeStatus(status, input.businessNumber)) {
          failureCategory = "rejected";
        }
      }
      if (!failureCategory) {
        digest = await deadline.runExternal(() =>
          businessNumberDigest(config.hmacSecret, input!.businessNumber)
        );
        deadline.checkExternal();
      }
    } catch {
      failureCategory = "unavailable";
    }
    if (!failureCategory) {
      try {
        deadline.checkExternal();
      } catch {
        failureCategory = "unavailable";
      }
    }
    if (failureCategory) {
      let failed: unknown;
      try {
        failed = await deadline.runPersistence((signal) =>
          deps.fail({
            requestId: reservation.request_id,
            expectedVerificationStatus: EXPECTED_PENDING,
            payloadFingerprint,
            category: failureCategory!,
          }, signal)
        );
      } catch (error) {
        const safe = definiteRpcError(error);
        if (safe) {
          result = safe.code;
          statusCategory = safe.category;
          return safeError(safe, origin);
        }
        result = "verification_indeterminate";
        statusCategory = "indeterminate";
        return indeterminateResult(503, reservation.request_id, origin);
      }
      try {
        decodeReservation(
          failed,
          "failure",
          reservation.request_id,
          failureCategory,
        );
      } catch {
        result = "verification_indeterminate";
        statusCategory = "indeterminate";
        return indeterminateResult(503, reservation.request_id, origin);
      }
      result = failureCategory;
      statusCategory = failureCategory;
      const status = failureCategory === "unavailable" ? 502 : 422;
      const message = failureCategory === "unavailable"
        ? "사업자 확인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
        : "사업자 확인이 완료되지 않았습니다.";
      return safeError(
        new PublicError(
          status,
          failureCategory === "unavailable"
            ? "verification_unavailable"
            : "verification_rejected",
          message,
          failureCategory,
        ),
        origin,
      );
    }
    let finalized: Reservation;
    try {
      finalized = decodeReservation(
        await deadline.runPersistence((signal) =>
          deps.finalize({
            requestId: reservation.request_id,
            expectedVerificationStatus: EXPECTED_PENDING,
            payloadFingerprint,
            businessNumberDigest: digest!,
            externalVerifiedAt: deps.now().toISOString(),
          }, signal)
        ),
        "finalize",
        reservation.request_id,
      );
    } catch (error) {
      const safe = definiteRpcError(error);
      if (!safe) {
        result = "verification_indeterminate";
        statusCategory = "indeterminate";
        return indeterminateResult(202, reservation.request_id, origin);
      }
      result = safe.code;
      statusCategory = safe.category;
      return safeError(safe, origin);
    }
    if (
      !["approved", "merged"].includes(finalized.status) ||
      finalized.verification_status !== "matched"
    ) throw new Error("finalize");
    result = "verified";
    statusCategory = finalized.status;
    return publicResult(finalized, origin);
  } catch (error) {
    if (error instanceof DeadlineExceededError) {
      result = "verification_unavailable";
      statusCategory = "unavailable";
      return safeError(
        new PublicError(
          502,
          "verification_unavailable",
          "사업자 확인 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
          "unavailable",
        ),
        allowedOrigin,
      );
    }
    result = "internal_error";
    statusCategory = "internal";
    return safeError(
      new PublicError(
        500,
        "internal_error",
        "요청을 처리할 수 없습니다.",
        "internal",
      ),
      allowedOrigin,
    );
  } finally {
    deadline?.close();
    authorization = null;
    input = null;
    deps.log({
      requestId: edgeRequestId,
      result,
      statusCategory,
      durationBucket: durationBucket(performance.now() - started),
    });
  }
}

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

function decodePostgrestRejection(
  status: number,
  value: unknown,
): PublicError | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["code", "details", "hint", "message"]) ||
    typeof value.code !== "string" || utf8Length(value.code) > 16 ||
    typeof value.message !== "string" || utf8Length(value.message) > 4_096 ||
    !(value.details === null ||
      (typeof value.details === "string" &&
        utf8Length(value.details) <= 4_096)) ||
    !(value.hint === null ||
      (typeof value.hint === "string" && utf8Length(value.hint) <= 4_096))
  ) return null;
  const expectedStatus: Record<string, number> = {
    PT429: 429,
    "22023": 400,
    "23505": 409,
    "23514": 409,
    "40001": 500,
    "42501": 403,
    "55000": 500,
  };
  if (expectedStatus[value.code] !== status) return null;
  return safeRpcRejection(value.code);
}

function decodeAuthError(value: unknown): void {
  if (
    !isRecord(value) ||
    !(
      (typeof value.code === "string" && typeof value.message === "string") ||
      (typeof value.error_code === "string" && typeof value.msg === "string")
    )
  ) throw new Error("auth");
  throw new Error("auth");
}

export function createRuntimeDependencies(
  env: (name: string) => string | undefined = (name) => Deno.env.get(name),
  fetchImpl: FetchLike = (input, init) => globalThis.fetch(input, init),
): VerificationDependencies {
  const supabaseOrigin = normalizeSupabaseOrigin(env("SUPABASE_URL"));
  const supabaseEndpoint = (pathname: string): URL => {
    if (!supabaseOrigin) throw new Error("supabase config");
    return new URL(pathname, `${supabaseOrigin}/`);
  };
  const runtimeJson = async (
    response: Response,
    signal: AbortSignal,
  ): Promise<unknown> => await readBoundedJsonValue(response, signal, false);
  const rpc = async (
    functionName: string,
    payload: Record<string, unknown>,
    authorization: string,
    apikey: string,
    signal: AbortSignal,
  ): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(
        supabaseEndpoint(`/rest/v1/rpc/${functionName}`),
        {
          method: "POST",
          redirect: "error",
          headers: {
            apikey,
            Authorization: authorization,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal,
        },
      );
    } catch {
      throw new RpcIndeterminateError();
    }
    let value: unknown;
    try {
      value = await runtimeJson(response, signal);
    } catch {
      throw new RpcIndeterminateError();
    }
    if (!response.ok) {
      const rejection = decodePostgrestRejection(response.status, value);
      if (!rejection) throw new RpcIndeterminateError();
      throw new RpcDefiniteError(rejection);
    }
    if (!isRecord(value)) throw new RpcIndeterminateError();
    return value;
  };
  const serviceRpc = async (
    functionName: string,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<unknown> => {
    const serviceRoleKey = env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    return await rpc(
      functionName,
      payload,
      `Bearer ${serviceRoleKey}`,
      serviceRoleKey,
      signal,
    );
  };
  return {
    env,
    authenticate: async (authorization, signal) => {
      const response = await fetchImpl(
        supabaseEndpoint("/auth/v1/user"),
        {
          method: "GET",
          redirect: "error",
          headers: {
            apikey: env("SUPABASE_ANON_KEY") ?? "",
            Authorization: authorization,
          },
          signal,
        },
      );
      const value = await runtimeJson(response, signal);
      if (!response.ok) decodeAuthError(value);
      if (
        !isRecord(value) || !validUuid(
          typeof value.id === "string" ? value.id : null,
        )
      ) throw new Error("auth");
      return {
        id: value.id as string,
        currentGoogleIdentity: hasCurrentGoogleIdentity(value),
      };
    },
    reserve: async (authorization, idempotencyKey, fields, signal) =>
      await rpc(
        "reserve_benefit_company_nts_request_v1",
        {
          p_client_key: idempotencyKey,
          p_proposed_name: fields.proposedName,
          p_region: fields.region,
          p_industry: fields.industry,
          p_website: fields.website,
        },
        authorization,
        env("SUPABASE_ANON_KEY") ?? "",
        signal,
      ),
    finalize: async (args, signal) =>
      await serviceRpc(
        "finalize_benefit_company_nts_request_v1",
        {
          p_request_id: args.requestId,
          p_expected_verification_status: args.expectedVerificationStatus,
          p_payload_fingerprint: args.payloadFingerprint,
          p_business_number_digest: args.businessNumberDigest,
          p_external_verified_at: args.externalVerifiedAt,
        },
        signal,
      ),
    fail: async (args, signal) =>
      await serviceRpc(
        "fail_benefit_company_nts_request_v1",
        {
          p_request_id: args.requestId,
          p_expected_verification_status: args.expectedVerificationStatus,
          p_payload_fingerprint: args.payloadFingerprint,
          p_failure_category: args.category,
        },
        signal,
      ),
    fetch: fetchImpl,
    now: () => new Date(),
    monotonicNow: () => performance.now(),
    requestId: () => crypto.randomUUID(),
    log: (entry) => console.log(JSON.stringify(entry)),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  };
}

if (import.meta.main) {
  Deno.serve((request) => handleVerifyBenefitCompany(request));
}
