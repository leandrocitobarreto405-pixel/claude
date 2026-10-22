import { Link } from "@tanstack/react-router";
import { Check, User } from "lucide-react";
import { Chip } from "@/components/nexa";
import { esperaCurta, haQuanto, horaNaLista, iniciais, semRespostaHaMuito } from "@/lib/conversas";
import { marcarAbertaPelaLista } from "@/lib/conversas-tela";
import type { ConversaResumo } from "@/lib/conversas.functions";
import { cn } from "@/lib/utils";

/** Círculo com as iniciais do cliente (ou um ícone, quando só há o telefone). */
export function Avatar({ nome, className }: { nome: string; className?: string }) {
  const ini = iniciais(nome);
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-11 shrink-0 place-items-center rounded-full bg-marca-claro text-sm font-bold text-marca",
        className,
      )}
    >
      {ini || <User className="size-5" />}
    </span>
  );
}

/** Etiqueta da conversa: motivo da passagem, temperatura/etapa do lead ou situação. */
export function EtiquetasConversa({ c }: { c: ConversaResumo }) {
  if (c.grupo === "finalizadas") {
    return (
      <>
        <Chip tom="neutro">
          {c.encerradaPorTempo ? "Encerrada por tempo" : "Encerrada pela equipe"}
        </Chip>
        {c.etapa ? <Chip tom="sucesso">{c.etapa}</Chip> : null}
      </>
    );
  }
  if (c.grupo === "precisam") {
    return (
      <>
        {c.passagem?.posVenda ? (
          <Chip tom="problema">Pós-venda</Chip>
        ) : c.passagem ? (
          <Chip tom="atencao" className="max-w-full truncate">
            {c.passagem.motivo}
          </Chip>
        ) : (
          <Chip tom="atencao">Esperando resposta</Chip>
        )}
        {c.minha ? (
          <Chip tom="sucesso">Com você</Chip>
        ) : c.responsavelNome ? (
          <Chip tom="neutro">Com {c.responsavelNome.split(" ")[0]}</Chip>
        ) : null}
      </>
    );
  }
  return (
    <>
      {c.minha ? (
        <Chip tom="sucesso">Com você</Chip>
      ) : c.responsavelNome ? (
        <Chip tom="neutro">Com {c.responsavelNome.split(" ")[0]}</Chip>
      ) : null}
      {c.temperatura === "QUENTE" ? <Chip tom="problema">Quente</Chip> : null}
      {c.etapa ? <Chip tom="neutro">{c.etapa}</Chip> : null}
    </>
  );
}

/** Ponto colorido da conversa (detalhe pequeno, sem aumentar a altura da linha). */
function pontoDaConversa(c: ConversaResumo): { cor: string; rotulo: string } | null {
  if (c.passagem?.posVenda) return { cor: "bg-problema-foreground", rotulo: "Pós-venda" };
  if (c.minha) return { cor: "bg-marca", rotulo: "Com você" };
  if (c.temperatura === "QUENTE") return { cor: "bg-problema-foreground", rotulo: "Quente" };
  if (c.passagem) return { cor: "bg-atencao-foreground", rotulo: c.passagem.motivo };
  return null;
}

/**
 * Linha da lista de conversas, como no WhatsApp: avatar, nome (negrito com não lida) e a última
 * mensagem numa linha só; à direita a hora e a bolinha de não lidas. Etiquetas viram um ponto
 * colorido e "sem resposta há X h" um detalhe curto na linha da mensagem. Com `selecao`, tocar
 * marca e desmarca (para encerrar várias).
 */
export function CartaoConversa({
  c,
  agora,
  selecao,
}: {
  c: ConversaResumo;
  agora: Date;
  encerravel?: boolean;
  selecao?: { marcada: boolean; alternar: () => void } | undefined;
}) {
  const espera = c.grupo === "precisam" && c.esperandoDesde;
  const naoLida = c.naoLidas > 0;
  const ponto = pontoDaConversa(c);
  const comQuem = !c.minha && c.responsavelNome ? `com ${c.responsavelNome.split(" ")[0]}` : null;
  const encerrada =
    c.grupo === "finalizadas" ? (c.encerradaPorTempo ? "por tempo" : "pela equipe") : null;
  const conteudo = (
    <>
      {selecao ? (
        <span
          aria-hidden
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-md border",
            selecao.marcada
              ? "border-marca bg-marca text-marca-foreground"
              : "border-border bg-card",
          )}
        >
          {selecao.marcada ? <Check className="size-4" /> : null}
        </span>
      ) : null}
      <Avatar nome={c.nome} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn("truncate text-[15px]", naoLida ? "font-bold" : "font-semibold")}>
            {c.nome}
          </span>
          <span
            className={cn(
              "shrink-0 text-xs",
              naoLida ? "font-bold text-marca" : "text-muted-foreground",
            )}
          >
            {horaNaLista(c.ultimaEm, agora)}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {ponto ? (
            <span
              className={cn("size-2 shrink-0 rounded-full", ponto.cor)}
              title={ponto.rotulo}
              aria-label={ponto.rotulo}
            />
          ) : null}
          {espera ? (
            <span
              className={cn(
                "shrink-0 text-xs font-bold",
                semRespostaHaMuito(c.esperandoDesde, agora)
                  ? "text-problema-foreground"
                  : "text-atencao-foreground",
              )}
              title={`sem resposta ${haQuanto(c.esperandoDesde, agora)}`}
            >
              {esperaCurta(c.esperandoDesde, agora)}
            </span>
          ) : null}
          {comQuem || encerrada ? (
            <span className="shrink-0 text-xs text-muted-foreground">{comQuem ?? encerrada} ·</span>
          ) : null}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              naoLida ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {c.ultimaMensagem ? `${c.ultimaDoCliente ? "" : "Você: "}${c.ultimaMensagem}` : ""}
          </span>
          {naoLida ? (
            <span
              aria-label={`${c.naoLidas} não lidas`}
              className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-marca px-1.5 text-[11px] font-bold text-marca-foreground"
            >
              {c.naoLidas > 99 ? "99+" : c.naoLidas}
            </span>
          ) : null}
        </span>
      </span>
    </>
  );
  return (
    <li className="border-b border-border last:border-b-0">
      {selecao ? (
        <button
          type="button"
          aria-pressed={selecao.marcada}
          onClick={selecao.alternar}
          className={cn(
            "flex min-h-16 w-full items-center gap-3 px-3 py-2",
            selecao.marcada && "bg-marca-claro/60",
          )}
        >
          {conteudo}
        </button>
      ) : (
        <Link
          to="/conversas/$conversaId"
          params={{ conversaId: c.id }}
          onClick={marcarAbertaPelaLista}
          className="flex min-h-16 items-center gap-3 px-3 py-2 hover:bg-muted/60"
          activeProps={{ className: "bg-marca-claro/60" }}
        >
          {conteudo}
        </Link>
      )}
    </li>
  );
}
