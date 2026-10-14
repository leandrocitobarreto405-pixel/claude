import { createFileRoute, redirect } from "@tanstack/react-router";
import { REDIRECIONAMENTOS } from "@/lib/menu";

// Usuários virou "Equipe e acessos", dentro de Configurações › Empresa.
export const Route = createFileRoute("/_authenticated/usuarios")({
  beforeLoad: () => {
    throw redirect({ to: REDIRECIONAMENTOS["/usuarios"]!.to as never, replace: true });
  },
});
