import { createFileRoute } from "@tanstack/react-router";
import { projectShareResponse } from "@/server/features/projects/projectSharePage";
export const Route = createFileRoute("/share/project/$token")({
  server: {
    handlers: { GET: ({ params }) => projectShareResponse(params.token) },
  },
});
