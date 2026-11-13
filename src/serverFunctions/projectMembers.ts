import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { ProjectMemberService } from "@/server/features/projects/services/ProjectMemberService";

const projectInput = z.object({ projectId: z.string().min(1) });
export const getProjectMembers = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput)
  .handler(({ data, context }) =>
    ProjectMemberService.listProjectMembers(data.projectId, context),
  );
export const addProjectMember = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(projectInput.extend({ email: z.email().trim().toLowerCase() }))
  .handler(({ data, context }) =>
    ProjectMemberService.addProjectMember(data.projectId, data.email, context),
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
