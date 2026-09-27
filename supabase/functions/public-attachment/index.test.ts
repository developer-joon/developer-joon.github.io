import assert from "node:assert/strict";
import {
  type AttachmentRecord,
  handlePublicAttachment,
  MAX_ATTACHMENT_BYTES,
  type PublicAttachmentDependencies,
} from "./index.ts";

const ATTACHMENT_ID = "a1000000-0000-4000-8000-000000000001";
const OWNER_ID = "b1000000-0000-4000-8000-000000000001";
const OBJECT_TOKEN = "c1000000-0000-4000-8000-000000000001";
const STORAGE_PATH = `${OWNER_ID}/${OBJECT_TOKEN}`;
const IMAGE_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function attachment(
  overrides: Partial<AttachmentRecord> = {},
): AttachmentRecord {
  return {
    id: ATTACHMENT_ID,
    ownerId: OWNER_ID,
    objectToken: OBJECT_TOKEN,
    storagePath: STORAGE_PATH,
    mimeType: "image/png",
    byteSize: IMAGE_BYTES.byteLength,
    ...overrides,
  };
}

function dependencies(
  events: string[] = [],
  record: AttachmentRecord | null = attachment(),
): PublicAttachmentDependencies {
  return {
    env: (name) => {
      if (name === "SUPABASE_URL") return "https://project.supabase.co";
      if (name === "SUPABASE_SERVICE_ROLE_KEY") return "service-secret";
      return undefined;
    },
    resolveAttachment: (id) => {
      events.push(`find:${id}`);
      return Promise.resolve(record);
    },
    download: (path) => {
      events.push(`download:${path}`);
      return Promise.resolve(new Blob([IMAGE_BYTES], { type: "image/png" }));
    },
    log: (entry) => events.push(`log:${JSON.stringify(entry)}`),
  };
}

function request(
  method = "GET",
  id = ATTACHMENT_ID,
  origin?: string,
): Request {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new Request(
    `https://project.supabase.co/functions/v1/public-attachment/${id}`,
    { method, headers },
  );
}

Deno.test("streams an eligible private object with bounded image headers", async () => {
  const events: string[] = [];
  const response = await handlePublicAttachment(
    request(),
    dependencies(events),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), IMAGE_BYTES);
  assert.deepEqual(events.slice(0, 2), [
    `find:${ATTACHMENT_ID}`,
    `download:${STORAGE_PATH}`,
  ]);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(
    response.headers.get("content-length"),
    String(IMAGE_BYTES.byteLength),
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "cross-origin",
  );
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=300, s-maxage=300",
  );
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(response.headers.get("vary"), "Origin");
});

Deno.test("rejects non-GET byte methods and advertises GET and OPTIONS", async () => {
  for (const method of ["POST", "HEAD"]) {
    const events: string[] = [];
    const response = await handlePublicAttachment(
      request(method),
      dependencies(events),
    );
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "GET, OPTIONS");
    assert.equal(events.some((event) => event.startsWith("find:")), false);
  }
});

Deno.test("answers allowed-origin OPTIONS without metadata or Storage access", async () => {
  const events: string[] = [];
  const response = await handlePublicAttachment(
    request("OPTIONS", ATTACHMENT_ID, "https://breadlab.ai"),
    dependencies(events),
  );

  assert.equal(response.status, 204);
  assert.equal(response.body, null);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    "https://breadlab.ai",
  );
  assert.equal(response.headers.get("access-control-allow-methods"), "GET");
  assert.equal(response.headers.get("allow"), "GET, OPTIONS");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "cross-origin",
  );
  assert.equal(events.some((event) => event.startsWith("find:")), false);
  assert.equal(events.some((event) => event.startsWith("download:")), false);
});

Deno.test("rejects non-canonical attachment UUIDs before lookup", async () => {
  for (
    const id of [
      "not-a-uuid",
      ATTACHMENT_ID.toUpperCase(),
      `${ATTACHMENT_ID}/extra`,
      "a1000000000040008000000000000001",
    ]
  ) {
    const events: string[] = [];
    const response = await handlePublicAttachment(
      request("GET", id),
      dependencies(events),
    );
    assert.equal(response.status, 400, id);
    assert.deepEqual(await response.json(), { error: "invalid_attachment_id" });
    assert.equal(events.some((event) => event.startsWith("find:")), false);
  }
});

Deno.test("fails closed when required server environment is missing", async () => {
  for (const missing of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const events: string[] = [];
    const deps = dependencies(events);
    const originalEnv = deps.env;
    deps.env = (name) => name === missing ? undefined : originalEnv(name);

    const response = await handlePublicAttachment(request(), deps);
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { error: "server_misconfigured" });
    assert.equal(events.some((event) => event.startsWith("find:")), false);
    assert.equal(body.includes("service-secret"), false);
  }
});

