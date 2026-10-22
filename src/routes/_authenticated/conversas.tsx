import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ListaConversas } from "@/components/conversas/lista-conversas";
import { useEhPc } from "@/lib/conversas-tela";

export const Route = createFileRoute("/_authenticated/conversas")({
  component: LayoutConversas,
});

/**
 * Conversas. Celular: a lista e a conversa são telas separadas (a conversa ocupa a tela toda).
 * PC: lista à esquerda (rola sozinha) e a conversa (ou o convite para escolher uma) à direita.
 */
function LayoutConversas() {
  const ehPc = useEhPc();
  if (!ehPc) return <Outlet />;
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(320px,400px)_minmax(0,1fr)]">
      <aside
        className="min-h-0 overflow-y-auto border-r border-border p-4"
        data-scroll-restoration-id="lista-conversas"
        aria-label="Lista de conversas"
      >
        <ListaConversas />
      </aside>
      <section className="min-h-0 min-w-0">
        <Outlet />
      </section>
    </div>
  );
}
