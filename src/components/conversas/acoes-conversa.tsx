import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { devolverParaAlice } from "@/lib/alice.functions";
import { assumirConversaFn } from "@/lib/caixa-equipe.functions";
import type { ConversaCompleta } from "@/lib/conversas.functions";

/**
 * Ações de uma conversa (menu "⋮" da barra da conversa): assumir e devolver para a Alice. Chatwoot
 * primeiro: se ele falhar, nada muda e a tela avisa.
 */
export function useAcoesConversa(c: ConversaCompleta | undefined, onMudou: () => void) {
  const assumirFn = useServerFn(assumirConversaFn);
  const devolverFn = useServerFn(devolverParaAlice);
  const [ocupado, setOcupado] = useState(false);

  async function executar(acao: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await acao();
      toast.success(ok);
      onMudou();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setOcupado(false);
    }
  }

  const podeAssumir = Boolean(c && c.grupo !== "finalizadas" && !c.minha);
  const podeDevolver = Boolean(c && c.grupo !== "finalizadas" && c.grupo !== "alice");

  function assumir() {
    if (!c) return;
    void executar(
      () =>
        assumirFn({ data: { conversaId: c.id } }).then((r) => {
          if (!r.noChatwoot)
            toast.info("No Chatwoot ela fica sem responsável (você não tem usuário lá).");
        }),
      c.grupo === "alice"
        ? "Pronto: a Alice saiu e a conversa é sua."
        : c.responsavelNome
          ? `Agora é sua (estava com ${c.responsavelNome.split(" ")[0]}).`
          : "Agora a conversa é sua.",
    );
  }

  function devolver() {
    if (!c) return;
    if (c.iaDesligadaNoCliente) {
      toast.info("A Alice está desligada para este cliente; religue no menu para poder devolver.");
      return;
    }
    void executar(
      () => devolverFn({ data: { conversaId: c.id } }),
      "Devolvida: a Alice responde a próxima mensagem do cliente.",
    );
  }

  return { ocupado, podeAssumir, podeDevolver, assumir, devolver };
}
