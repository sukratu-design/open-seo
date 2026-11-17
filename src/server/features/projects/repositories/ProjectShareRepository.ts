import { and, eq, isNull, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  projectShareLinks,
  audits,
  backlinkSnapshots,
  rankTrackingKeywords,
  rankTrackingConfigs,
  rankSnapshots,
  rankCheckRuns,
} from "@/db/schema";

async function status(projectId: string, organizationId: string) {
  const [row] = await db
    .select({ createdAt: projectShareLinks.createdAt })
    .from(projectShareLinks)
    .where(
      and(
        eq(projectShareLinks.projectId, projectId),
        eq(projectShareLinks.organizationId, organizationId),
        isNull(projectShareLinks.revokedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}
async function revoke(projectId: string, organizationId: string) {
  await db
    .update(projectShareLinks)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(projectShareLinks.projectId, projectId),
        eq(projectShareLinks.organizationId, organizationId),
        isNull(projectShareLinks.revokedAt),
      ),
    );
}
async function create(input: typeof projectShareLinks.$inferInsert) {
  // One row per project: atomic replacement prevents concurrent creates from
  // leaving two live capabilities. A rotated token stops working immediately.
  await db
    .insert(projectShareLinks)
    .values(input)
    .onConflictDoUpdate({
      target: projectShareLinks.projectId,
      targetWhere: isNull(projectShareLinks.revokedAt),
      set: {
        tokenHash: input.tokenHash,
        createdByUserId: input.createdByUserId,
        createdAt: input.createdAt,
      },
    });
}
async function lookup(tokenHash: string) {
  const [project] = await db
    .select({
      id: projects.id,
      organizationId: projects.organizationId,
      name: projects.name,
      domain: projects.domain,
    })
    .from(projectShareLinks)
    .innerJoin(
      projects,
      and(
        eq(projects.id, projectShareLinks.projectId),
        eq(projects.organizationId, projectShareLinks.organizationId),
      ),
    )
    .where(
      and(
        eq(projectShareLinks.tokenHash, tokenHash),
        isNull(projectShareLinks.revokedAt),
        isNull(projects.archivedAt),
      ),
    )
    .limit(1);
  return project ?? null;
}
async function report(projectId: string) {
  const [auditRows, backlinks, keywords] = await Promise.all([
    db
      .select({ pages: audits.pagesCrawled, completedAt: audits.completedAt })
      .from(audits)
      .where(
        and(eq(audits.projectId, projectId), eq(audits.status, "completed")),
      )
      .orderBy(desc(audits.completedAt))
      .limit(1),
    db
      .select({
        backlinks: backlinkSnapshots.backlinks,
        referringDomains: backlinkSnapshots.referringDomains,
        capturedAt: backlinkSnapshots.capturedAt,
      })
      .from(backlinkSnapshots)
      .where(eq(backlinkSnapshots.projectId, projectId))
      .orderBy(desc(backlinkSnapshots.capturedAt))
      .limit(1),
    db
      .select({
        id: rankTrackingKeywords.id,
        keyword: rankTrackingKeywords.keyword,
        devices: rankTrackingConfigs.devices,
      })
      .from(rankTrackingKeywords)
      .innerJoin(
        rankTrackingConfigs,
        eq(rankTrackingConfigs.id, rankTrackingKeywords.configId),
      )
      .where(eq(rankTrackingConfigs.projectId, projectId))
      .orderBy(rankTrackingKeywords.keyword)
      .limit(50),
  ]);
  const ranks = await Promise.all(
    keywords.map(async (keyword) => {
      const snapshots = await db
        .select({
          position: rankSnapshots.position,
          checkedAt: rankSnapshots.checkedAt,
        })
        .from(rankSnapshots)
        .innerJoin(rankCheckRuns, eq(rankCheckRuns.id, rankSnapshots.runId))
        .where(
          and(
            eq(rankSnapshots.trackingKeywordId, keyword.id),
            eq(
              rankSnapshots.device,
              keyword.devices === "mobile" ? "mobile" : "desktop",
            ),
            eq(rankCheckRuns.projectId, projectId),
            eq(rankCheckRuns.status, "completed"),
          ),
        )
        .orderBy(desc(rankSnapshots.checkedAt), desc(rankSnapshots.id))
        .limit(2);
      const [latest, previous] = snapshots;
      return {
        keyword: keyword.keyword,
        device: keyword.devices === "mobile" ? "mobile" : "desktop",
        position: latest?.position ?? null,
        change:
          latest?.position != null && previous?.position != null
            ? previous.position - latest.position
            : null,
        checkedAt: latest?.checkedAt ?? null,
      };
    }),
  );
  return {
    audit: auditRows[0] ?? null,
    backlinks: backlinks[0] ?? null,
    ranks,
  };
}
export const ProjectShareRepository = {
  status,
  revoke,
  create,
  lookup,
  report,
};
