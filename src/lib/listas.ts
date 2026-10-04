/**
 * Listas de leads: famílias com filtros acumulados "até X dias", calculadas pelo banco a partir
 * das datas do CRM (private.mkt_publico). Aqui ficam só os nomes, as explicações e as opções,
 * sem banco nem rede, para poder testar. Nada de códigos (N1, C4…) na tela.
 */

export type Familia = "orcamento" | "conversa" | "clientes" | "perdido_preco" | "agendado";

/** Filtro de uma família: dias desde a data da família. Sem "ate" = todos. */
export type FiltroFamilia = { ate?: number; de?: number };
export type Filtros = Partial<Record<Familia, FiltroFamilia>>;

export type OpcaoLista = {
  chave: string;
  familia: Familia;
  filtro: FiltroFamilia;
  /** Rótulo curto da opção ("até 10 dias"). */
  rotulo: string;
};

export type DefFamilia = {
  familia: Familia;
  nome: string;
  explicacao: string;
  /** Data que conta os dias ("do orçamento", "do último serviço"). */
  dataDe: string | null;
  opcoes: OpcaoLista[];
};

const ate = (familia: Familia, dias: number | null, rotulo: string): OpcaoLista => ({
  chave: `${familia}_${dias ?? "todos"}`,
  familia,
  filtro: dias === null ? {} : { ate: dias },
  rotulo,
});

export const FAMILIAS: DefFamilia[] = [
  {
    familia: "orcamento",
    nome: "Orçamento sem agendamento",
    explicacao:
      "Pediram orçamento e ainda não marcaram o serviço. Conta os dias desde o orçamento mais recente.",
    dataDe: "do orçamento",
    opcoes: [
      ate("orcamento", 10, "até 10 dias"),
      ate("orcamento", 20, "até 20 dias"),
      ate("orcamento", 30, "até 30 dias"),
      ate("orcamento", 60, "até 60 dias"),
      ate("orcamento", 90, "até 90 dias"),
      ate("orcamento", 365, "até 1 ano"),
      ate("orcamento", null, "todos"),
    ],
  },
  {
    familia: "conversa",
    nome: "Conversou e não pediu orçamento",
    explicacao:
      "Falaram com a empresa pelo WhatsApp, mas não chegaram a pedir orçamento. Conta os dias desde a última conversa.",
    dataDe: "da conversa",
    opcoes: [
      ate("conversa", 10, "até 10 dias"),
      ate("conversa", 20, "até 20 dias"),
      ate("conversa", 30, "até 30 dias"),
      ate("conversa", null, "todos"),
    ],
  },
  {
    familia: "clientes",
    nome: "Clientes",
    explicacao:
      "Já fizeram serviço. Conta os dias desde o último serviço. Quem é cliente continua aqui mesmo se pedir um orçamento novo.",
    dataDe: "do último serviço",
    opcoes: [
      ate("clientes", 30, "até 30 dias"),
      ate("clientes", 90, "até 3 meses"),
      ate("clientes", 180, "até 6 meses"),
      ate("clientes", 365, "até 1 ano"),
      ate("clientes", null, "todos"),
    ],
  },
  {
    familia: "perdido_preco",
    nome: "Perdido por preço",
    explicacao:
      "Desistiram por preço ou porque acharam mais barato nos últimos 90 dias. Depois disso voltam para “Orçamento sem agendamento” pela data.",
    dataDe: null,
    opcoes: [
      { chave: "perdido_preco", familia: "perdido_preco", filtro: {}, rotulo: "até 90 dias" },
    ],
  },
  {
    familia: "agendado",
    nome: "Agendado",
    explicacao:
      "Têm serviço marcado para hoje ou depois. Nunca recebem promoção; só faz sentido em campanha de aviso.",
    dataDe: null,
    opcoes: [{ chave: "agendado", familia: "agendado", filtro: {}, rotulo: "serviço marcado" }],
  },
];

export const TODAS_OPCOES = FAMILIAS.flatMap((f) => f.opcoes);

export function defFamilia(f: Familia): DefFamilia {
  return FAMILIAS.find((x) => x.familia === f)!;
}

