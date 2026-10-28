import { createFileRoute, redirect } from "@tanstack/react-router";
import { REDIRECIONAMENTOS } from "@/lib/menu";

// Leads do site virou a aba "Do site" dos Follow-ups (29/10).
export const Route = createFileRoute("/_authenticated/crm/leads-site")({
  beforeLoad: () => {
    const r = REDIRECIONAMENTOS["/crm/leads-site"]!;
    throw redirect({ to: r.to as never, search: r.search as never, replace: true });
  },
});
