import assert from "node:assert/strict";
import {
  businessNumberDigest,
  createRuntimeDependencies,
  handleVerifyBenefitCompany,
  hasCurrentGoogleIdentity,
  type VerificationDependencies,
} from "./index.ts";

const ORIGIN = "https://www.breadlab.ai";
const KEY = "123e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "223e4567-e89b-42d3-a456-426614174000";
const BUSINESS_NUMBER = "123-45-67890";
const REPRESENTATIVE = "민감대표";
const OPENING_DATE = "20200102";
const BUSINESS_NAME = "민감회사";
const RAW_SENTINELS = [
  BUSINESS_NUMBER,
  "1234567890",
  REPRESENTATIVE,
  OPENING_DATE,
];
const OUTPUT_SENTINELS = [...RAW_SENTINELS, BUSINESS_NAME];
const SECRET = "0123456789abcdef0123456789abcdef";
const EXPECTED_DIGEST =
  "46e79edee22e59af16114ef95c5753e3354b0d29eb83a5fc5b8e261cbea7ee91";
const ENV = {
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_ANON_KEY: "anon-key-value-long-enough",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value-long-enough",
  NTS_SERVICE_KEY: "nts key/+?&",
  BUSINESS_NUMBER_HMAC_SECRET: SECRET,
  BENEFIT_COMPANY_ALLOWED_ORIGINS: ORIGIN,
};
const BODY = {
  businessName: BUSINESS_NAME,
  businessNumber: BUSINESS_NUMBER,
  openingDate: OPENING_DATE,
  representativeName: REPRESENTATIVE,
  region: "서울",
  industry: "소프트웨어",
  website: "https://example.com",
};

function reserveResult(overrides: Record<string, unknown> = {}) {
  return {
    request_id: REQUEST_ID,
    proposed_name: BUSINESS_NAME,
    region: "서울",
    industry: "소프트웨어",
    website: "https://example.com",
    verification_status: "pending",
    status: "pending_review",
    revision: 1,
    resolved_company_id: null,
    created_at: "2026-11-23T00:00:00.000Z",
    updated_at: "2026-11-23T00:00:00.000Z",
    ...overrides,
  };
}

function validateEnvelope(valid = "01") {
  return {
    status_code: "OK",
    request_cnt: 1,
    valid_cnt: valid === "01" ? 1 : 0,
    data: [{
      b_no: "1234567890",
      valid,
      valid_msg: valid === "01" ? "확인되었습니다." : "확인할 수 없습니다.",
      request_param: {
        b_no: "1234567890",
        start_dt: OPENING_DATE,
        p_nm: REPRESENTATIVE,
        p_nm2: "",
        b_nm: BUSINESS_NAME,
        corp_no: "",
        b_sector: "",
        b_type: "",
        b_adr: "",
      },
      status: {
        b_no: "1234567890",
        b_stt: "계속사업자",
        b_stt_cd: "01",
        tax_type: "부가가치세 일반과세자",
        tax_type_cd: "01",
        end_dt: "",
        utcc_yn: "Y",
        tax_type_change_dt: "",
        invoice_apply_dt: "",
        rbf_tax_type: "해당없음",
        rbf_tax_type_cd: "99",
      },
    }],
  };
}

function statusEnvelope(code = "01") {
  const labels: Record<string, string> = {
    "01": "계속사업자",
    "02": "휴업자",
    "03": "폐업자",
  };
  return {
    status_code: "OK",
    request_cnt: 1,
    match_cnt: 1,
    data: [{
      b_no: "1234567890",
      b_stt: labels[code] ?? "",
      b_stt_cd: code,
      tax_type: "부가가치세 일반과세자",
      tax_type_cd: "01",
      end_dt: code === "03" ? "20220101" : "",
      utcc_yn: "Y",
      tax_type_change_dt: "",
      invoice_apply_dt: "",
      rbf_tax_type: "해당없음",
      rbf_tax_type_cd: "99",
    }],
  };
}

function ntsResponse(value: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json; charset=UTF-8" },
    ...init,
  });
}

type Events = {
  auth: string[];
  authSignals: AbortSignal[];
  reserve: unknown[][];
  reserveSignals: AbortSignal[];
  finalize: unknown[];
  finalizeSignals: AbortSignal[];
  fail: unknown[];
  failSignals: AbortSignal[];
  fetch: Array<{ url: string; init: RequestInit }>;
  logs: unknown[];
  timers: number[];
};

function dependencies(
  changes: Partial<VerificationDependencies> = {},
  envChanges: Record<string, string | undefined> = {},
): { deps: VerificationDependencies; events: Events } {
  const events: Events = {
    auth: [],
    authSignals: [],
    reserve: [],
    reserveSignals: [],
    finalize: [],
    finalizeSignals: [],
    fail: [],
    failSignals: [],
    fetch: [],
    logs: [],
    timers: [],
  };
  let call = 0;
  const env = { ...ENV, ...envChanges } as Record<string, string | undefined>;
  const deps: VerificationDependencies = {
    env: (name) => env[name],
    authenticate: async (authorization, signal) => {
      events.auth.push(authorization);
      events.authSignals.push(signal);
      return {
        id: "323e4567-e89b-42d3-a456-426614174000",
        providers: ["google"],
        currentGoogleIdentity: true,
      };
    },
    reserve: async (authorization, idempotencyKey, fields, signal) => {
      events.reserve.push([authorization, idempotencyKey, fields]);
      events.reserveSignals.push(signal);
      return reserveResult();
    },
    finalize: async (args, signal) => {
      events.finalize.push(args);
      events.finalizeSignals.push(signal);
      return reserveResult({
        verification_method: "nts_full",
        verification_status: "matched",
        status: "approved",
        revision: 2,
        resolved_company_id: "KR-CAN-0123456789abcdef0123456789abcdef",
      });
    },
    fail: async (args, signal) => {
      events.fail.push(args);
      events.failSignals.push(signal);
      return reserveResult({
        verification_method: "nts_full",
        verification_status: args.category,
        status: "rejected",
        revision: 2,
      });
    },
    fetch: async (input, init) => {
      events.fetch.push({ url: String(input), init: init ?? {} });
      return ntsResponse(call++ === 0 ? validateEnvelope() : statusEnvelope());
    },
    now: () => new Date("2026-11-23T00:00:01.000Z"),
    monotonicNow: () => performance.now(),
    requestId: () => "edge-request-id",
    log: (entry) => events.logs.push(entry),
    setTimeout: (callback, _delay) => {
      events.timers.push(1);
      return globalThis.setTimeout(callback, 60_000);
    },
    clearTimeout: (id) => {
      events.timers.pop();
      globalThis.clearTimeout(id);
    },
    ...changes,
  };
  return { deps, events };
}

