import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Chip } from "@/components/nexa";
import { textoVariacao } from "@/lib/painel";
import { cn } from "@/lib/utils";

/**
 * Cartão de um número do painel: título pequeno, valor grande, detalhe e a variação em relação
 * ao período anterior. Com `to`, o cartão inteiro abre a lista daquele número.
 */
export function CartaoNumero({
  titulo,
  valor,
  legenda,
  detalhe,
  nota,
  variacao,
  to,
  search,
  carregando = false,
  destaque = false,
}: {
  titulo: string;
  valor: string;
  /** Linha curta dizendo o que o número mede (ex.: "entrou no caixa no período"). */
  legenda?: string | undefined;
  detalhe?: string | undefined;
  /** Observação em letra menor (ex.: "líquido do repasse: R$ X"). */
  nota?: string | undefined;
  /** undefined: sem chip; null: sem base de comparação ("—"). */
  variacao?: number | null;
  to?: string;
  search?: Record<string, string>;
  carregando?: boolean;
  /** Fundo levemente destacado (ex.: lucro). */
  destaque?: boolean;
}) {
  const conteudo = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
          {titulo}
        </span>
        {to ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : null}
      </span>
      <span className="font-titulo text-[22px] leading-tight break-words">
        {carregando ? "…" : valor}
      </span>
      {legenda ? (
        <span className="text-[11px] leading-snug text-muted-foreground italic">{legenda}</span>
      ) : null}
      {detalhe ? (
        <span className="text-xs leading-snug text-muted-foreground">{detalhe}</span>
      ) : null}
      {nota ? <span className="text-[11px] leading-snug text-muted-foreground">{nota}</span> : null}
      {variacao !== undefined ? (
        <Chip
          tom={variacao === null ? "neutro" : variacao >= 0 ? "sucesso" : "problema"}
          className="mt-auto self-start"
        >
          {carregando ? "…" : textoVariacao(variacao)}
        </Chip>
      ) : null}
    </>
  );
  const classe = cn(
    "flex min-h-28 flex-col gap-1.5 rounded-card border border-border bg-card p-3.5 text-left text-card-foreground",
    destaque && "bg-marca-claro/40",
  );
  return to ? (
    <Link
      to={to as never}
      search={(search ?? {}) as never}
      className={cn(classe, "hover:border-marca/40")}
      aria-label={`${titulo}: ${valor}`}
    >
      {conteudo}
    </Link>
  ) : (
    <div className={classe}>{conteudo}</div>
  );
}
