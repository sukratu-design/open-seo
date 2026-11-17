import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { ProjectMemberService } from "@/server/features/projects/services/ProjectMemberService";

const projectInput = z.object({ projectId: z.string().min(1) });
export const getProjectMembers = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput)
  .handler(({ data, context }) =>
    ProjectMemberService.listAccess(data.projectId, context),
  );
export const inviteByEmail = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(
    projectInput.extend({
      email: z.string().trim().toLowerCase().pipe(z.email()),
    }),
  )
  .handler(({ data, context }) =>
    ProjectMemberService.inviteByEmail(data.projectId, data.email, context),
  );
export const removeProjectMember = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput.extend({ userId: z.string().min(1) }))
  .handler(({ data, context }) =>
    ProjectMemberService.removeProjectMember(
      data.projectId,
      data.userId,
      context,
    ),
  );

export const revokeProjectInvite = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput.extend({ inviteId: z.string().min(1) }))
  .handler(({ data, context }) =>
    ProjectMemberService.revokeInvite(data.projectId, data.inviteId, context),
  );