Deno.test("does not access Storage when the database resolver returns no row", async () => {
  const events: string[] = [];
  const response = await handlePublicAttachment(
    request(),
    dependencies(events, null),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.equal(events.some((event) => event.startsWith("download:")), false);
});

Deno.test("rejects unsupported expected MIME before Storage download", async () => {
  const events: string[] = [];
  const response = await handlePublicAttachment(
    request(),
    dependencies(events, attachment({ mimeType: "image/svg+xml" })),
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "attachment_unavailable" });
  assert.equal(events.some((event) => event.startsWith("download:")), false);
});

Deno.test("rejects non-canonical or unrelated Storage paths before download", async () => {
  const invalidRecords: AttachmentRecord[] = [
    attachment({ storagePath: `not-a-uuid/${OBJECT_TOKEN}` }),
    attachment({ storagePath: `${OWNER_ID}/../${OBJECT_TOKEN}` }),
    attachment({ storagePath: `${OWNER_ID}%2F${OBJECT_TOKEN}` }),
    attachment({ storagePath: `${OWNER_ID}/${OBJECT_TOKEN.toUpperCase()}` }),
    attachment({ storagePath: `${OWNER_ID}//${OBJECT_TOKEN}` }),
    attachment({ storagePath: `${OWNER_ID}\\${OBJECT_TOKEN}` }),
    attachment({ storagePath: `${OWNER_ID}/${OBJECT_TOKEN}/extra` }),
    attachment({ storagePath: `${OBJECT_TOKEN}/${OWNER_ID}` }),
    attachment({ ownerId: OBJECT_TOKEN }),
    attachment({ objectToken: OWNER_ID }),
    attachment({ id: "a1000000-0000-4000-8000-000000000002" }),
  ];

  for (const record of invalidRecords) {
    const events: string[] = [];
    const response = await handlePublicAttachment(
      request(),
      dependencies(events, record),
    );
    assert.equal(response.status, 502, JSON.stringify(record));
    assert.deepEqual(await response.json(), {
      error: "attachment_unavailable",
    });
    assert.equal(
      events.some((event) => event.startsWith("download:")),
      false,
      JSON.stringify(record),
    );
  }
});

Deno.test("rejects oversized, wrong-length, and MIME-inconsistent Storage blobs", async () => {
  const cases: Array<[AttachmentRecord, Blob]> = [
    [
      attachment({ byteSize: MAX_ATTACHMENT_BYTES + 1 }),
      new Blob([IMAGE_BYTES], { type: "image/png" }),
    ],
    [
      attachment({ byteSize: IMAGE_BYTES.byteLength + 1 }),
      new Blob([IMAGE_BYTES], { type: "image/png" }),
    ],
    [attachment(), new Blob([IMAGE_BYTES], { type: "image/jpeg" })],
    [attachment(), new Blob([IMAGE_BYTES], { type: "" })],
  ];

  for (const [record, blob] of cases) {
    const deps = dependencies([], record);
    deps.download = () => Promise.resolve(blob);
    const response = await handlePublicAttachment(request(), deps);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: "attachment_unavailable",
    });
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

Deno.test("allows production and explicitly configured CORS origins without credentials", async () => {
  for (
    const origin of [
      "https://breadlab.ai",
      "https://www.breadlab.ai",
      "https://preview.breadlab.ai",
    ]
  ) {
    const deps = dependencies();
    deps.env = (name) => {
      if (name === "SUPABASE_URL") return "https://project.supabase.co";
      if (name === "SUPABASE_SERVICE_ROLE_KEY") return "service-secret";
      if (name === "PUBLIC_ATTACHMENT_ALLOWED_ORIGINS") {
        return "https://preview.breadlab.ai";
      }
      return undefined;
    };
    const response = await handlePublicAttachment(
      request("GET", ATTACHMENT_ID, origin),
      deps,
    );
    assert.equal(response.status, 200, origin);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.equal(
      response.headers.get("access-control-allow-credentials"),
      null,
    );
  }
});

Deno.test("denies unlisted CORS origins without fetching private metadata", async () => {
  const events: string[] = [];
  const response = await handlePublicAttachment(
    request("GET", ATTACHMENT_ID, "https://breadlab.ai.evil.example"),
    dependencies(events),
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "origin_forbidden" });
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(events.some((event) => event.startsWith("find:")), false);
});

Deno.test("redacts service and Storage failures from responses and logs", async () => {
  for (const operation of ["find", "download"] as const) {
    const logs: Record<string, unknown>[] = [];
    const deps = dependencies();
    deps.log = (entry) => logs.push(entry);
    if (operation === "find") {
      deps.resolveAttachment = () => {
        return Promise.reject(new Error(
          `database failed storage_path=${STORAGE_PATH} secret=service-secret`,
        ));
      };
    } else {
      deps.download = () => {
        return Promise.reject(new Error(
          `storage failed storage_path=${STORAGE_PATH} secret=service-secret`,
        ));
      };
    }

    const response = await handlePublicAttachment(request(), deps);
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.equal(body.includes(STORAGE_PATH), false);
    assert.equal(body.includes("service-secret"), false);
    const serializedLogs = JSON.stringify(logs);
    assert.equal(serializedLogs.includes(STORAGE_PATH), false);
    assert.equal(serializedLogs.includes("service-secret"), false);
  }
});
