import { hasOrgPermission } from "@/lib/org-permissions";
import { isEveryAppServerAuthMode } from "@/server/lib/runtime-env";

export type ProjectCaller = { userId: string; role: string };

export async function isRestrictedProjectMember(caller?: ProjectCaller) {
  return (
    (await isEveryAppServerAuthMode()) &&
    caller !== undefined &&
    !hasOrgPermission(caller.role, { project: ["create"] })
  );
}
