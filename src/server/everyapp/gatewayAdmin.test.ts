import { z } from "zod";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { inviteGatewayMember } from "./gatewayAdmin";
const { workerEnv } = vi.hoisted(() => ({
  workerEnv: {
    GATEWAY_ADMIN_TOKEN: undefined as string | undefined,
    GATEWAY_URL: "https://gateway.example.com",
  },
}));
vi.mock("cloudflare:workers", () => ({ env: workerEnv }));
beforeEach(() => {
  workerEnv.GATEWAY_ADMIN_TOKEN = undefined;
});
afterEach(() => vi.unstubAllGlobals());
it("works without a configured Gateway token", async () => {
  expect(await inviteGatewayMember("client@example.com")).toEqual({
    status: "not_configured",
  });
});
it.each([false, true])(
  "parses SSE tool replies including already invited refusals (%s)",
  async (already) => {
    workerEnv.GATEWAY_ADMIN_TOKEN = "secret";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const body = z
          .object({ method: z.string(), params: z.unknown().optional() })
          .parse(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
        if (body.method === "initialize")
          return Response.json(
            { jsonrpc: "2.0", id: 1, result: {} },
            { headers: { "mcp-session-id": "session" } },
          );
        expect(new Headers(init?.headers).get("mcp-session-id")).toBe(
          "session",
        );
        expect(new Headers(init?.headers).get("MCP-Protocol-Version")).toBe(
          "2025-06-18",
        );
        if (body.method === "notifications/initialized")
          return new Response(null, { status: 202 });
        expect(body.params).toEqual({
          name: "everyapp_workspace_invite",
          arguments: { email: "client@example.com", role: "member" },
        });
        return new Response(
          `data: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { isError: already, content: [{ type: "text", text: already ? "Already invited" : '{"mailed":true}' }] } })}\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        );
      });
    vi.stubGlobal("fetch", fetchMock);
    expect(await inviteGatewayMember("client@example.com")).toEqual(
      already ? { status: "already" } : { status: "invited", mailed: true },
    );
  },
);

it.each(["members", "pendingInvitations"])(
  "recognizes an existing invite from the users list (%s)",
  async (collection) => {
    workerEnv.GATEWAY_ADMIN_TOKEN = "secret";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (_url, init) => {
        const body = z
          .object({
            method: z.string(),
            params: z
              .object({ name: z.string().optional() })
              .passthrough()
              .optional(),
          })
          .parse(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
        if (body.method === "notifications/initialized")
          return new Response(null, { status: 202 });
        if (body.method === "initialize")
          return Response.json({ id: 1, result: {} });
        if (body.params?.name === "everyapp_workspace_invite")
          return Response.json({
            id: 2,
            result: {
              isError: true,
              content: [{ type: "text", text: "Duplicate workspace entry" }],
            },
          });
        expect(body.params).toEqual({
          name: "everyapp_workspace_users",
          arguments: {},
        });
        return Response.json({
          id: 2,
          result: {
            structuredContent: {
              [collection]: [{ email: "CLIENT@example.com" }],
            },
          },
        });
      }),
    );
    expect(await inviteGatewayMember("client@example.com")).toEqual({
      status: "already",
    });
  },
);