/** "Orçamento sem agendamento · até 10 dias". */
export function nomeDoFiltro(familia: Familia, filtro: FiltroFamilia | undefined): string {
  const def = defFamilia(familia);
  if (familia === "perdido_preco" || familia === "agendado") return def.nome;
  const f = filtro ?? {};
  const opcao = def.opcoes.find(
    (o) => o.filtro.ate === f.ate && (o.filtro.de ?? 0) === (f.de ?? 0),
  );
  if (opcao) return `${def.nome} · ${opcao.rotulo}`;
  const dias = (n: number) =>
    n % 365 === 0 ? `${n / 365} ano${n === 365 ? "" : "s"}` : `${n} dias`;
  if (f.de && f.ate) return `${def.nome} · de ${dias(f.de)} a ${dias(f.ate)}`;
  if (f.de) return `${def.nome} · mais de ${dias(f.de)}`;
  if (f.ate) return `${def.nome} · até ${dias(f.ate)}`;
  return `${def.nome} · todos`;
}

/** Resumo dos filtros escolhidos ("Orçamento … · até 10 dias + Conversou … · até 30 dias"). */
export function descreverFiltros(filtros: Filtros): string {
  const partes = FAMILIAS.filter((f) => filtros[f.familia]).map((f) =>
    nomeDoFiltro(f.familia, filtros[f.familia]),
  );
  return partes.length ? partes.join(" + ") : "Nenhuma lista escolhida";
}

/** Normaliza o que vem da tela ou do banco: só famílias conhecidas e dias inteiros válidos. */
export function filtrosValidos(v: unknown): Filtros {
  const r: Filtros = {};
  if (!v || typeof v !== "object") return r;
  for (const def of FAMILIAS) {
    const f = (v as Record<string, unknown>)[def.familia];
    if (!f || typeof f !== "object") continue;
    const ateN = Number((f as FiltroFamilia).ate);
    const deN = Number((f as FiltroFamilia).de);
    const limpo: FiltroFamilia = {};
    if (Number.isInteger(ateN) && ateN > 0 && ateN <= 3650) limpo.ate = ateN;
    if (Number.isInteger(deN) && deN > 0 && deN <= 3650) limpo.de = deN;
    if (limpo.de !== undefined && limpo.ate !== undefined && limpo.de > limpo.ate) continue;
    r[def.familia] = limpo;
  }
  return r;
}

/** Opções da promoção: só "até X dias" e sem "Agendado" (agendado nunca recebe promoção). */
export const FAMILIAS_PROMOCAO = FAMILIAS.filter((f) => f.familia !== "agendado");

// ---------------------------------------------------------------- exportação
export type PessoaLista = {
  nome: string | null;
  telefone: string;
  familias: string[];
  dias_orcamento: number | null;
  dias_conversa: number | null;
  dias_cliente: number | null;
  servico_tipo: string | null;
  orcamento_valor: number | null;
  pode_receber: boolean;
  motivo: string | null;
};

const celula = (v: unknown) => {
  const t = v === null || v === undefined ? "" : String(v);
  return /[";\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

const TIPO_SERVICO: Record<string, string> = {
  higienizacao: "Higienização",
  impermeabilizacao: "Impermeabilização",
  desconhecido: "",
};

/**
 * CSV para Excel e Google Planilhas (separador ";" e BOM, como o Excel em português espera).
 */
export function csvDaLista(pessoas: PessoaLista[]): string {
  const cab = [
    "Nome",
    "Telefone",
    "Listas",
    "Dias desde o orçamento",
    "Dias desde a conversa",
    "Dias desde o último serviço",
    "Último serviço",
    "Valor do orçamento",
    "Pode receber agora",
    "Motivo",
  ];
  const nomesFamilia = Object.fromEntries(FAMILIAS.map((f) => [f.familia, f.nome]));
  const linhas = pessoas.map((p) =>
    [
      p.nome ?? "",
      p.telefone,
      p.familias.map((f) => nomesFamilia[f] ?? f).join(", "),
      p.dias_orcamento ?? "",
      p.dias_conversa ?? "",
      p.dias_cliente ?? "",
      TIPO_SERVICO[p.servico_tipo ?? ""] ?? p.servico_tipo ?? "",
      p.orcamento_valor === null ? "" : String(p.orcamento_valor).replace(".", ","),
      p.pode_receber ? "sim" : "não",
      p.motivo ?? "",
    ]
      .map(celula)
      .join(";"),
  );
  return "﻿" + [cab.join(";"), ...linhas].join("\r\n");
}
