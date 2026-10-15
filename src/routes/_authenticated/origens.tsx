import { createFileRoute, redirect } from "@tanstack/react-router";

// Origens virou um bloco dentro do DRE; o endereço antigo continua abrindo.
export const Route = createFileRoute("/_authenticated/origens")({
  beforeLoad: () => {
    throw redirect({ to: "/dre", search: { bloco: "origens" } });
  },
});
