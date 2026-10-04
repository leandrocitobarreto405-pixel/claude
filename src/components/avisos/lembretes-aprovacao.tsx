import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, MessageCircle, X } from "lucide-react";
import { Botao, Card, Chip } from "@/components/nexa";
import { decidirLembretesFn, lembretesParaAprovarFn } from "@/lib/marketing.functions";

export const CHAVE_LEMBRETES = ["avisos", "lembretes"] as const;

/**
 * Lembretes do dia (6 meses da higienização e 13º mês da impermeabilização) esperando aprovação:
 * quantidade, prévia com contatos reais e "Aprovar envio" / "Não enviar" (só o admin decide).
 */
export function LembretesParaAprovar() {
  const qc = useQueryClient();
  const lerFn = useServerFn(lembretesParaAprovarFn);
  const decidirFn = useServerFn(decidirLembretesFn);
  const q = useQuery({
    queryKey: CHAVE_LEMBRETES,
    queryFn: () => lerFn(),
    refetchInterval: 120_000,
  });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const r = q.data;
  if (!r || r.lotes.length === 0) return null;

  async function decidir(loteId: string, aprovar: boolean, n: number) {
    const pergunta = aprovar
      ? `Enviar ${n} ${n === 1 ? "lembrete" : "lembretes"} a partir de agora?`
      : `Não enviar ${n === 1 ? "este lembrete" : `estes ${n} lembretes`}?`;
    if (!window.confirm(pergunta)) return;
    setOcupado(loteId);
    try {
      const res = await decidirFn({ data: { loteId, aprovar } });
      toast.success(
        aprovar ? `Aprovado: ${res.envios} na fila.` : `${res.envios} lembretes cancelados.`,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: CHAVE_LEMBRETES }),
        qc.invalidateQueries({ queryKey: ["avisos"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <section aria-label="Lembretes para aprovar" className="flex flex-col gap-2.5">
      {r.lotes.map((l) => (
        <Card key={l.id} className="gap-3 border-atencao-foreground/30">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-atencao text-atencao-foreground">
              <MessageCircle className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold leading-snug">
                Lembretes para aprovar: {l.titulo}
              </p>
              <p className="text-sm text-muted-foreground">
                {l.quantidade} {l.quantidade === 1 ? "mensagem pronta" : "mensagens prontas"}. Nada
                sai antes da sua aprovação.
              </p>
            </div>
            <Chip tom="atencao">{l.quantidade}</Chip>
          </div>
          {l.previa.length ? (
            <ul className="flex flex-col gap-2">
              {l.previa.map((p, i) => (
                <li key={i} className="rounded-card bg-marca-claro p-3 text-sm leading-relaxed">
                  <span className="mb-1 block text-xs font-semibold text-muted-foreground">
                    Para {p.nome || "cliente sem nome"}
                  </span>
                  {p.texto ?? (
                    <span className="text-problema-foreground">
                      {p.erro ?? "Não deu para montar a prévia."}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {l.problemas.map((p) => (
            <p
              key={p}
              className="rounded-botao bg-atencao px-3 py-2 text-xs text-atencao-foreground"
            >
              {p}
            </p>
          ))}
          {r.admin ? (
            <div className="flex flex-wrap gap-2">
              <Botao
                disabled={ocupado !== null || l.quantidade === 0}
                onClick={() => void decidir(l.id, true, l.quantidade)}
              >
                <Check /> Aprovar envio
              </Botao>
              <Botao
                variante="contorno"
                disabled={ocupado !== null}
                onClick={() => void decidir(l.id, false, l.quantidade)}
              >
                <X /> Não enviar
              </Botao>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Só o administrador aprova.</p>
          )}
        </Card>
      ))}
    </section>
  );
}
