import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { revalidateLogic } from "@tanstack/react-form";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import {
  getStandardErrorMessage,
  getErrorCode,
} from "@/client/lib/error-messages";
import { hasOrgPermission } from "@/lib/org-permissions";
import { isEveryAppClientAuthMode } from "@/lib/auth-mode";
import {
  inviteByEmail,
  revokeProjectInvite,
  getProjectMembers,
  removeProjectMember,
} from "@/serverFunctions/projectMembers";

export function ProjectAccessSection({ projectId }: { projectId: string }) {
  const organization = useQuery(organizationContextQueryOptions());
  if (
    !isEveryAppClientAuthMode() ||
    !hasOrgPermission(organization.data?.role ?? "member", {
      project: ["create"],
    })
  )
    return null;
  return <ProjectAccessEditor projectId={projectId} />;
}

function ProjectAccessEditor({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const queryKey = ["project-members", projectId];
  const members = useQuery({
    queryKey,
    queryFn: () => getProjectMembers({ data: { projectId } }),
  });
  const refresh = () => client.invalidateQueries({ queryKey });
  const add = useMutation({
    mutationFn: async (email: string) => ({
      ...(await inviteByEmail({ data: { projectId, email } })),
      projectUrl: new URL(`/p/${projectId}`, window.location.origin).href,
    }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      removeProjectMember({ data: { projectId, userId } }),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) =>
      revokeProjectInvite({ data: { projectId, inviteId } }),
    onSuccess: refresh,
  });
  const error = add.error ?? remove.error ?? revoke.error;
  const errorCode = getErrorCode(error);
  const errorMessage =
    add.error && errorCode === "VALIDATION_ERROR"
      ? "Enter a valid email address."
      : errorCode === "NOT_FOUND"
        ? "This project was not found."
        : getStandardErrorMessage(error);
  const form = useAppForm({
    defaultValues: { email: "" },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: z.object({ email: z.email("Enter a valid email address.") }),
    },
    onSubmit: async ({ value, formApi }) => {
      await add.mutateAsync(value.email);
      formApi.reset();
    },
  });
  return (
    <section className="space-y-3">
      <SectionHeader title="Project access" />
      <p className="text-sm text-muted-foreground">
        Owners and admins always see every project; members only see projects
        listed for them here.
      </p>
      <QueryState query={members} errorFallback="Failed to load project access">
        {({ members: rows, invites }) =>
          rows.length || invites.length ? (
            <ul className="divide-y rounded-lg border">
              {rows.map((row) => (
                <li
                  key={row.userId}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div>
                    <p className="text-sm">{row.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {row.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(row.userId)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div>
                    <p className="text-sm">{invite.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Invited {invite.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(invite.id)}
                  >
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              No members have been added.
            </p>
          )
        }
      </QueryState>
      <form.AppForm>
        <form.Form className="flex flex-col gap-3">
          <form.AppField name="email">
            {(field) => (
              <field.TextField
                label="Client email"
                placeholder="client@example.com"
                type="email"
                required
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            Invite a client by email. Share the project link so they can sign in
            with a one-time code, and see only this project.
          </p>
          <Button type="submit" disabled={add.isPending}>
            Invite
          </Button>
        </form.Form>
      </form.AppForm>
      {add.data ? (
        <p role="status" className="text-sm">
          {inviteMessage(add.variables ?? "", add.data, add.data.projectUrl)}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </section>
  );
}

function inviteMessage(
  email: string,
  result: Awaited<ReturnType<typeof inviteByEmail>>,
  projectUrl: string,
) {
  if (result.status === "added") return `${email} now has access.`;
  switch (result.gateway.status) {
    case "invited":
      return result.gateway.mailed === true ? (
        `Invitation emailed to ${email}. They'll land on this project after signing in.`
      ) : (
        <>
          {email} is invited. Send them this link:{" "}
          <InviteLink url={projectUrl} /> — they sign in with a one-time code
          sent to their email and see only this project.
        </>
      );
    case "already":
      return (
        <>
          {email} is invited. Send them this link:{" "}
          <InviteLink url={projectUrl} /> — they sign in with a one-time code
          sent to their email and see only this project.
        </>
      );
    case "not_configured":
      return `Saved. ${email} will get this project when they first sign in, but the Gateway invite isn't set up yet: ask your admin to set GATEWAY_ADMIN_TOKEN.`;
    case "failed":
      return `Saved, but the Gateway invite failed: ${result.gateway.message}`;
  }
}

function InviteLink({ url }: { url: string }) {
  return (
    <>
      <a href={url} className="underline">
        {url}
      </a>{" "}
      <Button
        variant="outline"
        onClick={() => void navigator.clipboard.writeText(url)}
      >
        Copy
      </Button>
    </>
  );
}
