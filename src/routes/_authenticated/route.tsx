import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { destinoDaNovaOs } from "@/lib/nova-os/estado";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    // Nova OS abre em janela (/oss?nova=1). O formulário antigo continua em ?classico=1 e ?editar=.
    if (location.pathname === "/nova-os") {
      const destino = destinoDaNovaOs(location.search as Record<string, unknown>);
      if (destino) throw redirect({ to: "/oss", search: destino as never, replace: true });
    }
    return { user: data.user };
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
