import { Link } from "@tanstack/react-router";
import { User } from "lucide-react";
import { Chip } from "@/components/nexa";
import { haQuanto, iniciais } from "@/lib/conversas";
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
  if (c.grupo === "precisam") {
    return c.passagem?.posVenda ? (
      <Chip tom="problema">Pós-venda</Chip>
    ) : c.passagem ? (
      <Chip tom="atencao" className="max-w-full truncate">
        {c.passagem.motivo}
      </Chip>
    ) : (
      <Chip tom="atencao">Esperando resposta</Chip>
    );
  }
  return (
    <>
      {c.temperatura === "QUENTE" ? <Chip tom="problema">Quente</Chip> : null}
      {c.etapa ? (
        <Chip tom={c.grupo === "finalizadas" ? "sucesso" : "neutro"}>{c.etapa}</Chip>
      ) : null}
    </>
  );
}

/** Linha da lista de conversas; o cartão inteiro abre a conversa. */
export function CartaoConversa({ c, agora }: { c: ConversaResumo; agora: Date }) {
  const espera = c.grupo === "precisam" && c.esperandoDesde;
  return (
    <li>
      <Link
        to="/conversas/$conversaId"
        params={{ conversaId: c.id }}
        className="flex min-h-11 gap-3 rounded-card border border-border bg-card p-4 hover:border-marca/40"
      >
        <Avatar nome={c.nome} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-bold">{c.nome}</span>
            <span
              className={cn(
                "shrink-0 text-xs",
                espera ? "font-bold text-atencao-foreground" : "text-muted-foreground",
              )}
            >
              {espera
                ? `esperando ${haQuanto(c.esperandoDesde, agora)}`
                : haQuanto(c.ultimaEm, agora)}
            </span>
          </span>
          {c.ultimaMensagem ? (
            <span className="line-clamp-2 text-sm text-muted-foreground">
              {c.ultimaDoCliente ? "" : "Enviada: "}
              {c.ultimaMensagem}
            </span>
          ) : null}
          <span className="flex flex-wrap gap-1.5 pt-0.5">
            <EtiquetasConversa c={c} />
          </span>
        </span>
      </Link>
    </li>
  );
}
