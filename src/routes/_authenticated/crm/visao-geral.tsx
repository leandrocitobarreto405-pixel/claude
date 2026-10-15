import { createFileRoute, redirect } from "@tanstack/react-router";
import { REDIRECIONAMENTOS } from "@/lib/menu";

// A visão geral do CRM virou parte da aba Indicadores do Funil.
export const Route = createFileRoute("/_authenticated/crm/visao-geral")({
  beforeLoad: () => {
    throw redirect({ to: REDIRECIONAMENTOS["/crm/visao-geral"]!.to as never, replace: true });
  },
});
