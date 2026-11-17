import { env } from "cloudflare:workers";
import { gatewayUrl } from "@every-app/sdk/server";
import { z } from "zod";

const envelope = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  error: z.object({ message: z.string() }).optional(),
  result: z
    .object({
      isError: z.boolean().optional(),
      content: z
        .array(z.object({ type: z.string(), text: z.string().optional() }))
        .optional(),
      structuredContent: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough()
    .optional(),
});

class GatewayAdminError extends Error {}

async function callTool(name: string, args: Record<string, string>) {
  const token = env.GATEWAY_ADMIN_TOKEN;
  if (!token) return null;
  const headers = new Headers({
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
  });
  const signal = AbortSignal.timeout(10_000);
  async function send(body: object, id?: number) {
    const response = await fetch(gatewayUrl(env, "/mcp"), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new GatewayAdminError(`HTTP ${response.status}`);
    const session = response.headers.get("mcp-session-id");
    if (session) headers.set("mcp-session-id", session);
    if (id === undefined) {
      await response.body?.cancel();
      return;
    }
    function readResult(message: unknown) {
      const parsed = envelope.parse(message);
      if (parsed.id !== id) return;
      if (parsed.error) throw new GatewayAdminError(parsed.error.message);
      if (!parsed.result) throw new Error("Missing Gateway result");
      if (parsed.result.isError)
        throw new GatewayAdminError(
          parsed.result.content?.map((item) => item.text ?? "").join(" ") ||
            "Gateway tool failed",
        );
      return parsed.result;
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      return readResult(await response.json());
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing Gateway stream");
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() ?? "";
        for (const event of events) {
          const data = event
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          if (!data) continue;
          const result = readResult(JSON.parse(data));
          if (result) return result;
        }
        if (done) break;
      }
    } finally {
      await reader.cancel();
    }
    throw new Error("Missing Gateway response");
  }
  await send(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "openseo", version: "0.1.27" },
      },
    },
    1,
  );
  headers.set("MCP-Protocol-Version", "2025-06-18");
  await send({ jsonrpc: "2.0", method: "notifications/initialized" });
  return send(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    },
    2,
  );
}

export async function inviteGatewayMember(email: string) {
  try {
    const result = await callTool("everyapp_workspace_invite", {
      email,
      role: "member",
    });
    if (!result) return { status: "not_configured" as const };
    let details = result.structuredContent;
    for (const item of result.content ?? []) {
      if (item.text) {
        try {
          details ??= z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(item.text));
        } catch {
          /* Text-only tool output is valid. */
        }
      }
    }
    return {
      status: "invited" as const,
      ...(typeof details?.mailed === "boolean"
        ? { mailed: details.mailed }
        : {}),
    };
  } catch (error) {
    // Log only status/tool messages or a fixed network diagnostic. Never dump
    // an exception, request, response, headers, or credentials into Worker logs.
    const diagnostic =
      error instanceof GatewayAdminError
        ? error.message
            .replaceAll(env.GATEWAY_ADMIN_TOKEN ?? "\0", "[redacted]")
            .replace(
              /(?:authorization|cookie|headers)\s*[:=].*/gi,
              "[redacted]",
            )
            .slice(0, 300)
        : "Couldn't reach the Gateway.";
    console.warn(
      `gateway admin: tools/call everyapp_workspace_invite failed: ${diagnostic}`,
    );
    if (
      error instanceof GatewayAdminError &&
      /already (?:a (?:workspace )?member|invited|a pending|has .*invitation)/i.test(
        error.message,
      )
    )
      return { status: "already" as const };
    try {
      const users = await callTool("everyapp_workspace_users", {});
      const records: unknown[] = [users?.structuredContent];
      for (const item of users?.content ?? []) {
        try {
          records.push(JSON.parse(item.text ?? ""));
        } catch {
          /* Non-JSON output. */
        }
      }
      const containsEmail = (value: unknown): boolean => {
        if (Array.isArray(value)) return value.some(containsEmail);
        if (!value || typeof value !== "object") return false;
        const row = z.record(z.string(), z.unknown()).parse(value);
        return (
          (typeof row.email === "string" &&
            row.email.toLowerCase() === email.toLowerCase()) ||
          Object.values(row).some(containsEmail)
        );
      };
      if (records.some(containsEmail)) return { status: "already" as const };
    } catch {
      /* Preserve the original invite failure. */
    }
    return {
      status: "failed" as const,
      message: /HTTP (401|403)\b/.test(diagnostic)
        ? "The Gateway refused the token (check GATEWAY_ADMIN_TOKEN is Read & write, All apps)."
        : /network|timeout|fetch failed|abort|couldn't reach/i.test(diagnostic)
          ? "Couldn't reach the Gateway."
          : "The Gateway could not send the invitation. Ask your admin to check the invite settings.",
    };
  }
}

export async function uninviteGatewayMember(email: string) {
  try {
    await callTool("everyapp_workspace_uninvite", { email });
  } catch {
    /* Best effort: project access has already been revoked. */
  }
}
