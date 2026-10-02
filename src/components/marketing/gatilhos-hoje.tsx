import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, ExternalLink, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, SectionCard } from "@/components/app-shell";
import { gatilhosDeHoje, marcarGatilhoFn, NOMES_GRUPOS } from "@/lib/marketing.functions";
import { dateBR } from "@/lib/format";
import { CHAVE_MKT } from "./campanha-card";

/** O que é cada toque, pelo gatilho (vale para qualquer nome de modelo da empresa). */
const GATILHO_TEXTO: Record<string, string> = {
  C1: "Pós-venda: como ficou o serviço?",
  C2: "6 meses da higienização",
  C3: "13º mês da impermeabilização",
  C3L: "Lembrete do 13º mês",
};

/** Toques do dia que ficaram para envio manual (flag do gatilho desligada). */
export function GatilhosHoje({ admin, ligados }: { admin: boolean; ligados: string[] }) {
  const qc = useQueryClient();
  const listarFn = useServerFn(gatilhosDeHoje);
  const marcarFn = useServerFn(marcarGatilhoFn);
  const q = useQuery({ queryKey: [...CHAVE_MKT, "gatilhos"], queryFn: () => listarFn() });
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function marcar(id: string, acao: "enviado" | "descartar") {
    setOcupado(id);
    try {
      await marcarFn({ data: { envioId: id, acao } });
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível marcar.");
    } finally {
      setOcupado(null);
    }
  }

  const lista = q.data ?? [];
  return (
    <SectionCard
      icon={Zap}
      title="Gatilhos de hoje"
      description={`Pós-venda (C1), 6 meses da higienização (C2) e 13º mês da impermeabilização (C3), gerados todo dia às 9h. ${
        ligados.length
          ? `Automáticos: ${ligados.join(", ")}. Os demais ficam aqui para enviar pelo celular.`
          : "Os envios automáticos estão desligados: mande pelo celular e marque aqui."
      }`}
    >
      {!lista.length ? (
        <EmptyState title="Nada para enviar à mão agora." />
      ) : (
        <ul className="grid gap-2 text-sm">
          {lista.map((e) => {
            const c = e.mkt_contatos as {
              nome: string | null;
              primeiro_nome: string | null;
              ultimo_servico_em: string | null;
              ultimo_servico_tipo: string | null;
            } | null;
            return (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {c?.nome ?? "Sem nome"}{" "}
                    <a
                      className="text-primary underline-offset-2 hover:underline"
                      href={`https://wa.me/${e.normalized_phone}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {e.normalized_phone} <ExternalLink className="inline h-3 w-3" />
                    </a>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.grupo} · {NOMES_GRUPOS[e.grupo ?? ""] ?? ""} ·{" "}
                    {GATILHO_TEXTO[
                      (e.mkt_campanhas as { gatilho?: string | null } | null)?.gatilho ?? ""
                    ] ?? e.template_nome}
                    {e.variante_sn ? " (sem nome)" : ""}
                    {c?.ultimo_servico_em ? ` · serviço em ${dateBR(c.ultimo_servico_em)}` : ""}
                    {" · gerado em "}
                    {dateBR(e.created_at)}
                  </p>
                </div>
                {admin && (
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={ocupado !== null}
                      onClick={() => marcar(e.id, "enviado")}
                    >
                      <Check className="mr-1 h-4 w-4" /> Enviei
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={ocupado !== null}
                      onClick={() => marcar(e.id, "descartar")}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
