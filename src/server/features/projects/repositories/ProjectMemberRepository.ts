import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectInvites, projectMembers, user } from "@/db/schema";

async function listProjectMembers(projectId: string) {
  return db
    .select({
      userId: user.id,
      email: user.email,
      createdAt: projectMembers.createdAt,
    })
    .from(projectMembers)
    .innerJoin(user, eq(user.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(user.email));
}

async function findUserByEmail(email: string) {
  const [found] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return found ?? null;
}

async function addProjectMember(
  projectId: string,
  userId: string,
  addedBy: string,
) {
  await db
    .insert(projectMembers)
    .values({ projectId, userId, addedBy })
    .onConflictDoNothing();
}

async function removeProjectMember(projectId: string, userId: string) {
  await db
    .delete(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, userId),
      ),
    );
}

async function listInvites(projectId: string) {
  return db
    .select({
      id: projectInvites.id,
      email: projectInvites.email,
      createdAt: projectInvites.createdAt,
    })
    .from(projectInvites)
    .where(eq(projectInvites.projectId, projectId))
    .orderBy(asc(projectInvites.email));
}

async function saveInvite(
  projectId: string,
  email: string,
  invitedByUserId: string,
) {
  await db
    .insert(projectInvites)
    .values({ id: crypto.randomUUID(), projectId, email, invitedByUserId })
    .onConflictDoNothing();
}

async function revokeInvite(projectId: string, inviteId: string) {
  const [invite] = await db
    .delete(projectInvites)
    .where(
      and(
        eq(projectInvites.projectId, projectId),
        eq(projectInvites.id, inviteId),
      ),
    )
    .returning({ email: projectInvites.email });
  return invite;
}

async function hasPendingInvites(email: string) {
  return (
    (
      await db
        .select({ id: projectInvites.id })
        .from(projectInvites)
        .where(eq(projectInvites.email, email))
        .limit(1)
    ).length > 0
  );
}

async function acceptInvites(userId: string, email: string) {
  const invites = await db
    .select()
    .from(projectInvites)
    .where(eq(projectInvites.email, email.trim().toLowerCase()));
  for (const invite of invites) {
    await db
      .insert(projectMembers)
      .values({
        projectId: invite.projectId,
        userId,
        addedBy: invite.invitedByUserId,
      })
      .onConflictDoNothing();
    // Delete only after the grant succeeds; a retry safely finishes an interrupted conversion.
    await db.delete(projectInvites).where(eq(projectInvites.id, invite.id));
  }
}

export const ProjectMemberRepository = {
  listInvites,
  saveInvite,
  revokeInvite,
  hasPendingInvites,
  acceptInvites,
  listProjectMembers,
  findUserByEmail,
  addProjectMember,
  removeProjectMember,
};
