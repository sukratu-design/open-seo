import { ProjectShareRepository } from "../repositories/ProjectShareRepository";
import { ProjectRepository } from "../repositories/ProjectRepository";
import { requireOrgPermission } from "@/server/auth/org-gate";
import { isEveryAppServerAuthMode } from "@/server/lib/runtime-env";
import { AppError } from "@/server/lib/errors";
import type { ProjectCaller } from "../project-access";

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
  )
    throw new AppError("NOT_FOUND");
}
async function hash(token: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function create(projectId: string, caller: Caller) {
  await authorize(projectId, caller);
  const token = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
  )
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  await ProjectShareRepository.create({
    id: crypto.randomUUID(),
    projectId,
    organizationId: caller.organizationId,
    createdByUserId: caller.userId,
    createdAt: new Date().toISOString(),
    tokenHash: await hash(token),
  });
  return { token };
}
async function status(projectId: string, caller: Caller) {
  await authorize(projectId, caller);
  return ProjectShareRepository.status(projectId, caller.organizationId);
}
async function revoke(projectId: string, caller: Caller) {
  await authorize(projectId, caller);
  await ProjectShareRepository.revoke(projectId, caller.organizationId);
  return { success: true };
}
async function lookup(token: string) {
  // Validate before hashing or issuing any database read.
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  if (!(await isEveryAppServerAuthMode())) return null;
  return ProjectShareRepository.lookup(await hash(token));
}
export const ProjectShareService = { create, status, revoke, lookup };