function request(
  body: unknown = BODY,
  options: {
    origin?: string | null;
    method?: string;
    authorization?: string | null;
    key?: string | null;
    raw?: string;
  } = {},
) {
  const raw = options.raw ?? JSON.stringify(body);
  const headers = new Headers({
    "content-type": "application/json",
    "content-length": String(new TextEncoder().encode(raw).byteLength),
  });
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  if (options.authorization !== null) {
    headers.set(
      "authorization",
      options.authorization ?? "Bearer user-token-value",
    );
  }
  if (options.key !== null) headers.set("idempotency-key", options.key ?? KEY);
  return new Request("https://edge.test/verify-benefit-company", {
    method: options.method ?? "POST",
    headers,
    body: ["GET", "HEAD"].includes(options.method ?? "") ? undefined : raw,
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json();
}

function assertNoSensitive(value: unknown) {
  const encoded = JSON.stringify(value);
  for (const sentinel of RAW_SENTINELS) {
    assert.equal(encoded.includes(sentinel), false, sentinel);
  }
}

function assertNoIdentityOutput(value: unknown) {
  const encoded = JSON.stringify(value);
  for (const sentinel of OUTPUT_SENTINELS) {
    assert.equal(encoded.includes(sentinel), false, sentinel);
  }
}

Deno.test("HMAC-SHA-256 uses the versioned domain and lower-case hex", async () => {
  assert.equal(
    await businessNumberDigest(SECRET, "1234567890"),
    EXPECTED_DIGEST,
  );
});

Deno.test("allows only an exact configured HTTPS origin for preflight and POST", async () => {
  const { deps } = dependencies();
  const preflight = await handleVerifyBenefitCompany(
    new Request("https://edge.test", {
      method: "OPTIONS",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "authorization, content-type, idempotency-key",
      },
    }),
    deps,
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "POST");
  assert.equal(
    preflight.headers.get("access-control-allow-headers"),
    "authorization, content-type, idempotency-key",
  );
  assert.equal(preflight.headers.get("access-control-max-age"), "600");
  assert.equal(preflight.headers.get("vary"), "Origin");

  for (
    const origin of [
      null,
      "http://www.breadlab.ai",
      "https://evil.example",
      "https://www.breadlab.ai/path",
      "https://user@www.breadlab.ai",
      "not a url",
    ]
  ) {
    const response = await handleVerifyBenefitCompany(
      request(BODY, { origin }),
      deps,
    );
    assert.equal(response.status, 403, String(origin));
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});

Deno.test("fails closed for absent or malformed origin configuration", async () => {
  for (
    const configured of [
      undefined,
      "",
      "*",
      "http://localhost:3000",
      "https://ok.example/path",
      "https://user@ok.example",
      "https://ok.example,,https://two.example",
      "not a url",
    ]
  ) {
    const { deps } = dependencies({}, {
      BENEFIT_COMPANY_ALLOWED_ORIGINS: configured,
    });
    const response = await handleVerifyBenefitCompany(request(), deps);
    assert.equal(response.status, 503, String(configured));
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
});

Deno.test("rejects wrong method, anonymous, malformed bearer, and invalid idempotency key", async () => {
  const { deps, events } = dependencies();
  assert.equal(
    (await handleVerifyBenefitCompany(request(BODY, { method: "GET" }), deps))
      .status,
    405,
  );
  for (
    const authorization of [
      null,
      "",
      "Basic abc",
      "Bearer",
      "Bearer ",
      "Bearer a b",
      `Bearer ${"a".repeat(4097)}`,
    ]
  ) {
    assert.equal(
      (await handleVerifyBenefitCompany(request(BODY, { authorization }), deps))
        .status,
      401,
      String(authorization),
    );
  }
  for (
    const key of [
      null,
      "",
      "not-uuid",
      KEY.toUpperCase(),
      "00000000-0000-0000-0000-000000000000",
    ]
  ) {
    assert.equal(
      (await handleVerifyBenefitCompany(request(BODY, { key }), deps)).status,
      400,
      String(key),
    );
  }
  assert.equal(events.fetch.length, 0);
});

Deno.test("requires server-validated evidence that the current session is Google", async () => {
  for (
    const [label, providers, currentGoogleIdentity, expected] of [
      ["current google", ["google"], true, 200],
      ["linked google but current github", ["google", "github"], false, 403],
      ["metadata spoof", ["google"], false, 403],
      ["missing timestamp evidence", ["google"], false, 403],
      ["ambiguous timestamp evidence", ["google", "github"], false, 403],
    ] as const
  ) {
    const { deps, events } = dependencies({
      authenticate: async () => ({
        id: "323e4567-e89b-42d3-a456-426614174000",
        providers: [...providers],
        currentGoogleIdentity,
      }),
    });
    const response = await handleVerifyBenefitCompany(request(), deps);
    assert.equal(response.status, expected, label);
    if (expected === 403) assert.equal(events.reserve.length, 0, label);
  }
});

Deno.test("derives current Google evidence from validated user and identity timestamps", () => {
  const current = "2026-11-23T00:00:00.000Z";
  const older = "2026-11-22T00:00:00.000Z";
  assert.equal(
    hasCurrentGoogleIdentity({
      last_sign_in_at: current,
      app_metadata: { provider: "github" },
      identities: [{ provider: "google", last_sign_in_at: current }],
    }),
    true,
  );
  for (
    const fixture of [{
      last_sign_in_at: current,
      identities: [
        { provider: "google", last_sign_in_at: older },
        { provider: "github", last_sign_in_at: current },
      ],
    }, {
      last_sign_in_at: current,
      identities: [
        { provider: "google", last_sign_in_at: current },
        { provider: "github", last_sign_in_at: current },
      ],
    }, {
      last_sign_in_at: current,
      identities: [{ provider: "google" }],
    }, {
      identities: [{ provider: "google", last_sign_in_at: current }],
    }]
  ) {
    assert.equal(hasCurrentGoogleIdentity(fixture), false);
  }
});

Deno.test("rejects non-JSON request content type before authentication", async () => {
  const { deps, events } = dependencies();
  const invalid = request();
  invalid.headers.set("content-type", "text/plain");
  const response = await handleVerifyBenefitCompany(invalid, deps);
  assert.equal(response.status, 415);
  assert.equal(events.auth.length, 0);
});

Deno.test("rejects oversized wire body before parse, auth, reserve, or external fetch", async () => {
  const { deps, events } = dependencies();
  const response = await handleVerifyBenefitCompany(
    request({}, { raw: "x".repeat(16_385) }),
    deps,
  );
  assert.equal(response.status, 413);
  assert.deepEqual([
    events.auth.length,
    events.reserve.length,
    events.fetch.length,
  ], [0, 0, 0]);
});

Deno.test("streams chunked request bodies with a hard retained-byte cap", async () => {
  let pulls = 0;
  let cancelled = 0;
  const chunks = [
    new TextEncoder().encode(JSON.stringify(BODY)),
    new Uint8Array(16_384),
    new Uint8Array(16_384),
  ];
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled++;
    },
  });
  const streamed = new Request("https://edge.test/verify-benefit-company", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: "Bearer user-token-value",
      "idempotency-key": KEY,
      "content-type": "application/json",
      "content-length": "1",
    },
    body: stream,
  });
  const { deps, events } = dependencies();
  const response = await handleVerifyBenefitCompany(streamed, deps);
  assert.equal(response.status, 413);
  // A web stream may prefetch one queued chunk before cancellation becomes
  // observable; no prefetched bytes are retained by the handler.
  assert.ok(pulls <= 3, `unexpected pulls: ${pulls}`);
  assert.equal(cancelled, 1);
  assert.deepEqual([
    events.auth.length,
    events.reserve.length,
    events.fetch.length,
  ], [0, 0, 0]);
});

