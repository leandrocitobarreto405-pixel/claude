// Configurações em grupos (lista em vez de abas). Sem acesso a banco, para poder testar.
import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Building2,
  CalendarCog,
  FileText,
  MessageSquareText,
  ShoppingBag,
  SlidersHorizontal,
} from "lucide-react";

export type GrupoConfig = {
  id: "empresa" | "vendas" | "agenda" | "mensagens" | "documentos" | "alice-leads" | "outros";
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
    descricao: "Dados nos documentos · Metas e custos · Equipe e acessos · Assinatura",
    icone: Building2,
    itens: ["Dados nos documentos", "Metas e custos", "Equipe e acessos", "Assinatura e faturas"],
  },
  {
    id: "vendas",
    rotulo: "Vendas",
    descricao: "Tabela de preços · Regras de orçamento · Descontos e promoções · Taxas · Produtos",
    icone: ShoppingBag,
    itens: [
      "Tabela de preços",
      "Regras de orçamento",
      "Descontos e promoções",
      "Taxas de pagamento",
      "Produtos",
    ],
  },
  {
    id: "agenda",
    rotulo: "Agenda",
    descricao: "Agenda e técnicos · Agenda dos técnicos no WhatsApp · Google Agenda",
    icone: CalendarCog,
    itens: ["Agenda e técnicos", "Agenda dos técnicos no WhatsApp", "Google Agenda"],
  },
  {
    id: "mensagens",
    rotulo: "Mensagens",
    descricao: "Modelos de mensagem · Respostas prontas · Mensagem padrão",
    icone: MessageSquareText,
    itens: ["Modelos de mensagem", "Respostas prontas", "Mensagem padrão"],
  },
  {
    id: "documentos",
    rotulo: "Documentos",
    descricao: "PDF da OS e textos · Modelos da OS (Google Drive)",
    icone: FileText,
    itens: ["PDF da OS e textos", "Modelos da OS (Google Drive)"],
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
  documentos: "documentos",
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
