import { z } from "zod";
import {
  inviteGatewayMember,
  uninviteGatewayMember,
} from "@/server/everyapp/gatewayAdmin";
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

async function listAccess(projectId: string, caller: Caller) {
  await authorize(projectId, caller);
  const [members, invites] = await Promise.all([
    ProjectMemberRepository.listProjectMembers(projectId),
    ProjectMemberRepository.listInvites(projectId),
  ]);
  return { members, invites };
}

async function inviteByEmail(projectId: string, input: string, caller: Caller) {
  await authorize(projectId, caller);
  const parsed = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email())
    .safeParse(input);
  if (!parsed.success)
    throw new AppError("VALIDATION_ERROR", "Enter a valid email address.");
  const email = parsed.data;
  const user = await ProjectMemberRepository.findUserByEmail(email);
  if (user) {
    await ProjectMemberRepository.addProjectMember(
      projectId,
      user.id,
      caller.userId,
    );
    await ProjectMemberRepository.acceptInvites(user.id, email);
    return { status: "added" as const };
  }
  await ProjectMemberRepository.saveInvite(projectId, email, caller.userId);
  // Close the first-sign-in race between the initial lookup and saving the invite.
  const signedIn = await ProjectMemberRepository.findUserByEmail(email);
  if (signedIn) {
    await ProjectMemberRepository.acceptInvites(signedIn.id, email);
    return { status: "added" as const };
  }
  return {
    status: "invited" as const,
    gateway: await inviteGatewayMember(email),
  };
}

async function revokeInvite(
  projectId: string,
  inviteId: string,
  caller: Caller,
) {
  await authorize(projectId, caller);
  const invite = await ProjectMemberRepository.revokeInvite(
    projectId,
    inviteId,
  );
  if (
    invite &&
    !(await ProjectMemberRepository.hasPendingInvites(invite.email))
  )
    await uninviteGatewayMember(invite.email);
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
  listAccess,
  inviteByEmail,
  revokeInvite,
  removeProjectMember,
};
