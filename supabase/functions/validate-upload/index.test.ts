import assert from "node:assert/strict";
import {
  handleUpload,
  MAX_MULTIPART_BYTES,
  MAX_UPLOAD_BYTES,
  type UploadDependencies,
  validateFileSize,
  validateImageUpload,
} from "./index.ts";

const IDEMPOTENCY_KEY = "abcdef01-0000-4000-8000-000000000001";
const RESERVATION_ID = "abcdef02-0000-4000-8000-000000000001";
const PNG_SHA256 =
  "5331b957ef1f272fa51d16e8d6d844a4db5767975fb2ce987544594b2d96744f";
const VALID_IMAGES = {
  "image/jpeg":
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z",
  "image/png":
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAk+Uzr4AAAAASUVORK5CYII=",
  "image/webp":
    "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=",
} as const;

function bytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
}

async function multipartRequest(
  fileBytes: Uint8Array,
  mime: string,
  origin = "https://www.breadlab.ai",
  idempotencyKey: string | null = IDEMPOTENCY_KEY,
): Promise<Request> {
  const form = new FormData();
  form.set(
    "file",
    new File([fileBytes.slice().buffer], "ignored-name", { type: mime }),
  );
  const encoded = new Request("http://edge.test", {
    method: "POST",
    body: form,
  });
  const body = await encoded.arrayBuffer();
  const headers: Record<string, string> = {
    authorization: "Bearer user-token",
    "content-type": encoded.headers.get("content-type")!,
    "content-length": String(body.byteLength),
    origin,
  };
  if (idempotencyKey !== null) headers["x-idempotency-key"] = idempotencyKey;
  return new Request("http://edge.test", { method: "POST", body, headers });
}

function dependencies(
  events: string[] = [],
  uploadAllowedOrigins?: string,
): UploadDependencies {
  return {
    env: (name) =>
      name === "UPLOAD_ALLOWED_ORIGINS" ? uploadAllowedOrigins : undefined,
    authenticate: async () => ({ id: "b1000000-0000-0000-0000-000000000001" }),
    reserveUpload: async (_authorization, key) => {
      events.push(`reserve:${key}`);
      return RESERVATION_ID;
    },
    refundReplay: async (
      _authorization,
      reservationId,
      key,
      hash,
      metadata,
    ) => {
      events.push(
        `refund:${reservationId}:${key}:${hash}:${metadata.mimeType}:${metadata.byteSize}`,
      );
      return true;
    },
    createIntent: async (_authorization, key, hash, metadata) => {
      events.push(
        `intent:${key}:${hash}:${metadata.mimeType}:${metadata.byteSize}`,
      );
      return {
        id: "a1000000-0000-4000-8000-000000000001",
        storagePath:
          "b1000000-0000-0000-0000-000000000001/01000000-0000-4000-8000-000000000001",
        objectExists: false,
      };
    },
    upload: async (path, _bytes, _mime, hash) =>
      events.push(`upload:${path}:${hash}`),
    objectMatches: async () => false,
    markUploadFailed: async (_authorization, id, path) =>
      events.push(`failed:${id}:${path}`),
    log: () => undefined,
  };
}

Deno.test("fully decodes genuine tiny JPEG, PNG, and WebP images", async () => {
  for (const [mime, encoded] of Object.entries(VALID_IMAGES)) {
    const original = bytes(encoded);
    const validated = await validateImageUpload(original, mime);
    assert.equal(validated.mimeType, mime);
    assert.equal(validated.byteSize, original.byteLength);
    assert.equal(validated.width, 2);
    assert.equal(validated.height, 2);
  }
});

Deno.test("rejects truncated, header-only, and arbitrary binary images", async () => {
  const invalid = [
    [bytes(VALID_IMAGES["image/jpeg"]).subarray(0, 100), "image/jpeg"],
    [bytes(VALID_IMAGES["image/png"]).subarray(0, 24), "image/png"],
    [bytes(VALID_IMAGES["image/webp"]).subarray(0, 30), "image/webp"],
    [new Uint8Array([0xff, 0xd8, 0xff, 0, 1, 2, 3]), "image/jpeg"],
  ] as const;
  for (const [data, mime] of invalid) {
    await assert.rejects(() => validateImageUpload(data, mime), {
      code: "invalid_image",
    });
  }
});

