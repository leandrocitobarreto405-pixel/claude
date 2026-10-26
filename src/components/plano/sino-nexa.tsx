// Sininho do Painel Nexa: pedidos de mudança de plano ("Quero mudar de plano") das empresas.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { BadgeAlerta, Botao } from "@/components/nexa";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { marcarPedidoVistoFn, pedidosPlanoNexaFn } from "@/lib/plano.functions";
import { rotuloRecurso, type Recurso } from "@/lib/recursos";

const CHAVE = ["nexa_pedidos_plano"] as const;

export function SinoNexa() {
  const qc = useQueryClient();
  const listar = useServerFn(pedidosPlanoNexaFn);
  const marcar = useServerFn(marcarPedidoVistoFn);
  const [aberto, setAberto] = useState(false);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => listar(), refetchInterval: 120_000 });
  const pedidos = q.data ?? [];

  async function visto(id: string) {
    try {
      await marcar({ data: { id } });
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch {
      toast.error("Não foi possível marcar como visto.");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label={
          pedidos.length ? `Avisos da plataforma: ${pedidos.length}` : "Avisos da plataforma"
        }
        className="relative grid size-11 shrink-0 place-items-center rounded-botao text-foreground hover:bg-muted"
      >
        <Bell className="size-[22px]" aria-hidden />
        {pedidos.length ? (
          <BadgeAlerta numero={pedidos.length} className="absolute -right-0.5 -top-0.5" />
        ) : null}
      </button>
      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent side="right" className="w-[92vw] max-w-md overflow-y-auto p-4">
          <SheetTitle className="font-titulo text-xl">Avisos da plataforma</SheetTitle>
          {pedidos.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">Nenhum pedido de mudança de plano.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {pedidos.map((p) => (
                <li key={p.id} className="grid gap-2 rounded-card border border-border bg-card p-3">
                  <p className="text-sm">
                    <strong>{p.empresa}</strong> quer mudar de plano
                    {p.recurso ? ` (para ter ${rotuloRecurso(p.recurso as Recurso)})` : ""}.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.criado_em).toLocaleString("pt-BR", {
                      timeZone: "America/Sao_Paulo",
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                    {p.plano_sugerido ? ` · plano sugerido: ${p.plano_sugerido}` : ""}
                  </p>
                  <Botao variante="neutro" onClick={() => void visto(p.id)}>
                    Marcar como visto
                  </Botao>
                </li>
              ))}
            </ul>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
