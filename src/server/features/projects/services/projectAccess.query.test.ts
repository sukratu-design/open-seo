import type { EveryAppUser } from "@every-app/sdk/server";
import { sort } from "remeda";
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { ProjectService } from "./ProjectService";
import { resolveEveryAppUserContext } from "@/middleware/ensure-user/everyApp";
import { ProjectMemberService } from "./ProjectMemberService";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { makeToolContext } from "@/server/mcp/tools/tool-test-support";
import {
  createReportMapGrants,
  verifyReportMapGrant,
} from "@/server/features/reports/reportMapGrant";
import { handleReportRequest } from "@/routes/r/$reportId";

const test = vi.hoisted(() => ({
  db: undefined as unknown,
  everyapp: true,
  caller: { organizationId: "org", userId: "client", role: "member" },
}));
vi.mock("@/db", () => ({
  get db() {
    return test.db;
  },
}));
vi.mock("cloudflare:workers", () => ({ env: { AUTH_MODE: "everyapp" } }));
vi.mock("@/server/lib/runtime-env", () => ({
  isEveryAppServerAuthMode: async () => test.everyapp,
  getOptionalEnvValue: async () => "test-map-key",
}));
vi.mock("@/middleware/ensure-user/resolve", () => ({
  resolveUserContextFromHeaders: async () => test.caller,
}));

const client = createClient({ url: "file::memory:" });
const member = test.caller;
const admin = { organizationId: "org", userId: "admin", role: "admin" };
beforeAll(async () => {
  test.db = drizzle(client, { schema });
  for (const file of sort(
    readdirSync("drizzle/sqlite").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  )) {
    await client.executeMultiple(
      readFileSync(`drizzle/sqlite/${file}`, "utf8"),
    );
  }
  await client.executeMultiple(`
    PRAGMA foreign_keys=ON;
    INSERT INTO organization (id, name, slug, created_at) VALUES ('org', 'Workspace', 'workspace', 0), ('other', 'Other', 'other', 0);
    INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('client', 'Client', 'client@example.com', 1, 0, 0), ('admin', 'Admin', 'admin@example.com', 1, 0, 0);
    INSERT INTO projects (id, organization_id, name) VALUES ('allowed', 'org', 'Allowed'), ('hidden', 'org', 'Hidden'), ('foreign', 'other', 'Foreign');
    INSERT INTO projects (id, organization_id, name, archived_at) VALUES ('archived', 'org', 'Archived secret', '2026-01-01');
    INSERT INTO project_members (project_id, user_id) VALUES ('allowed', 'client');
  `);
});
afterAll(() => client.close());

