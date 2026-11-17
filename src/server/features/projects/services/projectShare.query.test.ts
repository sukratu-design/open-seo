import { sort } from "remeda";
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { ProjectShareService } from "./ProjectShareService";
import { projectShareResponse } from "../projectSharePage";
import { GoogleDashboardCacheService } from "@/server/features/dashboard/services/GoogleDashboardCacheService";

const state = vi.hoisted(() => ({
  db: undefined as unknown,
  dbReads: 0,
  objects: new Map<string, string>(),
  writes: 0,
}));
vi.mock("@/db", () => ({
  get db() {
    state.dbReads++;
    return state.db;
  },
}));
vi.mock("cloudflare:workers", () => ({
  env: {
    AUTH_MODE: "everyapp",
    R2: {
      get: async (key: string) =>
        state.objects.has(key)
          ? { text: async () => state.objects.get(key), customMetadata: {} }
          : null,
      put: async (key: string, value: string) => {
        state.writes++;
        state.objects.set(key, value);
      },
    },
  },
}));
vi.mock("@/server/lib/runtime-env", () => ({
  isEveryAppServerAuthMode: async () => true,
}));
vi.mock(
  "@/server/features/dashboard/repositories/DataRefreshClaimRepository",
  () => ({
    DataRefreshClaimRepository: {
      claim: () => {
        throw new Error("Public readers must not claim refreshes");
      },
    },
  }),
);
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: () => {
    throw new Error("Provider call forbidden");
  },
}));
vi.mock("@/server/lib/gscClient", () => ({
  createGscClient: () => {
    throw new Error("Provider call forbidden");
  },
}));
vi.mock("@/server/lib/ga4Client", () => ({
  createGa4DataClient: () => {
    throw new Error("Provider call forbidden");
  },
}));
const client = createClient({ url: "file::memory:" });
const admin = { organizationId: "org", userId: "admin", role: "admin" };
beforeAll(async () => {
  state.db = drizzle(client, { schema });
  for (const file of sort(
    readdirSync("drizzle/sqlite").filter((name) => name.endsWith(".sql")),
    (a, b) => a.localeCompare(b),
  ))
    await client.executeMultiple(
      readFileSync(`drizzle/sqlite/${file}`, "utf8"),
    );
  await client.executeMultiple(`
    PRAGMA foreign_keys=ON;
    INSERT INTO organization (id,name,slug,created_at) VALUES ('org','Workspace','workspace',0),('other','Other','other',0);
    INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('admin','Admin','private@example.com',1,0,0);
    INSERT INTO projects (id,organization_id,name) VALUES ('shared','org','Shared <script>alert(1)</script>'),('hidden','other','Secret competitor project');
    INSERT INTO audits (id,project_id,started_by_user_id,start_url,status,pages_crawled,completed_at) VALUES ('audit','shared','admin','https://example.com','completed',17,'2026-11-01'),('hidden-audit','hidden','admin','https://secret.example','completed',9999,'2026-11-02');
    INSERT INTO backlink_snapshots (project_id,domain,backlinks,referring_domains) VALUES ('shared','example.com',123,34),('hidden','secret.example',9999,9999);
    INSERT INTO rank_tracking_configs (id,project_id,domain,serp_depth,devices) VALUES ('config','shared','example.com',20,'mobile'),('hidden-config','hidden','secret.example',20,'mobile');
    INSERT INTO rank_tracking_keywords (id,config_id,keyword) VALUES ('keyword','config','Visible keyword'),('hidden-keyword','hidden-config','Secret keyword');
    INSERT INTO rank_check_runs (id,config_id,project_id,status) VALUES ('run','config','shared','completed'),('previous','config','shared','completed'),('hidden-run','hidden-config','hidden','completed');
    INSERT INTO rank_snapshots (run_id,tracking_keyword_id,keyword,device,position,checked_at) VALUES ('run','keyword','Visible keyword','mobile',3,'2026-11-02'),('previous','keyword','Visible keyword','mobile',5,'2026-11-01'),('hidden-run','hidden-keyword','Secret keyword','mobile',1,'2026-11-03');
    INSERT INTO gsc_connections (id,project_id,organization_id,site_url,connected_by_user_id,gsc_account_id) VALUES ('gsc','shared','org','sc-domain:example.com','admin','private-google-account');
    INSERT INTO ga4_connections (id,project_id,organization_id,property_id,property_display_name,property_time_zone,property_currency_code,connected_by_user_id,ga4_account_id) VALUES ('ga4','shared','org','properties/123','Private property','UTC','USD','admin','private-ga4-account');
  `);
});
afterAll(() => client.close());
it("rejects malformed links without accessing the database", async () => {
  const reads = state.dbReads;
  const response = await projectShareResponse("malformed");
  expect(response.status).toBe(404);
  expect(await response.text()).toContain(
    "This link is invalid or has been revoked.",
  );
  expect(state.dbReads).toBe(reads);
  const unknown = await projectShareResponse("A".repeat(43));
  expect(unknown.status).toBe(404);
  expect(await unknown.text()).toContain(
    "This link is invalid or has been revoked.",
  );
});
it("stores only a hash; rotating, revoking and archiving invalidate public capabilities", async () => {
  const first = await ProjectShareService.create("shared", admin);
  expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const stored = await client.execute(
    "SELECT token_hash FROM project_share_links WHERE project_id='shared' AND revoked_at IS NULL",
  );
  expect(stored.rows[0].token_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(stored.rows[0].token_hash).not.toBe(first.token);

  expect(await ProjectShareService.lookup(first.token)).toMatchObject({
    id: "shared",
  });
  const second = await ProjectShareService.create("shared", admin);
  expect((await projectShareResponse(first.token)).status).toBe(404);
  await ProjectShareService.revoke("shared", admin);
  expect((await projectShareResponse(second.token)).status).toBe(404);
  const third = await ProjectShareService.create("shared", admin);
  expect(third.token).not.toBe(second.token);
  await client.execute(
    "UPDATE projects SET archived_at='2026-01-01' WHERE id='shared'",
  );
  expect((await projectShareResponse(third.token)).status).toBe(404);
  await client.execute(
    "UPDATE projects SET archived_at=NULL WHERE id='shared'",
  );
});
it("serves an escaped, scoped anonymous report using saved summaries without writes or providers", async () => {
  await GoogleDashboardCacheService.save("gsc", "shared", "org", {
    totals: { clicks: 12, impressions: 100, ctr: 0.12, position: 3 },
    trend: [{ date: "2026-11-01", value: 12 }],
    startDate: "2026-11-01",
    endDate: "2026-11-01",
  });
  await GoogleDashboardCacheService.save("ga4", "shared", "org", {
    totals: { sessions: 42, activeUsers: 30 },
    trend: [],
    startDate: "2026-11-01",
    endDate: "2026-11-01",
  });
  const { token } = await ProjectShareService.create("shared", admin);
  const writes = state.writes;
  const response = await projectShareResponse(token);
  const html = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "default-src 'none'",
  );
  expect(html).toContain("Clicks: 12");
  expect(html).toContain("Sessions: 42");
  expect(html).toContain("17");
  expect(html).toContain("Backlinks: 123");
  expect(html).toContain("Referring domains: 34");
  expect(html).toContain(
    "Visible keyword</td><td>mobile</td><td>3</td><td>2</td>",
  );
  expect(html).toContain("<svg");
  expect(html).toContain("&lt;script&gt;");
  for (const secret of [
    "Secret competitor project",
    "Secret keyword",
    "9999",
    "private@example.com",
    "private-google-account",
    "private-ga4-account",
    token,
    "<script>",
  ])
    expect(html).not.toContain(secret);
  expect(state.writes).toBe(writes);
  state.objects.clear();
  expect(await (await projectShareResponse(token)).text()).toContain(
    "Not available yet",
  );
  expect(state.writes).toBe(writes);
});
it("allows only workspace owners and admins to manage a share", async () => {
  await expect(
    ProjectShareService.create("shared", { ...admin, role: "member" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    ProjectShareService.create("hidden", admin),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
