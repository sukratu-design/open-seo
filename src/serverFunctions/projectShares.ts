import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireProjectContext } from "@/serverFunctions/middleware";
import { ProjectShareService } from "@/server/features/projects/services/ProjectShareService";
const input = z.object({ projectId: z.string().min(1) });
export const getProjectShareStatus = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(input)
  .handler(({ data, context }) =>
    ProjectShareService.status(data.projectId, context),
  );
export const createProjectShare = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(input)
  .handler(({ data, context }) =>
    ProjectShareService.create(data.projectId, context),
  );
export const revokeProjectShare = createServerFn({ method: "POST" })
  .middleware(requireProjectContext)
  .validator(input)
  .handler(({ data, context }) =>
    ProjectShareService.revoke(data.projectId, context),
  );
