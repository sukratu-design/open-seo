import { gzipSync } from "node:zlib";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/lib/runtime-env", () => ({
  // AUTH_MODE unset: the deployment holds the DataForSEO key.
  getOptionalEnvValue: vi.fn(async () => undefined),
  getRequiredEnvValue: vi.fn(async () => "encoded-credentials"),
}));

import { getOptionalEnvValue } from "@/server/lib/runtime-env";
import {
  dataforseoGet,
  dataforseoPostResponse,
  dataforseoPost,
} from "@/server/lib/dataforseo/core";

beforeEach(() => {
  vi.mocked(getOptionalEnvValue).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DataForSEO transport", () => {
  it("retries a transient 5xx on idempotent reads and returns the parsed envelope", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("upstream failure", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status_code: 20000, tasks: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      dataforseoPost("/v3/backlinks/summary/live", []),
    ).resolves.toEqual({ status_code: 20000, tasks: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.dataforseo.com/v3/backlinks/summary/live");
    expect(new Headers(init?.headers).get("Authorization")).toBe(
      "Basic encoded-credentials",
    );
    expect(new Headers(init?.headers).get("Accept-Encoding")).toBe("gzip");
  });

  // The Docker edition's runtime hands the body over still gzipped because we
  // set Accept-Encoding ourselves; parsing it raw failed every call.
  it("inflates a body the runtime left gzipped", async () => {
    const envelope = { status_code: 20000, tasks: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(gzipSync(JSON.stringify(envelope)), {
          headers: { "Content-Encoding": "gzip" },
        }),
      ),
    );

    await expect(
      dataforseoPost("/v3/backlinks/summary/live", []),
    ).resolves.toEqual(envelope);
  });

  // An unverified account answers with HTTP 403 (status_code 40104). Left as
  // INTERNAL_ERROR it reached self-hosters as "an unexpected error occurred".
  it("maps a 403 to DATAFORSEO_AUTH_FAILED", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ status_code: 40104 }, { status: 403 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      dataforseoPost("/v3/backlinks/summary/live", []),
    ).rejects.toMatchObject({ code: "DATAFORSEO_AUTH_FAILED" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  // The request-deadline abort arrives as a bare DOMException. Left unclassified
  // it escapes as an anonymous INTERNAL_ERROR; retrying it would replay a call
  // DataForSEO may already have billed. Both names are reachable: the shared
  // budget aborts with TimeoutError, Lighthouse's own controller with AbortError.
  it.each(["TimeoutError", "AbortError"])(
    "maps a %s abort to UPSTREAM_UNAVAILABLE without retrying",
    async (name) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new DOMException("aborted", name));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        dataforseoPost("/v3/serp/google/organic/live/advanced", []),
      ).rejects.toMatchObject({
        code: "UPSTREAM_UNAVAILABLE",
        name: "DataForSEOTimeoutError",
      });
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  // Seen in production: headers arrive in time, then the deadline aborts
  // while the body is still streaming in.
  it("maps a timeout while reading the body to UPSTREAM_UNAVAILABLE", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new DOMException("aborted", "TimeoutError"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(new Response(body)),
    );

    await expect(
      dataforseoPost("/v3/dataforseo_labs/google/ranked_keywords/live", []),
    ).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
      name: "DataForSEOTimeoutError",
    });
  });
});

describe("Treg transport", () => {
  beforeEach(() => {
    vi.mocked(getOptionalEnvValue).mockImplementation(async (name) =>
      name === "TREG_API_KEY" ? "test-treg-key" : undefined,
    );
  });

  it("preserves tasks and envelopes and reuses an idempotency key on retries", async () => {
    const envelope = { status_code: 20000, tasks: [] };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(Response.json(envelope));
    vi.stubGlobal("fetch", fetchMock);
    const tasks = [{ target: "example.com" }];
    await expect(
      dataforseoPost("/v3/backlinks/referring_domains/live", tasks),
    ).resolves.toEqual(envelope);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const keys = fetchMock.mock.calls.map(([url, init]) => {
      expect(url).toBe(
        "https://treg.to/call/dataforseo/backlinks/referring_domains/live",
      );
      expect(init?.body).toBe(JSON.stringify(tasks));
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Treg-Token")).toBe("test-treg-key");
      expect(headers.has("Authorization")).toBe(false);
      expect(headers.get("Idempotency-Key")).toBeTruthy();
      return headers.get("Idempotency-Key");
    });
    expect(keys[0]).toBe(keys[1]);
  });

  it.each([
    [402, "PAYMENT_REQUIRED", "Treg prepaid balance"],
    [401, "AUTH_CONFIG_MISSING", "Treg authentication"],
    [403, "DATAFORSEO_AUTH_FAILED", "Treg proxy"],
    [429, "RATE_LIMITED", "Treg proxy"],
    [503, "UPSTREAM_UNAVAILABLE", "Treg proxy"],
  ])("classifies a Treg %s refusal", async (status, code, message) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response("refused", { status, headers: { "X-Treg-Error": "1" } }),
        ),
    );
    await expect(
      dataforseoPost("/v3/backlinks/summary/live", [], {
        maxServerErrorRetries: 0,
      }),
    ).rejects.toMatchObject({
      code,
      message: expect.stringContaining(message),
    });
  });

  it.each([dataforseoGet, dataforseoPostResponse])(
    "routes the other request entry points through Treg",
    async (request) => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ tasks: [] }));
      vi.stubGlobal("fetch", fetchMock);
      if (request === dataforseoGet)
        await dataforseoGet("/v3/appendix/locations");
      else await dataforseoPostResponse("/v3/on_page/lighthouse/live/json", []);
      expect(fetchMock.mock.calls[0][0]).toMatch(
        /^https:\/\/treg.to\/call\/dataforseo\//,
      );
    },
  );

  it("keeps explicit sandbox requests on the sandbox host", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ tasks: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await dataforseoPost("/v3/serp/google/organic/live/advanced", [], {
      baseUrl: "https://sandbox.dataforseo.com",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://sandbox.dataforseo.com/v3/serp/google/organic/live/advanced",
    );
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).has("X-Treg-Token"),
    ).toBe(false);
  });
});
