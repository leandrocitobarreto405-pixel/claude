// Configurações em grupos (lista em vez de abas). Sem acesso a banco, para poder testar.
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Building2,
  CalendarCog,
  MessageSquareText,
  ShoppingBag,
  SlidersHorizontal,
} from "lucide-react";

export type GrupoConfig = {
  id: "empresa" | "vendas" | "agenda" | "mensagens" | "alice-leads" | "outros";
  rotulo: string;
  descricao: string;
  icone: LucideIcon;
  /** O que há dentro (aparece na lista). */
  itens: string[];
};

export const GRUPOS_CONFIG: GrupoConfig[] = [
  {
    id: "empresa",
    rotulo: "Empresa",
    descricao: "Metas e custos · Equipe e acessos",
    icone: Building2,
    itens: ["Metas e custos", "Equipe e acessos"],
  },
  {
    id: "vendas",
    rotulo: "Vendas",
    descricao: "Tabela de preços · Regras de orçamento · Taxas · Produtos",
    icone: ShoppingBag,
    itens: ["Tabela de preços", "Regras de orçamento", "Taxas de pagamento", "Produtos"],
  },
  {
    id: "agenda",
    rotulo: "Agenda",
    descricao: "Agenda e promoção · Google Agenda",
    icone: CalendarCog,
    itens: ["Agenda e promoção", "Google Agenda"],
  },
  {
    id: "mensagens",
    rotulo: "Mensagens",
    descricao: "Modelos de mensagem · Mensagem padrão · Modelos da OS",
    icone: MessageSquareText,
    itens: ["Modelos de mensagem", "Mensagem padrão", "Modelos da OS"],
  },
  {
    id: "alice-leads",
    rotulo: "Alice, leads e marketing",
    descricao:
      "Alice · Leads do site · Listas de marketing · Integrações · Importar · Campanhas Google",
    icone: Bot,
    itens: [
      "Alice",
      "Leads do site",
      "Listas de marketing",
      "Integrações",
      "Importar histórico",
      "Campanhas Google",
    ],
  },
  {
    id: "outros",
    rotulo: "Outros",
    descricao: "Despesas recorrentes · Rotas e quilometragem · Notificações",
    icone: SlidersHorizontal,
    itens: ["Despesas recorrentes", "Rotas e quilometragem", "Notificações no celular"],
  },
];

export function rotaDoGrupo(id: GrupoConfig["id"]): string {
  return `/configuracoes/${id}`;
}

/** As abas antigas (`/configuracoes?aba=X`) caem no grupo que tem aquele conteúdo. */
const GRUPO_DA_ABA: Record<string, GrupoConfig["id"]> = {
  meta: "empresa",
  equipe: "empresa",
  precos: "vendas",
  orcamento: "vendas",
  taxas: "vendas",
  produtos: "vendas",
  agenda: "agenda",
  mensagem: "mensagens",
  documentos: "mensagens",
  alice: "alice-leads",
  "leads-site": "alice-leads",
  listas: "alice-leads",
  recorrentes: "outros",
};

export function rotaDaAbaAntiga(aba: string | undefined): string | null {
  if (!aba) return null;
  if (aba === "equipe") return "/configuracoes/equipe";
  const grupo = GRUPO_DA_ABA[aba];
  return grupo ? rotaDoGrupo(grupo) : null;
}
