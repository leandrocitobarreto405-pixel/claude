import { createFileRoute, redirect } from "@tanstack/react-router";
import { REDIRECIONAMENTOS } from "@/lib/menu";

// O painel de follow-up (cadência e Alice × equipe) foi para o Dashboard (29/10).
export const Route = createFileRoute("/_authenticated/crm/follow-up")({
  beforeLoad: () => {
    const r = REDIRECIONAMENTOS["/crm/follow-up"]!;
    throw redirect({ to: r.to as never, search: r.search as never, replace: true });
  },
});
