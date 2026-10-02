import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Archive, Check } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Botao } from "@/components/nexa";
import {
  DIAS_PARADA,
  conversasParadasFn,
  encerrarConversasFn,
} from "@/lib/conversas-limpeza.functions";
import { haQuanto } from "@/lib/conversas";
import { cn } from "@/lib/utils";

/**
 * "Encerrar paradas há mais de X dias" (só admin): mostra a lista, a pessoa confere e tira quem
 * não quiser; só então encerra no Chatwoot.
 */
export function EncerrarParadas() {
  const qc = useQueryClient();
  const listarFn = useServerFn(conversasParadasFn);
  const encerrarFn = useServerFn(encerrarConversasFn);
  const [aberto, setAberto] = useState(false);
  const [dias, setDias] = useState(3);
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [encerrando, setEncerrando] = useState(false);
  const q = useQuery({
    queryKey: ["conversas", "paradas", dias],
    queryFn: () => listarFn({ data: { dias } }),
    enabled: aberto,
  });
  useEffect(() => setFora(new Set()), [dias, q.data]);
  const lista = q.data ?? [];
  const escolhidas = lista.filter((c) => !fora.has(c.id));

  async function encerrar() {
    const n = escolhidas.length;
    if (
      !window.confirm(
        `Encerrar ${n} ${n === 1 ? "conversa" : "conversas"} no Chatwoot? Se o cliente escrever de novo, a conversa reabre.`,
      )
    )
      return;
    setEncerrando(true);
    try {
      const r = await encerrarFn({ data: { ids: escolhidas.map((c) => c.id), dias } });
      toast.success(
        r.falhas
          ? `${r.encerradas} encerradas. ${r.falhas} não puderam ser encerradas no Chatwoot.`
          : `${r.encerradas} ${r.encerradas === 1 ? "conversa encerrada" : "conversas encerradas"}.`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["conversas"] }),
        qc.invalidateQueries({ queryKey: ["alice_resumo_hoje"] }),
      ]);
      setAberto(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível encerrar.");
    } finally {
      setEncerrando(false);
    }
  }

  return (
    <>
      <Botao variante="neutro" className="self-start" onClick={() => setAberto(true)}>
        <Archive /> Encerrar conversas paradas
      </Botao>
      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent
          side="bottom"
          className="max-h-[88vh] overflow-y-auto rounded-t-card-lg p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          <SheetTitle className="font-titulo text-2xl">Encerrar conversas paradas</SheetTitle>
          <SheetDescription>
            Conversas com a equipe sem nenhuma mensagem há mais de {dias} dias. Confira a lista
            antes: nada é encerrado sem você confirmar.
          </SheetDescription>
          <div className="mt-4 flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Paradas há mais de</span>
              {DIAS_PARADA.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={dias === d}
                  onClick={() => setDias(d)}
                  className={cn(
                    "min-h-11 rounded-full border px-4 text-sm font-semibold",
                    dias === d
                      ? "border-marca bg-marca text-marca-foreground"
                      : "border-border bg-card text-foreground",
                  )}
                >
                  {d} dias
                </button>
              ))}
            </div>
            {q.isLoading ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : lista.length === 0 ? (
              <p className="text-sm">Nenhuma conversa parada há mais de {dias} dias.</p>
            ) : (
              <>
                <p className="text-sm font-semibold">
                  {escolhidas.length} de {lista.length} selecionadas. Toque para tirar alguém.
                </p>
                <ul className="flex flex-col gap-1.5">
                  {lista.map((c) => {
                    const dentro = !fora.has(c.id);
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          aria-pressed={dentro}
                          onClick={() => {
                            const n = new Set(fora);
                            if (dentro) n.add(c.id);
                            else n.delete(c.id);
                            setFora(n);
                          }}
                          className={cn(
                            "flex min-h-14 w-full items-center gap-3 rounded-botao border px-3 text-left",
                            dentro ? "border-marca bg-card" : "border-border bg-muted opacity-70",
                          )}
                        >
                          <span
                            aria-hidden
                            className={cn(
                              "grid size-6 shrink-0 place-items-center rounded-md border",
                              dentro
                                ? "border-marca bg-marca text-marca-foreground"
                                : "border-border bg-card",
                            )}
                          >
                            {dentro ? <Check className="size-4" /> : null}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-semibold">{c.nome}</span>
                            <span className="block text-xs text-muted-foreground">
                              Última mensagem {haQuanto(c.ultimaAtividade)}
                              {c.esperandoDesde ? " · marcada como esperando" : ""}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <Botao
                  tamanho="grande"
                  larguraTotal
                  disabled={encerrando || escolhidas.length === 0}
                  onClick={() => void encerrar()}
                >
                  {encerrando
                    ? "Encerrando…"
                    : `Encerrar ${escolhidas.length} ${escolhidas.length === 1 ? "conversa" : "conversas"}`}
                </Botao>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