Deno.test("rejects scriptable payload markers anywhere after 4 KiB", async () => {
  const marker = new TextEncoder().encode("<script>alert(1)</script>");
  const original = bytes(VALID_IMAGES["image/jpeg"]);
  const polyglot = new Uint8Array(5000 + marker.byteLength);
  polyglot.set(original);
  polyglot.set(marker, 5000);
  await assert.rejects(() => validateImageUpload(polyglot, "image/jpeg"), {
    code: "scriptable_content",
  });
});

Deno.test("rejects unsafe image dimensions before decode", async () => {
  for (const [width, height] of [[100_000, 100_000], [4000, 4000], [4097, 1]]) {
    const png = bytes(VALID_IMAGES["image/png"]);
    const bombHeader = png.slice();
    new DataView(bombHeader.buffer).setUint32(16, width);
    new DataView(bombHeader.buffer).setUint32(20, height);
    await assert.rejects(() => validateImageUpload(bombHeader, "image/png"), {
      code: "invalid_dimensions",
    });
  }
});

Deno.test("rejects SVG, HTML, MIME mismatch, and exactly 5 MiB plus one byte", async () => {
  for (const text of ["<svg></svg>", "<!doctype html><html></html>"]) {
    await assert.rejects(
      () => validateImageUpload(new TextEncoder().encode(text), "image/png"),
      { code: "unsupported_signature" },
    );
  }
  await assert.rejects(
    () => validateImageUpload(bytes(VALID_IMAGES["image/png"]), "image/jpeg"),
    { code: "mime_mismatch" },
  );
  assert.throws(() => validateFileSize(MAX_UPLOAD_BYTES + 1), {
    code: "invalid_size",
  });
});

Deno.test("strict CORS preflight reflects only a configured origin and key header", async () => {
  const configured = dependencies([], "https://preview.breadlab.ai");
  const allowed = await handleUpload(
    new Request("http://edge.test", {
      method: "OPTIONS",
      headers: {
        origin: "https://preview.breadlab.ai",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "authorization, content-type, apikey, x-client-info, x-idempotency-key",
      },
    }),
    configured,
  );
  assert.equal(allowed.status, 204);
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "https://preview.breadlab.ai",
  );
  const allowHeaders = allowed.headers.get("access-control-allow-headers") ??
    "";
  assert.match(allowHeaders, /authorization/i);
  assert.match(allowHeaders, /apikey/i);
  assert.match(allowHeaders, /x-idempotency-key/i);
  assert.equal(allowed.headers.get("vary"), "Origin");

  const denied = await handleUpload(
    new Request("http://edge.test", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example" },
    }),
    configured,
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);

  for (const requestedMethod of [null, "GET"]) {
    const headers = new Headers({ origin: "https://preview.breadlab.ai" });
    if (requestedMethod) {
      headers.set("access-control-request-method", requestedMethod);
    }
    const invalidMethod = await handleUpload(
      new Request("http://edge.test", { method: "OPTIONS", headers }),
      configured,
    );
    assert.equal(invalidMethod.status, 403);
    assert.equal(
      invalidMethod.headers.get("access-control-allow-origin"),
      null,
    );
  }
});

Deno.test("defaults CORS to production origins only", async () => {
  for (const origin of ["https://breadlab.ai", "https://www.breadlab.ai"]) {
    const production = await handleUpload(
      new Request("http://edge.test", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
        },
      }),
      dependencies(),
    );
    assert.equal(production.status, 204, origin);
    assert.equal(production.headers.get("access-control-allow-origin"), origin);
  }

  for (
    const origin of [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://[::1]:4173",
      "http://localhost:9999",
      "https://breadlab.ai.evil.example",
    ]
  ) {
    const denied = await handleUpload(
      new Request("http://edge.test", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
        },
      }),
      dependencies(),
    );
    assert.equal(denied.status, 403, origin);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  }
});