Deno.test("rejects invalid UTF-8 before JSON, auth, and reservation", async () => {
  const invalidUtf8 = new Request("https://edge.test/verify-benefit-company", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: "Bearer user-token-value",
      "idempotency-key": KEY,
      "content-type": "application/json",
    },
    body: new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
  });
  const { deps, events } = dependencies();
  const response = await handleVerifyBenefitCompany(invalidUtf8, deps);
  assert.equal(response.status, 400);
  assert.deepEqual([events.auth.length, events.reserve.length], [0, 0]);
});

Deno.test("accepts a valid request body without Content-Length", async () => {
  const raw = JSON.stringify(BODY);
  const streamed = new Request("https://edge.test/verify-benefit-company", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      authorization: "Bearer user-token-value",
      "idempotency-key": KEY,
      "content-type": "application/json",
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(raw));
        controller.close();
      },
    }),
  });
  const { deps } = dependencies();
  assert.equal((await handleVerifyBenefitCompany(streamed, deps)).status, 200);
});

Deno.test("validates bearer and idempotency syntax before the first body pull", async () => {
  for (const options of [{ authorization: null }, { key: "not-uuid" }]) {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        controller.enqueue(new TextEncoder().encode(JSON.stringify(BODY)));
        controller.close();
      },
    }, { highWaterMark: 0 });
    const headers = new Headers({
      origin: ORIGIN,
      "content-type": "application/json",
      "idempotency-key": options.key ?? KEY,
    });
    if (options.authorization !== null) {
      headers.set("authorization", "Bearer user-token-value");
    }
    const { deps, events } = dependencies();
    const response = await handleVerifyBenefitCompany(
      new Request("https://edge.test/verify-benefit-company", {
        method: "POST",
        headers,
        body: stream,
      }),
      deps,
    );
    assert.equal(response.status, options.authorization === null ? 401 : 400);
    assert.equal(pulls, 0);
    assert.deepEqual([events.auth.length, events.reserve.length], [0, 0]);
  }
});

Deno.test("bounds and cancels a request body that sends one chunk but never closes", async () => {
  let cancelled = 0;
  let timerCalls = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
    },
    cancel() {
      cancelled++;
    },
  });
  const { deps, events } = dependencies({
    setTimeout: (callback) => {
      timerCalls++;
      queueMicrotask(callback);
      return 23 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {},
  });
  const response = await handleVerifyBenefitCompany(
    new Request("https://edge.test/verify-benefit-company", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        authorization: "Bearer user-token-value",
        "idempotency-key": KEY,
        "content-type": "application/json",
      },
      body: stream,
    }),
    deps,
  );
  assert.equal(response.status, 502);
  assert.equal(timerCalls, 1);
  assert.equal(cancelled, 1);
  assert.deepEqual([
    events.auth.length,
    events.reserve.length,
    events.fetch.length,
  ], [0, 0, 0]);
});

