import { ChevronDown, MapPin, MessageCircle, Navigation, Phone } from "lucide-react";
import { Botao, Chip } from "@/components/nexa";
import { chipDoStatus, encerrado, type Atendimento } from "@/lib/agenda";

export type { Atendimento };
import { brl, mapsLink, telLink, timeBR, wazeLink, whatsappLink } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Cartão de um atendimento. Fechado: hora, cliente, resumo e etiqueta. Aberto: endereço e os
 * botões de rota (Google Maps, Waze), contato (WhatsApp, Ligar) e Detalhes.
 */
export function CartaoAtendimento({
  item,
  aberto,
  onAlternar,
  onDetalhes,
}: {
  item: Atendimento;
  aberto: boolean;
  onAlternar: () => void;
  onDetalhes: () => void;
}) {
  const chip =
    item.tipo === "orcamento" && !encerrado(item.status) && item.status !== "Em deslocamento"
      ? { rotulo: "Orçamento", tom: "neutro" as const }
      : chipDoStatus(item.status);
  const apagado = encerrado(item.status);
  const resumo = [
    item.peca,
    item.bairro,
    item.tecnico ?? "Sem técnico",
    item.valor ? brl(item.valor) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const maps = mapsLink(item.endereco);
  const waze = wazeLink(item.endereco);
  const whats = whatsappLink(item.telefone);
  const tel = telLink(item.telefone);
  const idCorpo = `atendimento-${item.id}`;

  return (
    <li
      className={cn(
        "rounded-card border bg-card",
        aberto ? "border-marca/30" : "border-border",
        apagado && !aberto && "bg-card/60",
      )}
    >
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={aberto}
        aria-controls={idCorpo}
        className="flex min-h-11 w-full items-start gap-3 rounded-card p-4 text-left"
      >
        <span
          className={cn(
            "w-12 shrink-0 pt-0.5 font-titulo text-[17px] leading-none",
            apagado && "text-muted-foreground",
          )}
        >
          {timeBR(item.hora)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span
            className={cn(
              "truncate text-[15px] font-bold leading-snug",
              apagado && "text-muted-foreground",
            )}
          >
            {item.cliente}
          </span>
          <span className={cn("text-[13px] text-muted-foreground", !aberto && "truncate")}>
            {aberto ? `${item.servico}${item.peca ? ` · ${item.peca}` : ""}` : resumo}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Chip tom={chip.tom}>{chip.rotulo}</Chip>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-4 text-muted-foreground transition-transform",
              aberto && "rotate-180",
            )}
          />
        </span>
      </button>

      {aberto ? (
        <div id={idCorpo} className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {[item.tecnico ?? "Sem técnico", item.valor ? brl(item.valor) : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {item.endereco ? (
              <span className="flex items-start gap-1.5">
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                {item.endereco}
              </span>
            ) : null}
            {item.nota ? (
              <span className="text-[13px] font-semibold text-atencao-foreground">{item.nota}</span>
            ) : null}
          </div>

          {maps || waze ? (
            <div className="grid grid-cols-2 gap-2">
              {maps ? (
                <Botao asChild variante="contorno">
                  <a href={maps} target="_blank" rel="noreferrer">
                    <MapPin /> Google Maps
                  </a>
                </Botao>
              ) : null}
              {waze ? (
                <Botao asChild variante="contorno">
                  <a href={waze} target="_blank" rel="noreferrer">
                    <Navigation /> Waze
                  </a>
                </Botao>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            {whats ? (
              <Botao asChild variante="neutro" className="px-2">
                <a href={whats} target="_blank" rel="noreferrer">
                  <MessageCircle /> WhatsApp
                </a>
              </Botao>
            ) : (
              <Botao variante="neutro" className="px-2" disabled>
                <MessageCircle /> WhatsApp
              </Botao>
            )}
            {tel ? (
              <Botao asChild variante="neutro" className="px-2">
                <a href={tel}>
                  <Phone /> Ligar
                </a>
              </Botao>
            ) : (
              <Botao variante="neutro" className="px-2" disabled>
                <Phone /> Ligar
              </Botao>
            )}
            <Botao variante="neutro" className="px-2" onClick={onDetalhes}>
              Detalhes
            </Botao>
          </div>
        </div>
      ) : null}
    </li>
  );
}