Deno.test("configured CORS origins replace production defaults exactly", async () => {
  const configured = dependencies(
    [],
    "http://localhost:5173, https://staging.breadlab.ai",
  );
  const local = await handleUpload(
    new Request("http://edge.test", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
      },
    }),
    configured,
  );
  assert.equal(local.status, 204);
  assert.equal(
    local.headers.get("access-control-allow-origin"),
    "http://localhost:5173",
  );

  for (
    const origin of [
      "http://localhost:5174",
      "https://breadlab.ai",
      "https://staging.breadlab.ai.evil.example",
    ]
  ) {
    const denied = await handleUpload(
      new Request("http://edge.test", {
        method: "OPTIONS",
        headers: {
          origin,
          "access-control-request-method": "POST",
        },
      }),
      configured,
    );
    assert.equal(denied.status, 403, origin);
    assert.equal(denied.headers.get("access-control-allow-origin"), null);
  }
});

Deno.test("advertises POST for an allowed origin", async () => {
  const method = await handleUpload(
    new Request("http://edge.test", {
      method: "GET",
      headers: { origin: "https://breadlab.ai" },
    }),
    dependencies(),
  );
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "POST");
});

Deno.test("rejects invalid Content-Length before body parsing", async () => {
  for (const value of [null, "nope", "0", String(MAX_MULTIPART_BYTES + 1)]) {
    let parsed = false;
    const headers: Record<string, string> = {
      origin: "https://breadlab.ai",
      authorization: "Bearer user-token",
      "content-type": "multipart/form-data; boundary=x",
      "x-idempotency-key": IDEMPOTENCY_KEY,
    };
    if (value !== null) headers["content-length"] = value;
    const request = new Request("http://edge.test", {
      method: "POST",
      headers,
    });
    Object.defineProperty(request, "formData", {
      value: () => {
        parsed = true;
        throw new Error("body was parsed");
      },
    });
    const response = await handleUpload(request, dependencies());
    assert.equal(response.status, 413);
    assert.equal(parsed, false);
  }
  assert.equal(MAX_MULTIPART_BYTES > MAX_UPLOAD_BYTES, true);
});

Deno.test("requires a canonical client idempotency key before body parsing", async () => {
  for (const key of [null, "NOT-A-UUID", IDEMPOTENCY_KEY.toUpperCase()]) {
    let parsed = false;
    const request = await multipartRequest(
      bytes(VALID_IMAGES["image/png"]),
      "image/png",
      undefined,
      key,
    );
    Object.defineProperty(request, "formData", {
      value: () => {
        parsed = true;
        throw new Error("must not parse");
      },
    });
    const response = await handleUpload(request, dependencies());
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_idempotency_key");
    assert.equal(parsed, false);
  }
});

Deno.test("reserves before parsing and maps rate rejection to 429", async () => {
  let parsed = false;
  const deps = dependencies();
  deps.reserveUpload = async () => {
    throw { status: 429, message: "rate limit exceeded" };
  };
  const request = await multipartRequest(
    bytes(VALID_IMAGES["image/png"]),
    "image/png",
  );
  Object.defineProperty(request, "formData", {
    value: () => {
      parsed = true;
      throw new Error("must not parse");
    },
  });
  const response = await handleUpload(request, deps);
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error, "rate_limit_exceeded");
  assert.equal(parsed, false);
});

Deno.test("hashes validated bytes, creates intent, and uploads returned path", async () => {
  const events: string[] = [];
  const response = await handleUpload(
    await multipartRequest(bytes(VALID_IMAGES["image/png"]), "image/png"),
    dependencies(events),
  );
  assert.equal(response.status, 201);
  assert.equal(events[0], `reserve:${IDEMPOTENCY_KEY}`);
  assert.equal(
    events[1],
    `intent:${IDEMPOTENCY_KEY}:${PNG_SHA256}:image/png:77`,
  );
  assert.equal(
    events[2],
    `upload:b1000000-0000-0000-0000-000000000001/01000000-0000-4000-8000-000000000001:${PNG_SHA256}`,
  );
  const body = await response.json();
  assert.equal(body.attachmentId, "a1000000-0000-4000-8000-000000000001");
});

