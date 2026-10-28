/**
 * Recursos por plano (decisão de 26/10/2026). Quais planos têm cada recurso fica no banco
 * (planos.recursos, editável só pela Nexa); aqui ficam as telas de cada recurso, para a trava da
 * tela e o cadeado do menu. O que não tem recurso é do Essencial (todos os planos têm).
 */
export type Recurso =
  | "caixa_entrada"
  | "crm"
  | "deslocamento_rotas"
  | "cupons"
  | "marketing"
  | "vendas_origem"
  | "dre_comissoes"
  | "alice";

export const RECURSOS: Array<{ chave: Recurso; rotulo: string; rotas: string[]; telas: string }> = [
  {
    chave: "caixa_entrada",
    rotulo: "Caixa de entrada do WhatsApp",
    rotas: ["/conversas"],
    telas: "Conversas, respostas prontas, digitando e encerramento automático",
  },
  {
    chave: "crm",
    rotulo: "CRM e funil de leads",
    rotas: ["/crm", "/indicadores"],
    telas:
      "Vendas: Dashboard, Follow-ups (retornos, sem desfecho, do site), Leads (lista e quadro)",
  },
  {
    chave: "deslocamento_rotas",
    rotulo: "Taxa de deslocamento e rotas/km",
    rotas: ["/rotas"],
    telas: "Taxa de deslocamento nas regras de orçamento, Rotas e quilometragem",
  },
  { chave: "cupons", rotulo: "Cupons", rotas: [], telas: "Cupons e cupom no orçamento" },
  {
    chave: "marketing",
    rotulo: "Campanhas e reativação",
    rotas: ["/marketing", "/listas", "/promocao"],
    telas: "Marketing WhatsApp (campanhas, reativação, listas, horários livres)",
  },
  {
    chave: "vendas_origem",
    rotulo: "Vendas por origem",
    rotas: ["/origens"],
    telas: "Vendas por origem",
  },
  {
    chave: "dre_comissoes",
    rotulo: "DRE e comissões",
    rotas: ["/dre", "/comissoes"],
    telas: "DRE, Comissões",
  },
  {
    chave: "alice",
    rotulo: "Alice (IA)",
    rotas: [],
    telas: "Alice atendendo e orçando, responder em áudio",
  },
];

export const CHAVES_RECURSO = RECURSOS.map((r) => r.chave);

function combina(rota: string, pathname: string) {
  return pathname === rota || pathname.startsWith(`${rota}/`);
}

/** Recurso exigido por uma tela (null = Essencial). */
export function recursoDaRota(pathname: string): Recurso | null {
  return RECURSOS.find((r) => r.rotas.some((rota) => combina(rota, pathname)))?.chave ?? null;
}

export type PlanoPublico = {
  codigo: string;
  nome: string;
  preco_mensal: number | null;
  recursos: Record<string, boolean>;
};

export type PlanoDaEmpresa = {
  plano: string | null;
  plano_nome: string | null;
  recursos: Record<string, boolean>;
  limite_usuarios: number | null;
  usuarios_extras: number;
  usuarios_em_uso: number;
  planos: PlanoPublico[];
};

/** A empresa tem o recurso? (sem plano carregado ainda: não trava, para a tela não piscar) */
export function temRecurso(p: PlanoDaEmpresa | null | undefined, r: Recurso): boolean {
  if (!p) return true;
  return p.recursos[r] === true;
}

/** Primeiro plano público (mais barato) que tem o recurso: "Disponível no plano X". */
export function planoQueTem(p: PlanoDaEmpresa | null | undefined, r: Recurso): PlanoPublico | null {
  return (p?.planos ?? []).find((x) => x.recursos[r] === true) ?? null;
}

/** Situação do limite de usuários (admin e atendente; técnicos não contam). */
export function situacaoUsuarios(p: PlanoDaEmpresa | null | undefined): {
  limite: number | null;
  emUso: number;
  noLimite: boolean;
} {
  const limite = p?.limite_usuarios ?? null;
  const emUso = p?.usuarios_em_uso ?? 0;
  return { limite, emUso, noLimite: limite !== null && emUso >= limite };
}

export function rotuloRecurso(r: Recurso): string {
  return RECURSOS.find((x) => x.chave === r)?.rotulo ?? r;
}