Deno.test("accepts omission of all optional company fields", async () => {
  const { deps, events } = dependencies();
  const response = await handleVerifyBenefitCompany(
    request({
      businessName: BUSINESS_NAME,
      businessNumber: BUSINESS_NUMBER,
      openingDate: OPENING_DATE,
      representativeName: REPRESENTATIVE,
    }),
    deps,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(events.reserve[0][2], {
    proposedName: BUSINESS_NAME,
    region: null,
    industry: null,
    website: null,
  });
});

Deno.test("strictly rejects malformed, duplicate, extra, missing, wrong-type, and invalid fields", async () => {
  const invalid: Array<[string, string]> = [
    ["malformed", "{"],
    [
      "duplicate",
      `{"businessName":"${BUSINESS_NAME}","businessName":"다른회사","businessNumber":"${BUSINESS_NUMBER}","openingDate":"${OPENING_DATE}","representativeName":"${REPRESENTATIVE}"}`,
    ],
    ["extra", JSON.stringify({ ...BODY, extra: true })],
    ["missing", JSON.stringify({ ...BODY, businessName: undefined })],
    ["wrong type", JSON.stringify({ ...BODY, region: 3 })],
    [
      "bad number letters",
      JSON.stringify({ ...BODY, businessNumber: "123-45-A7890" }),
    ],
    [
      "bad number separators",
      JSON.stringify({ ...BODY, businessNumber: "123 45 67890" }),
    ],
    ["bad date shape", JSON.stringify({ ...BODY, openingDate: "2020-01-02" })],
    ["bad calendar date", JSON.stringify({ ...BODY, openingDate: "20230229" })],
    [
      "name too long",
      JSON.stringify({ ...BODY, businessName: "가".repeat(201) }),
    ],
    [
      "representative control",
      JSON.stringify({ ...BODY, representativeName: "민감\n대표" }),
    ],
    [
      "website insecure",
      JSON.stringify({ ...BODY, website: "http://example.com" }),
    ],
  ];
  for (const [label, raw] of invalid) {
    const { deps, events } = dependencies();
    const response = await handleVerifyBenefitCompany(
      request({}, { raw }),
      deps,
    );
    assert.equal(response.status, 400, label);
    assert.equal(events.reserve.length, 0, label);
    assert.equal(events.fetch.length, 0, label);
  }
});

Deno.test("fails safely when any required environment value is missing or HMAC secret is weak", async () => {
  for (const name of Object.keys(ENV)) {
    const { deps, events } = dependencies({}, { [name]: undefined });
    const response = await handleVerifyBenefitCompany(request(), deps);
    assert.equal(response.status, 503, name);
    assert.equal(events.auth.length, 0, name);
  }
  const { deps } = dependencies({}, {
    BUSINESS_NUMBER_HMAC_SECRET: "too-short",
  });
  assert.equal((await handleVerifyBenefitCompany(request(), deps)).status, 503);
});

Deno.test("measures HMAC secret strength in UTF-8 bytes", async () => {
  for (const secret of ["🔐".repeat(16), "🔐".repeat(8)]) {
    const accepted = dependencies({}, {
      BUSINESS_NUMBER_HMAC_SECRET: secret,
    });
    assert.equal(
      (await handleVerifyBenefitCompany(request(), accepted.deps)).status,
      200,
    );
  }
  for (const secret of ["a".repeat(31), "🔐".repeat(7)]) {
    const { deps } = dependencies({}, {
      BUSINESS_NUMBER_HMAC_SECRET: secret,
    });
    assert.equal(
      (await handleVerifyBenefitCompany(request(), deps)).status,
      503,
    );
  }
});

Deno.test("reserve receives authenticated bearer and safe fields, and maps rate/conflict/failure", async () => {
  for (
    const [error, status] of [[{ code: "PT429" }, 429], [
      { code: "22023" },
      409,
    ], [new Error("private detail"), 502]] as const
  ) {
    const { deps, events } = dependencies({
      reserve: async () => {
        throw error;
      },
    });
    const response = await handleVerifyBenefitCompany(request(), deps);
    assert.equal(response.status, status);
    assert.equal(events.fetch.length, 0);
    assertNoSensitive(await body(response));
  }
  const { deps, events } = dependencies();
  await handleVerifyBenefitCompany(request(), deps);
  assert.equal(events.reserve.length, 1);
  assert.equal(events.reserve[0][0], "Bearer user-token-value");
  assert.deepEqual(events.reserve[0][2], {
    proposedName: BUSINESS_NAME,
    region: "서울",
    industry: "소프트웨어",
    website: "https://example.com",
  });
  assertNoSensitive(events.reserve[0]);
});

Deno.test("terminal reservation replay returns safe existing result without NTS", async () => {
  for (const status of ["approved", "merged", "rejected"]) {
    const verification_status = status === "rejected"
      ? "mismatched"
      : "matched";
    const { deps, events } = dependencies({
      reserve: async () =>
        reserveResult({
          status,
          verification_status,
          revision: 2,
          resolved_company_id: status === "rejected"
            ? null
            : "KR-CAN-0123456789abcdef0123456789abcdef",
        }),
    });
    const response = await handleVerifyBenefitCompany(request(), deps);
    assert.equal(response.status, 200);
    assert.equal(events.fetch.length, 0);
    assert.deepEqual(await body(response), {
      requestId: REQUEST_ID,
      status,
      verificationStatus: verification_status,
      message: status === "rejected"
        ? "사업자 확인이 완료되지 않았습니다."
        : "사업자 확인이 완료되었습니다.",
    });
  }
});

Deno.test("RPC decoder rejects missing, extra, malformed, and impossible reservation states", async () => {
  const invalid = [
    reserveResult({ revision: 0 }),
    reserveResult({ revision: 2 }),
    reserveResult({ created_at: "not-a-timestamp" }),
    reserveResult({ created_at: "2026-02-30T00:00:00.000Z" }),
    reserveResult({ resolved_company_id: "KR-CAN-safe" }),
    reserveResult({ extra: true }),
    (() => {
      const value = reserveResult();
      delete (value as Record<string, unknown>).updated_at;
      return value;
    })(),
    reserveResult({ status: "approved", verification_status: "pending" }),
    reserveResult({ status: "rejected", verification_status: "matched" }),
    reserveResult({
      status: "approved",
      verification_status: "matched",
      revision: 1,
      resolved_company_id: "KR-CAN-0123456789abcdef0123456789abcdef",
    }),
    reserveResult({
      status: "approved",
      verification_status: "matched",
      resolved_company_id: null,
    }),
  ];
  for (const value of invalid) {
    const { deps, events } = dependencies({ reserve: async () => value });
    const response = await handleVerifyBenefitCompany(request(), deps);
    assert.equal(response.status, 502);
    assert.equal(events.fetch.length, 0);
    assert.equal(events.finalize.length, 0);
  }
});

Deno.test("finalize and failure RPC responses require exact terminal state", async () => {
  const badFinal = dependencies({
    finalize: async () =>
      reserveResult({
        verification_method: "nts_full",
        status: "rejected",
        verification_status: "mismatched",
        revision: 2,
      }),
  });
  assert.equal(
    (await handleVerifyBenefitCompany(request(), badFinal.deps)).status,
    502,
  );

  const badFailure = dependencies({
    fetch: async () => ntsResponse(validateEnvelope("02")),
    fail: async () =>
      reserveResult({
        verification_method: "nts_full",
        status: "approved",
        verification_status: "matched",
        revision: 2,
        resolved_company_id: "KR-CAN-0123456789abcdef0123456789abcdef",
      }),
  });
  assert.equal(
    (await handleVerifyBenefitCompany(request(), badFailure.deps)).status,
    502,
  );

  for (const kind of ["finalize", "failure"] as const) {
    const changes: Partial<VerificationDependencies> = kind === "finalize"
      ? {
        finalize: async () =>
          reserveResult({
            verification_method: "nts_full",
            status: "approved",
            verification_status: "matched",
            revision: 1,
            resolved_company_id: "KR-CAN-0123456789abcdef0123456789abcdef",
          }),
      }
      : {
        fetch: async () => ntsResponse(validateEnvelope("02")),
        fail: async () =>
          reserveResult({
            verification_method: "nts_full",
            status: "rejected",
            verification_status: "mismatched",
            revision: 1,
          }),
      };
    const scenario = dependencies(changes);
    assert.equal(
      (await handleVerifyBenefitCompany(request(), scenario.deps)).status,
      502,
      `${kind} revision 1`,
    );
  }
});

Deno.test("calls both official fixed NTS URLs with bounded safe options", async () => {
  const { deps, events } = dependencies();
  assert.equal((await handleVerifyBenefitCompany(request(), deps)).status, 200);
  assert.equal(events.fetch.length, 2);
  const encoded = encodeURIComponent(ENV.NTS_SERVICE_KEY);
  assert.equal(
    events.fetch[0].url,
    `https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=${encoded}`,
  );
  assert.equal(
    events.fetch[1].url,
    `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encoded}`,
  );
  for (const item of events.fetch) {
    assert.equal(item.init.method, "POST");
    assert.equal(item.init.redirect, "error");
    assert.equal(
      (item.init.headers as Record<string, string>)["content-type"],
      "application/json",
    );
    assert.ok(item.init.signal instanceof AbortSignal);
  }
  assert.notEqual(events.fetch[0].init.signal, events.fetch[1].init.signal);
  assert.deepEqual(JSON.parse(String(events.fetch[0].init.body)), {
    businesses: [{
      b_no: "1234567890",
      start_dt: OPENING_DATE,
      p_nm: REPRESENTATIVE,
      p_nm2: "",
      b_nm: BUSINESS_NAME,
      corp_no: "",
      b_sector: "",
      b_type: "",
      b_adr: "",
    }],
  });
  assert.deepEqual(JSON.parse(String(events.fetch[1].init.body)), {
    b_no: ["1234567890"],
  });
  assert.equal(events.timers.length, 0);
});

Deno.test("validate mismatch and official inactive statuses fail with safe categories", async () => {
  for (const scenario of ["mismatch", "suspended", "closed"] as const) {
    let call = 0;
    const { deps, events } = dependencies({
      fetch: async () =>
        scenario === "mismatch"
          ? ntsResponse(validateEnvelope("02"))
          : ntsResponse(
            call++ === 0
              ? validateEnvelope()
              : statusEnvelope(scenario === "suspended" ? "02" : "03"),
          ),
    });
    const response = await handleVerifyBenefitCompany(request(), deps);
    assert.equal(response.status, 422);
    assert.equal(events.fail.length, 1);
    assert.equal(
      (events.fail[0] as Record<string, unknown>).category,
      scenario === "mismatch" ? "mismatched" : "rejected",
    );
    assert.equal(events.finalize.length, 0);
    assert.equal(events.failSignals.length, 1);
    assert.ok(events.failSignals[0] instanceof AbortSignal);
    assertNoSensitive(events.fail);
    assertNoSensitive(await body(response));
  }
});

Deno.test("rejects inconsistent NTS status code and official Korean label", async () => {
  let call = 0;
  const inconsistent = statusEnvelope("02");
  inconsistent.data[0].b_stt = "폐업자";
  const { deps, events } = dependencies({
    fetch: async () =>
      ntsResponse(call++ === 0 ? validateEnvelope() : inconsistent),
  });
  const response = await handleVerifyBenefitCompany(request(), deps);
  assert.equal(response.status, 502);
  assert.equal(
    (events.fail[0] as Record<string, unknown>).category,
    "unavailable",
  );
  assert.equal(events.finalize.length, 0);
});

Deno.test("NTS transport and decoder failures are unavailable and never finalize", async () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["network", async () => {
      throw new TypeError("network secret");
    }],
    ["non-2xx", async () => ntsResponse({}, { status: 503 })],
    [
      "malformed",
      async () =>
        new Response("{", { headers: { "content-type": "application/json" } }),
    ],
    [
      "content type",
      async () =>
        new Response("{}", { headers: { "content-type": "text/html" } }),
    ],
    [
      "oversized",
      async () =>
        new Response(" ".repeat(65_537), {
          headers: { "content-type": "application/json" },
        }),
    ],
    [
      "redirect",
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example" },
        }),
    ],
    [
      "extra envelope",
      async () => ntsResponse({ ...validateEnvelope(), unexpected: true }),
    ],
    [
      "wrong envelope",
      async () =>
        ntsResponse({
          status_code: "OK",
          request_cnt: 2,
          valid_cnt: 1,
          data: [],
        }),
    ],
  ];
  for (const [label, fetcher] of cases) {
    const { deps, events } = dependencies({ fetch: fetcher });
    const response = await handleVerifyBenefitCompany(request(), deps);
    assert.equal(response.status, 502, label);
    assert.equal(events.finalize.length, 0, label);
    assert.equal(events.fail.length, 1, label);
    assert.equal(
      (events.fail[0] as Record<string, unknown>).category,
      "unavailable",
      label,
    );
    assertNoSensitive(await body(response));
  }
});

