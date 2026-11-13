import { requireOrgPermission } from "@/server/auth/org-gate";
import { AppError } from "@/server/lib/errors";
import { isEveryAppServerAuthMode } from "@/server/lib/runtime-env";
import type { ProjectCaller } from "../project-access";
import { ProjectRepository } from "../repositories/ProjectRepository";
import { ProjectMemberRepository } from "../repositories/ProjectMemberRepository";

type Caller = ProjectCaller & { organizationId: string };

async function authorize(projectId: string, caller: Caller) {
  if (!(await isEveryAppServerAuthMode())) throw new AppError("FORBIDDEN");
  requireOrgPermission(caller, { project: ["create"] });
  if (
    !(await ProjectRepository.getProjectForOrganization(
      projectId,
      caller.organizationId,
      caller,
    ))
  ) {
    throw new AppError("NOT_FOUND");
  }
}

async function listProjectMembers(projectId: string, caller: Caller) {
  await authorize(projectId, caller);
  return ProjectMemberRepository.listProjectMembers(projectId);
}

async function addProjectMember(
  projectId: string,
  email: string,
  caller: Caller,
) {
  await authorize(projectId, caller);
  const user = await ProjectMemberRepository.findUserByEmail(email);
  if (!user)
    throw new AppError(
      "VALIDATION_ERROR",
      "This person must open OpenSEO once through the Gateway before you can add them.",
    );
  await ProjectMemberRepository.addProjectMember(
    projectId,
    user.id,
    caller.userId,
  );
  return { success: true };
}

async function removeProjectMember(
  projectId: string,
  userId: string,
  caller: Caller,
) {
  await authorize(projectId, caller);
  await ProjectMemberRepository.removeProjectMember(projectId, userId);
  return { success: true };
}

export const ProjectMemberService = {
  listProjectMembers,
  addProjectMember,
  removeProjectMember,
};