Deno.test("same-key replay skips Storage upload", async () => {
  const events: string[] = [];
  const deps = dependencies(events);
  deps.createIntent = async (_authorization, key, hash, metadata) => {
    events.push(`intent:${key}:${hash}:${metadata.byteSize}`);
    return {
      id: "a1000000-0000-4000-8000-000000000001",
      storagePath:
        "b1000000-0000-0000-0000-000000000001/01000000-0000-4000-8000-000000000001",
      objectExists: true,
    };
  };
  const response = await handleUpload(
    await multipartRequest(bytes(VALID_IMAGES["image/png"]), "image/png"),
    deps,
  );
  assert.equal(response.status, 200);
  assert.equal(events.some((event) => event.startsWith("upload:")), false);
  assert.equal(
    events.some((event) =>
      event ===
        `refund:${RESERVATION_ID}:${IDEMPOTENCY_KEY}:${PNG_SHA256}:image/png:77`
    ),
    true,
  );
});

Deno.test("malformed reuse of a successful key stays precharged", async () => {
  const events: string[] = [];
  const response = await handleUpload(
    await multipartRequest(new Uint8Array([1, 2, 3]), "image/png"),
    dependencies(events),
  );

  assert.equal(response.status, 400);
  assert.equal(
    events.filter((event) => event.startsWith("reserve:")).length,
    1,
  );
  assert.equal(events.some((event) => event.startsWith("refund:")), false);
});

Deno.test("concurrent duplicate match succeeds without quarantine", async () => {
  const events: string[] = [];
  const deps = dependencies(events);
  deps.upload = async () => {
    events.push("upload");
    throw new Error("already exists");
  };
  deps.objectMatches = async (path, mime, size, hash) => {
    events.push(`match:${path}:${mime}:${size}:${hash}`);
    return true;
  };
  const response = await handleUpload(
    await multipartRequest(bytes(VALID_IMAGES["image/png"]), "image/png"),
    deps,
  );
  assert.equal(response.status, 201);
  assert.equal(events.some((event) => event.startsWith("match:")), true);
  assert.equal(events.some((event) => event.startsWith("failed:")), false);
  assert.equal(events.some((event) => event.startsWith("refund:")), true);
});

Deno.test("maps intent quota and transient RPC failures distinctly", async () => {
  for (
    const [status, expected] of [[409, 409], [422, 422], [503, 502]] as const
  ) {
    const deps = dependencies();
    deps.createIntent = async () => {
      throw { status, message: "rpc rejected" };
    };
    const response = await handleUpload(
      await multipartRequest(bytes(VALID_IMAGES["image/png"]), "image/png"),
      deps,
    );
    assert.equal(response.status, expected);
  }
});

Deno.test("maps payload-key mismatch SQLSTATE to a stable conflict", async () => {
  const deps = dependencies();
  deps.createIntent = async () => {
    throw {
      code: "22023",
      message: "client key reused with different payload metadata",
    };
  };

  const response = await handleUpload(
    await multipartRequest(bytes(VALID_IMAGES["image/png"]), "image/png"),
    deps,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "upload_intent_conflict" });
});

Deno.test("maps pre-existing Storage path SQLSTATE to a stable conflict", async () => {
  const deps = dependencies();
  deps.createIntent = async () => {
    throw { code: "23505", message: "storage path already exists" };
  };

  const response = await handleUpload(
    await multipartRequest(bytes(VALID_IMAGES["image/png"]), "image/png"),
    deps,
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: "upload_intent_conflict" });
});

Deno.test("mismatched or unavailable duplicate object quarantines intent", async () => {
  const events: string[] = [];
  const deps = dependencies(events);
  deps.upload = async (path) => {
    events.push(`upload:${path}`);
    throw new Error("storage unavailable");
  };
  deps.objectMatches = async (path) => {
    events.push(`match:${path}`);
    return false;
  };
  const response = await handleUpload(
    await multipartRequest(bytes(VALID_IMAGES["image/png"]), "image/png"),
    deps,
  );
  assert.equal(response.status, 502);
  assert.deepEqual(events.map((event) => event.split(":")[0]), [
    "reserve",
    "intent",
    "upload",
    "match",
    "failed",
  ]);
});
