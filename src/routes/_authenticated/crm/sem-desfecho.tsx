import { createFileRoute, redirect } from "@tanstack/react-router";
import { REDIRECIONAMENTOS } from "@/lib/menu";

// Sem desfecho virou a aba "Sem desfecho" dos Follow-ups (29/10).
export const Route = createFileRoute("/_authenticated/crm/sem-desfecho")({
  beforeLoad: () => {
    const r = REDIRECIONAMENTOS["/crm/sem-desfecho"]!;
    throw redirect({ to: r.to as never, search: r.search as never, replace: true });
  },
});
