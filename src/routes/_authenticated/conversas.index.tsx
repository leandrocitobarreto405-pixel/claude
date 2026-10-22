import { createFileRoute } from "@tanstack/react-router";
import { MessageCircle } from "lucide-react";
import { ListaConversas } from "@/components/conversas/lista-conversas";
import { ABAS, type Aba } from "@/components/conversas/abas-conversas";
import { useEhPc } from "@/lib/conversas-tela";

export const Route = createFileRoute("/_authenticated/conversas/")({
  validateSearch: (search: Record<string, unknown>) => {
    const aba = String(search["aba"] ?? "");
    return {
      aba: ABAS.some((a) => a.id === aba) ? (aba as Aba) : undefined,
    };
  },
  head: () => ({ meta: [{ title: "Conversas — Nexa OS" }] }),
  component: Conversas,
});

/** Celular: a lista. PC: a lista já está na coluna da esquerda; aqui fica o convite para escolher. */
function Conversas() {
  const search = Route.useSearch();
  const ehPc = useEhPc();
  if (!ehPc) return <ListaConversas abaInicial={search.aba} />;
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div className="flex max-w-xs flex-col items-center gap-3 text-muted-foreground">
        <span className="grid size-14 place-items-center rounded-full bg-marca-claro text-marca">
          <MessageCircle className="size-7" aria-hidden />
        </span>
        <p className="text-sm">Escolha uma conversa na lista para ver as mensagens e responder.</p>
      </div>
    </div>
  );
}
