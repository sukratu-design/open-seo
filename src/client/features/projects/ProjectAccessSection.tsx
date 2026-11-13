import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { revalidateLogic } from "@tanstack/react-form";
import { useAppForm } from "@/client/components/form/useAppForm";
import { Button } from "@/client/components/ui/button";
import { SectionHeader } from "@/client/components/PageHeader";
import { QueryState } from "@/client/components/QueryState";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { hasOrgPermission } from "@/lib/org-permissions";
import { isEveryAppClientAuthMode } from "@/lib/auth-mode";
import {
  addProjectMember,
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
    mutationFn: (email: string) =>
      addProjectMember({ data: { projectId, email } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (userId: string) =>
      removeProjectMember({ data: { projectId, userId } }),
    onSuccess: refresh,
  });
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
        {(rows) =>
          rows.length ? (
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
              <field.TextField label="Member email" type="email" required />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            The person must open OpenSEO once through the Gateway before you add
            them.
          </p>
          <Button type="submit" disabled={add.isPending}>
            Add
          </Button>
        </form.Form>
      </form.AppForm>
      {add.error || remove.error ? (
        <p role="alert" className="text-sm text-destructive">
          {(add.error ?? remove.error)?.message}
        </p>
      ) : null}
    </section>
  );
}
