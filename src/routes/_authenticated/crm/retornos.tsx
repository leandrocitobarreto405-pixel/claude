import { createFileRoute, redirect } from "@tanstack/react-router";
import { REDIRECIONAMENTOS } from "@/lib/menu";

// Retornos virou parte de Vendas › Follow-ups (29/10).
export const Route = createFileRoute("/_authenticated/crm/retornos")({
  beforeLoad: () => {
    const r = REDIRECIONAMENTOS["/crm/retornos"]!;
    throw redirect({ to: r.to as never, search: r.search as never, replace: true });
  },
});
