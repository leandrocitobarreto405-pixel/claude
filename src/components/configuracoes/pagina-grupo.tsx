import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { CabecalhoDeTela, Recolhido } from "@/components/nexa";
import { GRUPOS_CONFIG, type GrupoConfig } from "@/lib/configuracoes-grupos";

/** Cabeçalho de uma página de grupo das Configurações, com o voltar. */
export function PaginaGrupo({
  grupo,
  descricao,
  children,
}: {
  grupo: GrupoConfig["id"];
  descricao?: string;
  children: React.ReactNode;
}) {
  const g = GRUPOS_CONFIG.find((x) => x.id === grupo)!;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        sobretitulo="Configurações"
        titulo={g.rotulo}
        voltarPara="/configuracoes"
        {...(descricao ? { descricao } : {})}
      />
      {children}
    </div>
  );
}

/** Seção que abre e fecha (a primeira da página vem aberta). */
export function SecaoConfig({
  titulo,
  aberta = false,
  children,
}: {
  titulo: string;
  aberta?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Recolhido titulo={titulo} abertoInicial={aberta}>
      <div className="p-4">{children}</div>
    </Recolhido>
  );
}

/** Atalho para uma tela própria (ex.: Rotas e quilometragem) a partir do grupo. */
export function LinkDeConfig({
  to,
  titulo,
  descricao,
  icone: Icone,
}: {
  to: string;
  titulo: string;
  descricao: string;
  icone: LucideIcon;
}) {
  return (
    <Link
      to={to as never}
      className="flex min-h-14 items-center gap-3 rounded-card border border-border bg-card px-4 py-3 hover:border-marca/40"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-marca-claro text-marca">
        <Icone className="size-5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-bold">{titulo}</span>
        <span className="text-sm text-muted-foreground">{descricao}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
