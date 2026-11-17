import { isEveryAppServerAuthMode } from "@/server/lib/runtime-env";
import { z } from "zod";
import { DashboardCacheService } from "./DashboardCacheService";
import { buildCacheKey, setCached } from "@/server/lib/r2-cache";
import { GscConnectionRepository } from "@/server/features/gsc/repositories/GscConnectionRepository";
import { Ga4ConnectionRepository } from "@/server/features/ga4/repositories/Ga4ConnectionRepository";

const number = z.number().finite().nullable();
const summarySchema = z.object({
  totals: z.record(z.string(), number),
  trend: z
    .array(z.object({ date: z.string(), value: z.number().finite() }))
    .max(400),
  startDate: z.string(),
  endDate: z.string(),
});
type Kind = "gsc" | "ga4";
async function cacheInput(
  kind: Kind,
  projectId: string,
  organizationId: string,
) {
  const connection =
    kind === "gsc"
      ? await GscConnectionRepository.getByProjectId(projectId)
      : await Ga4ConnectionRepository.getByProjectId(projectId);
  if (!connection || connection.organizationId !== organizationId) return null;
  // Bind the snapshot to this exact connection, including its owner. A
  // disconnect/reconnect or property change must not reveal a previous grant.
  return {
    namespace:
      kind === "gsc"
        ? DashboardCacheService.gscNamespace(projectId, "summary")
        : `dashboard:ga4:${projectId}:summary`,
    organizationId,
    params: { projectId, connection },
    schema: summarySchema,
  };
}
async function save(
  kind: Kind,
  projectId: string,
  organizationId: string,
  value: z.infer<typeof summarySchema>,
) {
  try {
    if (!(await isEveryAppServerAuthMode())) return;
    const input = await cacheInput(kind, projectId, organizationId);
    if (!input) return;
    const key = await buildCacheKey(input.namespace, {
      ...input.params,
      organizationId,
    });
    await setCached(
      key,
      {
        value: summarySchema.parse(value),
        fetchedAt: new Date().toISOString(),
      },
      90 * 86400,
    );
  } catch {
    // Saving a disposable snapshot must not fail an authenticated report.
    console.warn("Dashboard summary cache could not be saved");
  }
}
async function getCachedOnly(
  kind: Kind,
  projectId: string,
  organizationId: string,
) {
  const input = await cacheInput(kind, projectId, organizationId);
  return input ? DashboardCacheService.getCachedOnly(input) : null;
}
export const GoogleDashboardCacheService = { save, getCachedOnly };
