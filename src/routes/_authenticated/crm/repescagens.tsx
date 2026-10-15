import { createFileRoute, redirect } from "@tanstack/react-router";
import { REDIRECIONAMENTOS } from "@/lib/menu";

// "Repescagens" virou "Retornos".
export const Route = createFileRoute("/_authenticated/crm/repescagens")({
  beforeLoad: () => {
    throw redirect({ to: REDIRECIONAMENTOS["/crm/repescagens"]!.to as never, replace: true });
  },
});
