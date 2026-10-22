// Barra fixa no topo da conversa, como no WhatsApp: voltar para a lista (só no celular), nome e
// telefone do cliente (toque abre os dados do contato) e o menu "⋮" com as ações da conversa.
import { useState } from "react";
import {
  Archive,
  ArrowLeft,
  Bot,
  BotOff,
  ExternalLink,
  Hand,
  MessageCircle,
  MoreVertical,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar } from "@/components/conversas/cartao-conversa";
import { DadosContato } from "@/components/conversas/dados-contato";
import { useAcoesConversa } from "@/components/conversas/acoes-conversa";
import { useTirarAlice } from "@/components/tirar-alice-estado";
import { useEncerrarConversas } from "@/lib/conversas-encerrar";
import { useVoltarParaLista } from "@/components/conversas/voltar-para-lista";
import type { ConversaCompleta } from "@/lib/conversas.functions";
import { whatsappLink } from "@/lib/format";
import { usePapel } from "@/lib/tenant";

const ITEM = "min-h-11 gap-3 text-[15px]";

export function CabecalhoConversa({ c, onMudou }: { c: ConversaCompleta; onMudou: () => void }) {
  const voltar = useVoltarParaLista();
  const [dadosAbertos, setDadosAbertos] = useState(false);
  const acoes = useAcoesConversa(c, onMudou);
  const tirar = useTirarAlice({ conversaId: c.id });
  const { encerrar, encerrando } = useEncerrarConversas();
  const { papel } = usePapel();
  const podeEncerrar = (papel === "admin" || papel === "atendente") && c.grupo !== "finalizadas";
  const whats = whatsappLink(c.telefone);

  return (
    <div className="flex min-h-14 items-center gap-1 border-b border-border bg-card px-1 lg:px-3">
      <button
        type="button"
        onClick={voltar}
        aria-label="Voltar para a lista"
        className="grid size-11 shrink-0 place-items-center rounded-full text-foreground hover:bg-muted lg:hidden"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setDadosAbertos(true)}
        className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-botao px-1 text-left hover:bg-muted"
        aria-label={`Dados do contato ${c.nome}`}
      >
        <Avatar nome={c.nome} className="size-10" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[15px] leading-tight font-bold">{c.nome}</span>
          <span className="truncate text-xs text-muted-foreground">
            {c.telefone ?? "Sem telefone"}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Mais ações da conversa"
          className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted"
        >
          <MoreVertical className="size-5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {acoes.podeAssumir ? (
            <DropdownMenuItem className={ITEM} disabled={acoes.ocupado} onSelect={acoes.assumir}>
              <Hand className="size-4" aria-hidden />
              {c.grupo === "alice" ? "Assumir a conversa" : "Assumir para mim"}
            </DropdownMenuItem>
          ) : null}
          {acoes.podeDevolver ? (
            <DropdownMenuItem className={ITEM} disabled={acoes.ocupado} onSelect={acoes.devolver}>
              <Bot className="size-4" aria-hidden />
              Devolver para a Alice
            </DropdownMenuItem>
          ) : null}
          {podeEncerrar ? (
            <DropdownMenuItem
              className={ITEM}
              disabled={encerrando}
              onSelect={() =>
                void encerrar([c.id], c.nome).then((ok) => {
                  if (ok) voltar();
                })
              }
            >
              <Archive className="size-4" aria-hidden />
              Encerrar
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={ITEM} disabled={!whats} asChild={Boolean(whats)}>
            {whats ? (
              <a href={whats} target="_blank" rel="noreferrer">
                <MessageCircle className="size-4" aria-hidden />
                Abrir no WhatsApp
              </a>
            ) : (
              <span>
                <MessageCircle className="size-4" aria-hidden />
                Abrir no WhatsApp
              </span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            className={ITEM}
            disabled={!c.urlChatwoot}
            asChild={Boolean(c.urlChatwoot)}
          >
            {c.urlChatwoot ? (
              <a href={c.urlChatwoot} target="_blank" rel="noreferrer">
                <ExternalLink className="size-4" aria-hidden />
                Abrir no Chatwoot
              </a>
            ) : (
              <span>
                <ExternalLink className="size-4" aria-hidden />
                Abrir no Chatwoot
              </span>
            )}
          </DropdownMenuItem>
          {tirar.c ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={ITEM}
                disabled={tirar.ocupado}
                onSelect={() => void tirar.alternar()}
              >
                <BotOff className="size-4" aria-hidden />
                {tirar.c.ia_desligada
                  ? "Devolver a Alice a esta cliente"
                  : "Tirar a Alice desta cliente"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <DadosContato c={c} aberto={dadosAbertos} aoMudar={setDadosAbertos} />
    </div>
  );
}
