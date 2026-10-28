import { createFileRoute, redirect } from "@tanstack/react-router";
import { REDIRECIONAMENTOS } from "@/lib/menu";

// Indicadores virou Vendas › Dashboard (29/10).
export const Route = createFileRoute("/_authenticated/indicadores")({
  beforeLoad: () => {
    throw redirect({ to: REDIRECIONAMENTOS["/indicadores"]!.to as never, replace: true });
  },
});