it("lists and loads only a member's assigned projects; no rows stays empty without creating a default", async () => {
  expect(
    (await ProjectService.listProjectsEnsuringOne("org", member)).map(
      (p) => p.id,
    ),
  ).toEqual(["allowed"]);
  expect(
    (await ProjectService.getProjectForOrganization("org", "allowed", member))
      .id,
  ).toBe("allowed");
  for (const id of ["hidden", "foreign"]) {
    await expect(
      ProjectService.getProjectForOrganization("org", id, member),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  expect(
    await ProjectService.listProjectsEnsuringOne("org", {
      userId: "unassigned",
      role: "member",
    }),
  ).toEqual([]);
  // getProjectAccess uses this service lookup; an empty grant set must also deny loads.
  await expect(
    ProjectService.getProjectForOrganization("org", "allowed", {
      userId: "unassigned",
      role: "member",
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const count = await client.execute(
    "SELECT COUNT(*) AS count FROM projects WHERE archived_at IS NULL AND organization_id = 'org'",
  );
  expect(count.rows[0].count).toBe(2);
});

it.each(["owner", "admin"])(
  "%s sees all workspace projects without grants",
  async (role) => {
    expect(
      new Set(
        (
          await ProjectService.listProjects("org", { userId: "admin", role })
        ).map((p) => p.id),
      ),
    ).toEqual(new Set(["allowed", "hidden"]));
    expect(
      (
        await ProjectService.getProjectForOrganization("org", "hidden", {
          userId: "admin",
          role,
        })
      ).id,
    ).toBe("hidden");
  },
);

it("enforces real project membership at the MCP authorization boundary", async () => {
  const context = makeToolContext({
    organizationId: "org",
    userId: "client",
    role: "member",
  });
  const tool = withMcpProjectAuth(async (_args, { project }) => project.id);
  expect(await tool({ projectId: "allowed" }, context)).toBe("allowed");
  for (const id of ["hidden", "foreign"])
    await expect(tool({ projectId: id }, context)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
});

it("refuses unlisted and cross-org report documents identically", async () => {
  // A real report lookup and real project gate; unauthorized readers never get HTML.
  await client.executeMultiple(
    `INSERT INTO reports (id, project_id, title, summary, created_by, created_by_user_id, size_bytes, html) VALUES ('hidden-report', 'hidden', 'Secret', '', 'test', 'admin', 13, '<p>secret</p>'), ('foreign-report', 'foreign', 'Foreign', '', 'test', 'admin', 14, '<p>foreign</p>');`,
  );
  const responses = await Promise.all(
    ["hidden-report", "foreign-report"].map((id) =>
      handleReportRequest(id, new Request(`https://openseo.test/r/${id}`)),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual([404, 404]);
  expect(await responses[0].text()).toBe(await responses[1].text());
});

it("only admins can add/remove grants and existing emails add directly", async () => {
  await expect(
    ProjectMemberService.inviteByEmail("hidden", "client@example.com", member),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await ProjectMemberService.inviteByEmail(
    "hidden",
    "CLIENT@example.com",
    admin,
  );
  await ProjectMemberService.inviteByEmail(
    "hidden",
    "client@example.com",
    admin,
  );
  expect(
    (await ProjectMemberService.listAccess("hidden", admin)).members,
  ).toEqual([
    expect.objectContaining({ userId: "client", email: "client@example.com" }),
  ]);
  expect(
    (await ProjectService.getProjectForOrganization("org", "hidden", member))
      .id,
  ).toBe("hidden");
  const load = withMcpProjectAuth(async (_args, { project }) => project.id);
  const context = makeToolContext(member);
  expect(await load({ projectId: "hidden" }, context)).toBe("hidden");
  await ProjectMemberService.removeProjectMember("hidden", "client", admin);
  await expect(load({ projectId: "hidden" }, context)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(
    ProjectService.getProjectForOrganization("org", "hidden", member),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("leaves project visibility unchanged outside Every App", async () => {
  test.everyapp = false;
  try {
    expect(
      new Set(
        (await ProjectService.listProjects("org", member)).map((p) => p.id),
      ),
    ).toEqual(new Set(["allowed", "hidden"]));
    await expect(
      ProjectMemberService.listAccess("hidden", admin),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    test.everyapp = true;
  }
});

it("binds Every App report map grants to current project access", async () => {
  const html =
    '<figure data-widget="rank-grid"><script type="application/json">{"keywords":[{"points":[{"lat":40,"lng":-80}]}]}</script></figure>';
  const request = new Request("https://openseo.test/report-map");
  const [allowed] = await createReportMapGrants(html, "allowed");
  const [hidden] = await createReportMapGrants(html, "hidden");
  expect(await verifyReportMapGrant(allowed, request)).not.toBeNull();
  expect(await verifyReportMapGrant(hidden, request)).toBeNull();
});

it("filters archived projects without revealing unassigned project names", async () => {
  expect(await ProjectService.listArchivedProjects("org", member)).toEqual([]);
  expect(
    (await ProjectService.listArchivedProjects("org", admin)).map((p) => p.id),
  ).toEqual(["archived"]);
});

it("converts normalized pending invites on verified user ensure, idempotently", async () => {
  await ProjectMemberService.inviteByEmail(
    "hidden",
    " NewClient@Example.com ",
    admin,
  );
  const identity: EveryAppUser = {
    channel: "web",
    actor: { sub: "new-client" },
    scopes: [],
    jti: "invite-test",
    id: "new-client",
    email: "NEWCLIENT@example.com",
    orgId: "workspace",
    orgRole: "member",
  };
  await resolveEveryAppUserContext(identity);
  await resolveEveryAppUserContext(identity);
  const access = await ProjectMemberService.listAccess("hidden", admin);
  expect(access.invites).toEqual([]);
  expect(access.members).toEqual([
    expect.objectContaining({ userId: "new-client" }),
  ]);
});

it("revokes pending invites and refuses cross-organization invitations", async () => {
  await expect(
    ProjectMemberService.inviteByEmail("foreign", "pending@example.com", admin),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await ProjectMemberService.inviteByEmail(
    "hidden",
    "pending@example.com",
    admin,
  );
  const { invites } = await ProjectMemberService.listAccess("hidden", admin);
  await ProjectMemberService.revokeInvite("hidden", invites[0].id, admin);
  expect(
    (await ProjectMemberService.listAccess("hidden", admin)).invites,
  ).toEqual([]);
});
