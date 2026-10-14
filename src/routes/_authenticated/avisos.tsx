import { createFileRoute, redirect } from "@tanstack/react-router";
import { REDIRECIONAMENTOS } from "@/lib/menu";

// A tela Avisos virou o sininho do topo: links antigos e notificações abrem o painel no Início.
export const Route = createFileRoute("/_authenticated/avisos")({
  beforeLoad: () => {
    const r = REDIRECIONAMENTOS["/avisos"]!;
    throw redirect({ to: r.to as never, search: r.search as never, replace: true });
  },
});
