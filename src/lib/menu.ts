// Menu do app (lateral no computador, "Mais" no celular) e os endereços antigos que mudaram.
// Sem acesso a banco, para poder testar. Quem monta a barra de baixo está em navegacao.ts.
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  CalendarDays,
  ClipboardList,
  Coins,
  FileSpreadsheet,
  Filter,
  HandCoins,
  Home,
  ListChecks,
  MessageCircle,
  MessageSquareText,
  MessagesSquare,
  Receipt,
  Send,
  Settings,
  Undo2,
  UserPlus,
} from "lucide-react";
import { podeAcessar, type Papel } from "@/lib/tenant";

export type ItemMenu = {
  to: string;
  rotulo: string;
  icone: LucideIcon;
  /** Outras rotas que deixam o item marcado (abas da mesma tela). */
  ativoEm?: string[];
  /** Só para estes papéis (sem a lista, vale o `podeAcessar`). */
  papeis?: Papel[];
};

export type GrupoMenu = { id: string; rotulo: string; itens: ItemMenu[]; soNexa?: boolean };

export const GRUPOS_MENU: GrupoMenu[] = [
  {
    id: "dia-a-dia",
    rotulo: "Dia a dia",
    itens: [
      { to: "/inicio", rotulo: "Início", icone: Home },
      { to: "/conversas", rotulo: "Conversas", icone: MessageCircle },
      { to: "/agenda", rotulo: "Agenda", icone: CalendarDays, ativoEm: ["/servicos", "/servico"] },
      {
        to: "/oss",
        rotulo: "OS e orçamentos",
        icone: ClipboardList,
        ativoEm: ["/orcamentos", "/nova-os", "/os"],
      },
      { to: "/mensagens", rotulo: "Confirmar amanhã", icone: MessageSquareText },
    ],
  },
  {
    id: "vendas",
    rotulo: "Vendas",
    itens: [
      { to: "/crm/funil", rotulo: "Funil", icone: Filter, ativoEm: ["/indicadores"] },
      {
        to: "/crm/leads",
        rotulo: "Leads",
        icone: UserPlus,
        ativoEm: ["/crm/leads-site", "/crm/lead"],
      },
      { to: "/crm/retornos", rotulo: "Retornos", icone: Undo2 },
      { to: "/marketing", rotulo: "Marketing WhatsApp", icone: Send, ativoEm: ["/listas"] },
    ],
  },
  {
    id: "financeiro",
    rotulo: "Financeiro",
    itens: [
      // Admin: Financeiro (Resumo, A receber, Recebidos, Despesas e DRE em abas).
      // Atendente: só A receber (a única aba que ela abre).
      {
        to: "/financeiro",
        rotulo: "Financeiro",
        icone: HandCoins,
        ativoEm: ["/a-receber", "/pagamentos", "/despesas", "/dre", "/origens"],
        papeis: ["admin"],
      },
      { to: "/a-receber", rotulo: "A receber", icone: HandCoins, papeis: ["atendente"] },
      { to: "/notas", rotulo: "Notas fiscais", icone: Receipt, papeis: ["admin"] },
      { to: "/exportacoes", rotulo: "Exportações", icone: FileSpreadsheet, papeis: ["admin"] },
    ],
  },
  {
    id: "empresa",
    rotulo: "Empresa",
    itens: [
      { to: "/configuracoes", rotulo: "Configurações", icone: Settings, papeis: ["admin"] },
      { to: "/implantacao", rotulo: "Primeiros passos", icone: ListChecks, papeis: ["admin"] },
    ],
  },
  {
    id: "nexa",
    rotulo: "Nexa",
    soNexa: true,
    itens: [
      { to: "/nexa/empresas", rotulo: "Empresas e comissões", icone: Building2 },
      { to: "/nexa/comissoes", rotulo: "Comissão da Nexa", icone: HandCoins },
      { to: "/nexa/chatwoot", rotulo: "Chatwoot", icone: MessagesSquare },
    ],
  },
];

