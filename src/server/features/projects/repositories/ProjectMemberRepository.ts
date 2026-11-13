import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { projectMembers, user } from "@/db/schema";

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

export const ProjectMemberRepository = {
  listProjectMembers,
  findUserByEmail,
  addProjectMember,
  removeProjectMember,
};
