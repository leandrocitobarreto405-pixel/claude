import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { encerrarEscolhidasFn } from "@/lib/conversas-limpeza.functions";

/** Pergunta, encerra no Chatwoot e atualiza as listas. Devolve se encerrou. */
export function useEncerrarConversas() {
  const qc = useQueryClient();
  const fn = useServerFn(encerrarEscolhidasFn);
  const [encerrando, setEncerrando] = useState(false);
  async function encerrar(ids: string[], quem: string): Promise<boolean> {
    if (!ids.length) return false;
    const pergunta =
      ids.length === 1
        ? `Encerrar a conversa com ${quem} no Chatwoot? Se o cliente escrever de novo, a conversa reabre.`
        : `Encerrar ${ids.length} conversas no Chatwoot? Se o cliente escrever de novo, a conversa reabre.`;
    if (!window.confirm(pergunta)) return false;
    setEncerrando(true);
    try {
      const r = await fn({ data: { ids } });
      if (r.falhas && !r.encerradas)
        toast.error("Não foi possível encerrar no Chatwoot. Tente de novo em instantes.");
      else if (r.falhas)
        toast.error(
          `${r.encerradas} ${r.encerradas === 1 ? "encerrada" : "encerradas"}; ${r.falhas} ${r.falhas === 1 ? "não pôde" : "não puderam"} ser encerrada${r.falhas === 1 ? "" : "s"} no Chatwoot.`,
        );
      else if (!r.encerradas) toast.info("Essas conversas já estavam encerradas.");
      else
        toast.success(
          r.encerradas === 1 ? "Conversa encerrada." : `${r.encerradas} conversas encerradas.`,
        );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["conversas"] }),
        qc.invalidateQueries({ queryKey: ["alice_resumo_hoje"] }),
      ]);
      return r.encerradas > 0;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível encerrar.");
      return false;
    } finally {
      setEncerrando(false);
    }
  }
  return { encerrar, encerrando };
}