Deno.test("NTS timeout persists exact revision-2 unavailable and never finalizes", async () => {
  let callback: (() => void) | undefined;
  let cleared = 0;
  const { deps, events } = dependencies({
    setTimeout: (fn) => {
      callback = fn;
      return 7 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (id) => {
      assert.equal(id as unknown, 7);
      cleared++;
    },
    fetch: async (_input, init) =>
      await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
        );
        queueMicrotask(() => callback?.());
      }),
  });
  const response = await handleVerifyBenefitCompany(request(), deps);
  assert.equal(response.status, 502);
  assert.ok(cleared >= 1);
  assert.equal(events.fail.length, 1);
  assert.equal(
    (events.fail[0] as Record<string, unknown>).category,
    "unavailable",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(events.finalize.length, 0);
});

Deno.test("deadline wins when an aborted fetch or response reader ignores its signal", async () => {
  for (const boundary of ["fetch", "reader"] as const) {
    let callback: (() => void) | undefined;
    let call = 0;
    const { deps, events } = dependencies({
      setTimeout: (fn) => {
        callback = fn;
        return 9 as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: () => {},
      fetch: async () => {
        if (call++ > 0) return ntsResponse(statusEnvelope());
        if (boundary === "fetch") {
          queueMicrotask(() => callback?.());
          await new Promise((resolve) => setTimeout(resolve, 0));
          return ntsResponse(validateEnvelope());
        }
        return new Response(
          new ReadableStream({
            pull(controller) {
              queueMicrotask(() => callback?.());
              controller.enqueue(
                new TextEncoder().encode(JSON.stringify(validateEnvelope())),
              );
              controller.close();
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    const response = await handleVerifyBenefitCompany(request(), deps);
    assert.equal(response.status, 502, boundary);
    assert.equal(events.fail.length, 1, boundary);
    assert.equal(events.finalize.length, 0, boundary);
  }
});

Deno.test("external cutoff prevents finalize and persists unavailable", async () => {
  let call = 0;
  let now = 0;
  const { deps, events } = dependencies({
    monotonicNow: () => now,
    fetch: async () => {
      const response = ntsResponse(
        call++ === 0 ? validateEnvelope() : statusEnvelope(),
      );
      if (call === 2) now = 6_000;
      return response;
    },
  });
  const response = await handleVerifyBenefitCompany(request(), deps);
  assert.equal(response.status, 502);
  assert.equal(events.fail.length, 1);
  assert.equal(
    (events.fail[0] as Record<string, unknown>).category,
    "unavailable",
  );
  assert.equal(events.finalize.length, 0);
});

Deno.test("deadline covers reserve providers that ignore cancellation", async () => {
  let callback: (() => void) | undefined;
  const changes: Partial<VerificationDependencies> = {
    setTimeout: (fn) => {
      callback = fn;
      return 13 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {},
    reserve: async () => {
      queueMicrotask(() => callback?.());
      await new Promise((resolve) => setTimeout(resolve, 0));
      return reserveResult();
    },
  };
  const { deps, events } = dependencies(changes);
  const response = await handleVerifyBenefitCompany(request(), deps);
  assert.equal(response.status, 503);
  assert.equal((await body(response)).code, "reservation_indeterminate");
  assert.equal(events.finalize.length, 0);
});

Deno.test("delayed finalize is indeterminate and terminal replay converges without NTS", async () => {
  let callback: (() => void) | undefined;
  let committed = false;
  let finalizeAborted = false;
  const finalizeInvocations: unknown[] = [];
  const first = dependencies({
    setTimeout: (fn) => {
      callback = fn;
      return 17 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {},
    finalize: async (args, signal) => {
      finalizeInvocations.push(args);
      signal.addEventListener("abort", () => {
        finalizeAborted = true;
      }, { once: true });
      queueMicrotask(() => callback?.());
      await new Promise((resolve) => setTimeout(resolve, 0));
      committed = true;
      return reserveResult({
        verification_method: "nts_full",
        status: "approved",
        verification_status: "matched",
        revision: 2,
        resolved_company_id: "KR-CAN-0123456789abcdef0123456789abcdef",
      });
    },
  });
  const firstResponse = await handleVerifyBenefitCompany(request(), first.deps);
  assert.equal(firstResponse.status, 202);
  assert.equal(firstResponse.headers.get("cache-control"), "no-store");
  assert.equal(firstResponse.headers.get("x-content-type-options"), "nosniff");
  const firstBody = await body(firstResponse);
  assert.deepEqual(firstBody, {
    code: "verification_indeterminate",
    requestId: REQUEST_ID,
    message:
      "처리 결과를 확인할 수 없습니다. 같은 멱등성 키로 다시 시도해 주세요.",
  });
  assert.equal(finalizeInvocations.length, 1);
  assert.equal(finalizeAborted, true);
  assertNoSensitive(firstBody);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(committed, true);

  const replay = dependencies({
    reserve: async () =>
      reserveResult({
        status: "approved",
        verification_status: "matched",
        revision: 2,
        resolved_company_id: "KR-CAN-0123456789abcdef0123456789abcdef",
      }),
  });
  const replayResponse = await handleVerifyBenefitCompany(
    request(),
    replay.deps,
  );
  assert.equal(replayResponse.status, 200);
  assert.equal(replay.events.fetch.length, 0);
  assert.equal(replay.events.finalize.length, 0);
});

Deno.test("failure persistence timeout is safe indeterminate 503", async () => {
  let callback: (() => void) | undefined;
  const failInvocations: unknown[] = [];
  const { deps } = dependencies({
    fetch: async () => ntsResponse(validateEnvelope("02")),
    setTimeout: (fn) => {
      callback = fn;
      return 19 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => {},
    fail: async (args) => {
      failInvocations.push(args);
      queueMicrotask(() => callback?.());
      await new Promise(() => {});
    },
  });
  const response = await handleVerifyBenefitCompany(request(), deps);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(failInvocations.length, 1);
  assert.deepEqual(await body(response), {
    code: "verification_indeterminate",
    requestId: REQUEST_ID,
    message:
      "처리 결과를 확인할 수 없습니다. 같은 멱등성 키로 다시 시도해 주세요.",
  });
});

Deno.test("success finalizes with digest and safe fields only", async () => {
  const { deps, events } = dependencies();
  const response = await handleVerifyBenefitCompany(request(), deps);
  assert.equal(response.status, 200);
  const responseBody = await body(response);
  assert.deepEqual(responseBody, {
    requestId: REQUEST_ID,
    status: "approved",
    verificationStatus: "matched",
    message: "사업자 확인이 완료되었습니다.",
  });
  assert.equal(events.finalize.length, 1);
  assert.equal(events.authSignals.length, 1);
  assert.equal(events.reserveSignals.length, 1);
  assert.ok(events.authSignals[0] instanceof AbortSignal);
  assert.ok(events.reserveSignals[0] instanceof AbortSignal);
  assert.notEqual(events.authSignals[0], events.reserveSignals[0]);
  assert.equal(events.finalizeSignals.length, 1);
  assert.ok(events.finalizeSignals[0] instanceof AbortSignal);
  assert.notEqual(events.finalizeSignals[0], events.fetch[0].init.signal);
  assert.notEqual(events.finalizeSignals[0], events.fetch[1].init.signal);
  const final = events.finalize[0] as Record<string, unknown>;
  assert.equal(final.requestId, REQUEST_ID);
  assert.equal(final.expectedVerificationStatus, "pending");
  assert.equal(final.businessNumberDigest, EXPECTED_DIGEST);
  assert.equal(typeof final.payloadFingerprint, "string");
  assert.equal(final.externalVerifiedAt, "2026-11-23T00:00:01.000Z");
  assertNoSensitive(final);
  assertNoIdentityOutput(responseBody);
});

Deno.test("finalize duplicate digest conflict returns a safe replay result", async () => {
  const { deps, events } = dependencies({
    finalize: async () =>
      reserveResult({
        verification_method: "nts_full",
        verification_status: "matched",
        status: "merged",
        revision: 2,
        resolved_company_id: "KR-CAN-0123456789abcdef0123456789abcdef",
      }),
  });
  const response = await handleVerifyBenefitCompany(request(), deps);
  assert.equal(response.status, 200);
  assert.equal((await body(response)).status, "merged");
  assert.equal(events.fail.length, 0);
});

Deno.test("repeated pending idempotency key still performs one reserved verification per request", async () => {
  const first = dependencies();
  const second = dependencies();
  assert.equal(
    (await handleVerifyBenefitCompany(request(), first.deps)).status,
    200,
  );
  assert.equal(
    (await handleVerifyBenefitCompany(request(), second.deps)).status,
    200,
  );
  assert.deepEqual(
    [first.events.reserve.length, second.events.reserve.length],
    [1, 1],
  );
});

Deno.test("failure RPC failure remains generic and all outputs and logs stay free of sensitive sentinels", async () => {
  const { deps, events } = dependencies({
    fetch: async () => {
      throw new Error(`leak ${REPRESENTATIVE}`);
    },
    fail: async () => {
      throw new Error(`leak ${BUSINESS_NUMBER}`);
    },
  });
  const response = await handleVerifyBenefitCompany(request(), deps);
  assert.equal(response.status, 503);
  assert.deepEqual(await body(response), {
    code: "verification_indeterminate",
    requestId: REQUEST_ID,
    message:
      "처리 결과를 확인할 수 없습니다. 같은 멱등성 키로 다시 시도해 주세요.",
  });
  assertNoIdentityOutput(events.logs);
  assertNoSensitive(events.auth);
  assertNoSensitive(events.reserve);
  assertNoSensitive(events.fail);
  assertNoSensitive(events.finalize);
  const log = events.logs[0] as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(log).sort(),
    ["durationBucket", "requestId", "result", "statusCategory"].sort(),
  );
  assert.equal(log.requestId, "edge-request-id");
});

Deno.test("all response classes are no-store and nosniff with CORS only for an allowed origin", async () => {
  const { deps } = dependencies();
  const responses = [
    await handleVerifyBenefitCompany(request(), deps),
    await handleVerifyBenefitCompany(
      request(BODY, { authorization: null }),
      deps,
    ),
    await handleVerifyBenefitCompany(
      request(BODY, { origin: "https://evil.example" }),
      deps,
    ),
    await handleVerifyBenefitCompany(
      new Request("https://edge.test", {
        method: "OPTIONS",
        headers: {
          origin: ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": CORS_HEADERS_FOR_TEST,
        },
      }),
      deps,
    ),
  ];
  for (const response of responses) {
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
  assert.equal(responses[2].headers.get("access-control-allow-origin"), null);
  assert.equal(responses[0].headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(responses[1].headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(responses[3].headers.get("access-control-allow-origin"), ORIGIN);
});

const CORS_HEADERS_FOR_TEST = "authorization, content-type, idempotency-key";

function runtimeUser() {
  const timestamp = "2026-11-23T00:00:00.000Z";
  return {
    id: "323e4567-e89b-42d3-a456-426614174000",
    last_sign_in_at: timestamp,
    app_metadata: { provider: "google", providers: ["google"] },
    identities: [{
      id: "identity-id",
      user_id: "323e4567-e89b-42d3-a456-426614174000",
      identity_data: {},
      provider: "google",
      last_sign_in_at: timestamp,
      created_at: timestamp,
      updated_at: timestamp,
    }],
  };
}

Deno.test("runtime Auth and reserve adapters use exact fixed fetch contracts and immutable signals", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = async (
    input: string | URL | Request,
    init: RequestInit = {},
  ) => {
    calls.push({ url: String(input), init });
    const value = calls.length === 1 ? runtimeUser() : reserveResult();
    return ntsResponse(value);
  };
  const runtime = createRuntimeDependencies(
    (name) => ENV[name as keyof typeof ENV],
    fetcher,
  );
  const authSignal = new AbortController().signal;
  const reserveSignal = new AbortController().signal;
  assert.deepEqual(
    await runtime.authenticate("Bearer runtime-token", authSignal),
    {
      id: "323e4567-e89b-42d3-a456-426614174000",
      currentGoogleIdentity: true,
    },
  );
  assert.deepEqual(
    await runtime.reserve("Bearer runtime-token", KEY, {
      proposedName: BUSINESS_NAME,
      region: "서울",
      industry: "소프트웨어",
      website: "https://example.com",
    }, reserveSignal),
    reserveResult(),
  );
  assert.equal(calls[0].url, `${ENV.SUPABASE_URL}/auth/v1/user`);
  assert.deepEqual(calls[0].init, {
    method: "GET",
    redirect: "error",
    headers: {
      apikey: ENV.SUPABASE_ANON_KEY,
      Authorization: "Bearer runtime-token",
    },
    signal: authSignal,
  });
  assert.equal(
    calls[1].url,
    `${ENV.SUPABASE_URL}/rest/v1/rpc/reserve_benefit_company_nts_request_v1`,
  );
  assert.deepEqual(calls[1].init, {
    method: "POST",
    redirect: "error",
    headers: {
      apikey: ENV.SUPABASE_ANON_KEY,
      Authorization: "Bearer runtime-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      p_client_key: KEY,
      p_proposed_name: BUSINESS_NAME,
      p_region: "서울",
      p_industry: "소프트웨어",
      p_website: "https://example.com",
    }),
    signal: reserveSignal,
  });
  assert.notEqual(authSignal, reserveSignal);
});

Deno.test("runtime adapters decode realistic errors and reject aborts and unsafe JSON responses", async () => {
  const postgrestError = {
    code: "PT429",
    details: null,
    hint: null,
    message: "rate limit exceeded",
  };
  const errorRuntime = createRuntimeDependencies(
    (name) => ENV[name as keyof typeof ENV],
    async () => ntsResponse(postgrestError, { status: 429 }),
  );
  await assert.rejects(
    () =>
      errorRuntime.reserve("Bearer runtime-token", KEY, {
        proposedName: BUSINESS_NAME,
        region: null,
        industry: null,
        website: null,
      }, new AbortController().signal),
    (error) => (error as { code?: string }).code === "PT429",
  );

  const authErrorRuntime = createRuntimeDependencies(
    (name) => ENV[name as keyof typeof ENV],
    async () =>
      ntsResponse({
        code: "bad_jwt",
        message: "invalid JWT",
      }, { status: 401 }),
  );
  await assert.rejects(() =>
    authErrorRuntime.authenticate(
      "Bearer runtime-token",
      new AbortController().signal,
    )
  );

  for (const operation of ["authenticate", "reserve"] as const) {
    let observedSignal: AbortSignal | undefined;
    const abortRuntime = createRuntimeDependencies(
      (name) => ENV[name as keyof typeof ENV],
      async (_input, init) => {
        observedSignal = init?.signal ?? undefined;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          }, { once: true });
        });
      },
    );
    const controller = new AbortController();
    const pending = operation === "authenticate"
      ? abortRuntime.authenticate("Bearer runtime-token", controller.signal)
      : abortRuntime.reserve("Bearer runtime-token", KEY, {
        proposedName: BUSINESS_NAME,
        region: null,
        industry: null,
        website: null,
      }, controller.signal);
    controller.abort();
    await assert.rejects(() => pending, DOMException);
    assert.equal(observedSignal, controller.signal);
  }

  const unsafe = [
    new Response("{}", { headers: { "content-type": "text/html" } }),
    new Response("{".repeat(65_537), {
      headers: { "content-type": "application/json" },
    }),
    new Response("{", { headers: { "content-type": "application/json" } }),
  ];
  for (const response of unsafe) {
    const runtime = createRuntimeDependencies(
      (name) => ENV[name as keyof typeof ENV],
      async () => response,
    );
    await assert.rejects(() =>
      runtime.authenticate(
        "Bearer runtime-token",
        new AbortController().signal,
      )
    );
  }
});

Deno.test("runtime finalize and fail transports use bounded JSON instead of Response.json", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const runtime = createRuntimeDependencies(
    (name) => ENV[name as keyof typeof ENV],
    async (input, init = {}) => {
      calls.push({ url: String(input), init });
      return ntsResponse(reserveResult({
        verification_method: "nts_full",
        verification_status: calls.length === 1 ? "matched" : "unavailable",
        status: calls.length === 1 ? "approved" : "rejected",
        revision: 2,
        resolved_company_id: calls.length === 1
          ? "KR-CAN-0123456789abcdef0123456789abcdef"
          : null,
      }));
    },
  );
  const firstSignal = new AbortController().signal;
  const secondSignal = new AbortController().signal;
  await runtime.finalize({
    requestId: REQUEST_ID,
    expectedVerificationStatus: "pending",
    payloadFingerprint: "a".repeat(64),
    businessNumberDigest: "b".repeat(64),
    externalVerifiedAt: "2026-11-23T00:00:01.000Z",
  }, firstSignal);
  await runtime.fail({
    requestId: REQUEST_ID,
    expectedVerificationStatus: "pending",
    payloadFingerprint: "a".repeat(64),
    category: "unavailable",
  }, secondSignal);
  assert.deepEqual(calls.map((call) => call.url), [
    `${ENV.SUPABASE_URL}/rest/v1/rpc/finalize_benefit_company_nts_request_v1`,
    `${ENV.SUPABASE_URL}/rest/v1/rpc/fail_benefit_company_nts_request_v1`,
  ]);
  assert.equal(calls[0].init.signal, firstSignal);
  assert.equal(calls[1].init.signal, secondSignal);

  const malformed = createRuntimeDependencies(
    (name) => ENV[name as keyof typeof ENV],
    async () =>
      new Response("{", {
        headers: { "content-type": "application/json" },
      }),
  );
  await assert.rejects(() =>
    malformed.finalize({
      requestId: REQUEST_ID,
      expectedVerificationStatus: "pending",
      payloadFingerprint: "a".repeat(64),
      businessNumberDigest: "b".repeat(64),
      externalVerifiedAt: "2026-11-23T00:00:01.000Z",
    }, new AbortController().signal)
  );
});
