import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/app-shell";
import { aliceNoCliente, devolverParaAlice, marcarAliceNoCliente } from "@/lib/alice.functions";

/** Controles da Alice para o cliente do lead: IA desligada, sem pós-venda e devolver a conversa. */
export function AliceNoLead({ leadId }: { leadId: string }) {
  const qc = useQueryClient();
  const situacaoFn = useServerFn(aliceNoCliente);
  const marcarFn = useServerFn(marcarAliceNoCliente);
  const devolverFn = useServerFn(devolverParaAlice);
  const chave = ["alice_no_lead", leadId];
  const q = useQuery({ queryKey: chave, queryFn: () => situacaoFn({ data: { leadId } }) });
  const [ocupado, setOcupado] = useState(false);

  const s = q.data;
  if (!s || (!s.aliceLigada && !s.contato?.ia_desligada && !s.contato?.sem_pos_venda)) return null;

  async function executar(acao: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await acao();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  const contato = s.contato;
  const conversa = s.conversa;
  return (
    <SectionCard title="Alice (IA)" accent="navy">
      <div className="grid gap-3 text-sm">
        <p className="flex items-center gap-2">
          <Bot className="size-4 text-primary" />
          {!s.aliceLigada
            ? "A Alice está desligada na empresa."
            : contato?.ia_desligada
              ? "IA desligada para este cliente: só a equipe atende."
              : conversa?.comAlice
                ? "A conversa está com a Alice."
                : conversa
                  ? "A conversa está com a equipe."
                  : "Ainda sem conversa no Chatwoot."}
        </p>

        {contato ? (
          <div className="grid gap-2">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={contato.ia_desligada}
                disabled={ocupado}
                onChange={(e) =>
                  void executar(
                    () =>
                      marcarFn({
                        data: { contatoId: contato.id, ia_desligada: e.target.checked },
                      }),
                    e.target.checked
                      ? "IA desligada: a Alice não atende nem faz follow-up com este cliente."
                      : "IA religada para este cliente.",
                  )
                }
              />
              <span>
                <strong>IA desligada</strong> neste cliente (sem respostas, follow-up nem pós-venda
                da Alice)
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={contato.sem_pos_venda}
                disabled={ocupado}
                onChange={(e) =>
                  void executar(
                    () =>
                      marcarFn({
                        data: { contatoId: contato.id, sem_pos_venda: e.target.checked },
                      }),
                    e.target.checked ? "Marcado como sem pós-venda." : "Pós-venda liberado.",
                  )
                }
              />
              <span>
                <strong>Sem pós-venda</strong> (não enviar satisfação, avaliação nem reativação)
              </span>
            </label>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {s.aliceLigada && conversa && !conversa.comAlice && !contato?.ia_desligada ? (
            <Button
              size="sm"
              disabled={ocupado}
              onClick={() =>
                void executar(
                  () => devolverFn({ data: { conversaId: conversa.id } }),
                  "Conversa devolvida para a Alice.",
                )
              }
            >
              Devolver para a Alice
            </Button>
          ) : null}
          {conversa?.url ? (
            <Button asChild size="sm" variant="outline">
              <a href={conversa.url} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" /> Abrir no Chatwoot
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </SectionCard>
  );
}