/** Técnico: só a agenda e os serviços dele (o resto não existe para ele). */
const MENU_TECNICO: GrupoMenu[] = [
  {
    id: "dia-a-dia",
    rotulo: "Dia a dia",
    itens: [
      { to: "/agenda", rotulo: "Agenda", icone: CalendarDays },
      { to: "/servicos", rotulo: "Serviços", icone: ClipboardList, ativoEm: ["/os", "/servico"] },
    ],
  },
];

/**
 * Grupos do menu para o papel. "Primeiros passos" só aparece enquanto faltar etapa
 * (`primeirosPassos.faltam`); o rótulo ganha o progresso ("3 de 9").
 */
export function menuDoPapel(
  papel: Papel | null,
  souNexa = false,
  primeirosPassos: { faltam: boolean; progresso: string } | null = null,
): GrupoMenu[] {
  const base = papel === "tecnico" ? MENU_TECNICO : GRUPOS_MENU;
  const temEmpresa = papel !== null;
  return base
    .filter((g) => !g.soNexa || souNexa)
    .map((g) => ({
      ...g,
      itens: g.itens
        .filter(
          (i) => (temEmpresa || i.to.startsWith("/nexa")) && podeAcessar(papel, i.to, souNexa),
        )
        .filter((i) => !i.papeis || (papel !== null && i.papeis.includes(papel)) || souNexa)
        .filter((i) => i.to !== "/implantacao" || primeirosPassos?.faltam)
        .map((i) =>
          i.to === "/implantacao" && primeirosPassos
            ? { ...i, rotulo: `Primeiros passos · ${primeirosPassos.progresso}` }
            : i,
        ),
    }))
    .filter((g) => g.itens.length > 0);
}

/** O item está marcado nesta rota? (a própria, uma sub-rota ou uma aba da mesma tela). */
export function itemAtivo(item: Pick<ItemMenu, "to" | "ativoEm">, pathname: string): boolean {
  return [item.to, ...(item.ativoEm ?? [])].some(
    (r) => pathname === r || pathname.startsWith(`${r}/`),
  );
}

/** Endereços antigos → novos (links salvos e notificações continuam abrindo). */
export const REDIRECIONAMENTOS: Record<string, { to: string; search?: Record<string, string> }> = {
  "/avisos": { to: "/inicio", search: { avisos: "1" } },
  "/crm/repescagens": { to: "/crm/retornos" },
  "/crm/visao-geral": { to: "/indicadores" },
  "/usuarios": { to: "/configuracoes/equipe" },
};

/** Abas que uma tela mostra (cada aba é um endereço próprio). */
export const ABAS_DE_TELA = {
  agenda: [
    { to: "/agenda", rotulo: "Calendário" },
    { to: "/servicos", rotulo: "Serviços" },
  ],
  os: [
    { to: "/oss", rotulo: "OS" },
    { to: "/orcamentos", rotulo: "Orçamentos" },
  ],
  funil: [
    { to: "/crm/funil", rotulo: "Quadro" },
    { to: "/indicadores", rotulo: "Indicadores" },
  ],
  leads: [
    { to: "/crm/leads", rotulo: "Todos" },
    { to: "/crm/leads-site", rotulo: "Do site" },
  ],
  financeiro: [
    { to: "/financeiro", rotulo: "Resumo" },
    { to: "/a-receber", rotulo: "A receber" },
    { to: "/pagamentos", rotulo: "Recebidos" },
    { to: "/despesas", rotulo: "Despesas" },
    { to: "/dre", rotulo: "DRE" },
  ],
} as const;

/** Só as abas que a pessoa pode abrir (a atendente vê só "A receber" no Financeiro). */
export function abasPermitidas<T extends { to: string }>(
  abas: readonly T[],
  papel: Papel | null,
  souNexa = false,
): T[] {
  return abas.filter((a) => podeAcessar(papel, a.to, souNexa));
}
