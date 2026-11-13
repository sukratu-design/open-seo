import { z } from "zod";
import { ProjectMemberService } from "@/server/features/projects/services/ProjectMemberService";
import type { ToolContext } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";

const projectId = z.string().min(1);
const member = z.looseObject({
  userId: z.string(),
  email: z.string(),
  createdAt: z.string(),
});

export const listProjectMembersTool = {
  name: "list_project_members",
  config: {
    title: "List project members",
    description:
      "Every App owners/admins only: list explicit project access grants. Owners and admins always have access without a grant. Uses no credits.",
    inputSchema: { projectId },
    outputSchema: z.looseObject({ members: z.array(member) }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  handler: async (args: { projectId: string }, context: ToolContext) => {
    const members = await ProjectMemberService.listProjectMembers(
      args.projectId,
      context.auth,
    );
    return mcpResponse({
      text: JSON.stringify(members),
      structuredContent: { members },
    });
  },
};

export const addProjectMemberTool = {
  name: "add_project_member",
  config: {
    title: "Add project member",
    description:
      "Every App owners/admins only: grant access by email. The person must open OpenSEO through the Gateway once first. Idempotent. Uses no credits.",
    inputSchema: { projectId, email: z.email().trim().toLowerCase() },
    outputSchema: z.looseObject({ success: z.boolean() }),
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  handler: async (
    args: { projectId: string; email: string },
    context: ToolContext,
  ) => {
    const result = await ProjectMemberService.addProjectMember(
      args.projectId,
      args.email,
      context.auth,
    );
    return mcpResponse({
      text: "Project access added.",
      structuredContent: result,
    });
  },
};

export const removeProjectMemberTool = {
  name: "remove_project_member",
  config: {
    title: "Remove project member",
    description:
      "Every App owners/admins only: remove an explicit project access grant by userId. Owners and admins retain access. Uses no credits.",
    inputSchema: { projectId, userId: z.string().min(1) },
    outputSchema: z.looseObject({ success: z.boolean() }),
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  handler: async (
    args: { projectId: string; userId: string },
    context: ToolContext,
  ) => {
    const result = await ProjectMemberService.removeProjectMember(
      args.projectId,
      args.userId,
      context.auth,
    );
    return mcpResponse({
      text: "Project access removed.",
      structuredContent: result,
    });
  },
};
