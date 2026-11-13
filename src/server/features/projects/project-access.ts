import { hasOrgPermission } from "@/lib/org-permissions";
import { isEveryAppServerAuthMode } from "@/server/lib/runtime-env";

export type ProjectCaller = { userId: string; role: string };

export const TRUSTED_ORG_WORK = "system";

export async function isRestrictedProjectMember(
  caller: ProjectCaller | typeof TRUSTED_ORG_WORK,
) {
  return (
    (await isEveryAppServerAuthMode()) &&
    caller !== TRUSTED_ORG_WORK &&
    !hasOrgPermission(caller.role, { project: ["create"] })
  );
}
