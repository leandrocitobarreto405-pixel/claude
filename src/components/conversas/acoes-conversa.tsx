import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, ExternalLink, Hand, MessageCircle } from "lucide-react";
import { Botao } from "@/components/nexa";
import { devolverParaAlice, pararAliceNaConversa } from "@/lib/alice.functions";
import type { ConversaCompleta } from "@/lib/conversas.functions";
import { whatsappLink } from "@/lib/format";

/**
 * Ações de uma conversa. Responder ainda é no WhatsApp ou no Chatwoot; daqui dá para abrir
 * os dois e passar a conversa entre a Alice e a equipe. Esta é a parte que muda quando o
 * Chatwoot for trocado pela API oficial do WhatsApp.
 */
export function AcoesConversa({ c, onMudou }: { c: ConversaCompleta; onMudou: () => void }) {
  const pararFn = useServerFn(pararAliceNaConversa);
  const devolverFn = useServerFn(devolverParaAlice);
  const [ocupado, setOcupado] = useState(false);
  const whats = whatsappLink(c.telefone);

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

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {whats ? (
          <Botao asChild>
            <a href={whats} target="_blank" rel="noreferrer">
              <MessageCircle /> WhatsApp
            </a>
          </Botao>
        ) : (
          <Botao disabled>
            <MessageCircle /> WhatsApp
          </Botao>
        )}
        {c.urlChatwoot ? (
          <Botao asChild variante="contorno">
            <a href={c.urlChatwoot} target="_blank" rel="noreferrer">
              <ExternalLink /> Chatwoot
            </a>
          </Botao>
        ) : (
          <Botao variante="contorno" disabled>
            <ExternalLink /> Chatwoot
          </Botao>
        )}
      </div>
      {c.grupo === "alice" ? (
        <Botao
          variante="neutro"
          larguraTotal
          disabled={ocupado}
          onClick={() =>
            void executar(
              () => pararFn({ data: { conversaId: c.id } }),
              "Pronto: a Alice saiu da conversa. Agora é com a equipe.",
            )
          }
        >
          <Hand /> {ocupado ? "Assumindo…" : "Assumir a conversa"}
        </Botao>
      ) : c.grupo !== "finalizadas" ? (
        <Botao
          variante="neutro"
          larguraTotal
          disabled={ocupado || c.iaDesligadaNoCliente}
          onClick={() =>
            void executar(
              () => devolverFn({ data: { conversaId: c.id } }),
              "Devolvida: a Alice responde a próxima mensagem do cliente.",
            )
          }
        >
          <Bot /> {ocupado ? "Devolvendo…" : "Devolver para a Alice"}
        </Botao>
      ) : null}
      {c.iaDesligadaNoCliente && c.grupo !== "alice" ? (
        <p className="text-xs text-muted-foreground">
          A Alice está desligada para este cliente; religue no lead para poder devolver.
        </p>
      ) : null}
    </div>
  );
}
