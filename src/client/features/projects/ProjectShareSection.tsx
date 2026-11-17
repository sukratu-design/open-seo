import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { SectionHeader } from "@/client/components/PageHeader";
import { InlineConfirm } from "@/client/components/InlineConfirm";
import { QueryState } from "@/client/components/QueryState";
import { organizationContextQueryOptions } from "@/client/features/team/organizationQueries";
import { hasOrgPermission } from "@/lib/org-permissions";
import { isEveryAppClientAuthMode } from "@/lib/auth-mode";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import {
  createProjectShare,
  getProjectShareStatus,
  revokeProjectShare,
} from "@/serverFunctions/projectShares";

export function ProjectShareSection({ projectId }: { projectId: string }) {
  const organization = useQuery(organizationContextQueryOptions());
  if (
    !isEveryAppClientAuthMode() ||
    !hasOrgPermission(organization.data?.role ?? "member", {
      project: ["create"],
    })
  )
    return null;
  return <ShareEditor key={projectId} projectId={projectId} />;
}
function ShareEditor({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const client = useQueryClient();
  const queryKey = ["project-share", projectId];
  const status = useQuery({
    queryKey,
    queryFn: () => getProjectShareStatus({ data: { projectId } }),
  });
  const refresh = () => client.invalidateQueries({ queryKey });
  const create = useMutation({
    mutationFn: () => createProjectShare({ data: { projectId } }),
    onSuccess: async ({ token }) => {
      setUrl(new URL(`/share/project/${token}`, window.location.origin).href);
      await refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: () => revokeProjectShare({ data: { projectId } }),
    onSuccess: async () => {
      setUrl(null);
      await refresh();
    },
  });
  const error = create.error ?? revoke.error;
  const pending = create.isPending || revoke.isPending;
  return (
    <section className="space-y-3">
      <SectionHeader title="Share link" />
      <p className="text-sm text-muted-foreground">
        Anyone with this link can view a read-only report for this project. No
        sign-in needed.
      </p>
      <QueryState query={status} errorFallback="Failed to load share link">
        {(active) => (
          <>
            {url ? (
              <div className="space-y-2">
                <a
                  className="break-all underline"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {url}
                </a>
                <p className="text-sm text-muted-foreground">
                  Copy it now; for security it won't be shown again.
                </p>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(url);
                      toast.success("Link copied");
                    } catch {
                      toast.error(
                        "Could not copy link. Select and copy the URL.",
                      );
                    }
                  }}
                >
                  Copy link
                </Button>
              </div>
            ) : active ? (
              <p className="text-sm">
                Link active since {active.createdAt.slice(0, 10)}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button disabled={pending} onClick={() => create.mutate()}>
                {active ? "Create new link" : "Create share link"}
              </Button>
              {active ? (
                <InlineConfirm
                  label="Revoke share link"
                  triggerLabel="Revoke link"
                  confirmLabel="Yes, revoke link"
                  pending={pending}
                  onConfirm={() => revoke.mutate()}
                />
              ) : null}
            </div>
          </>
        )}
      </QueryState>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {getStandardErrorMessage(error)}
        </p>
      ) : null}
    </section>
  );
}
