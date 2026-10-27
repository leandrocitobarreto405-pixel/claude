import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/contadora/")({
  beforeLoad: () => {
    throw redirect({ to: "/contadora/notas", replace: true });
  },
});
