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
  // "de X" começa no dia X + 1 (o dia X fica na faixa "até X"): as faixas não se sobrepõem.
  if (f.de && f.ate) return `${def.nome} · de ${dias(f.de + 1)} a ${dias(f.ate)}`;
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
    if (limpo.de !== undefined && limpo.ate !== undefined && limpo.de >= limpo.ate) continue;
    r[def.familia] = limpo;
  }
  return r;
}

/** Opções da promoção: só "até X dias" e sem "Agendado" (agendado nunca recebe promoção). */
export const FAMILIAS_PROMOCAO = FAMILIAS.filter((f) => f.familia !== "agendado");

// ---------------------------------------------------------------- listas das campanhas
/**
 * Faixa de uma lista usada numa campanha. O código (grupo) é interno: escolhe o modelo da
 * mensagem e nunca aparece na tela.
 */
export type Segmento = { grupo: string; familia: Familia; de?: number; ate?: number };

/** Faixa equivalente a cada grupo antigo (mesma tabela de private.mkt_segmento_do_grupo). */
export const SEGMENTO_DO_GRUPO: Record<string, Segmento> = {
  N1: { grupo: "N1", familia: "orcamento", ate: 90 },
  N2: { grupo: "N2", familia: "orcamento", de: 90, ate: 365 },
  N3: { grupo: "N3", familia: "orcamento", de: 365 },
  C4: { grupo: "C4", familia: "clientes", de: 90, ate: 365 },
  C5: { grupo: "C5", familia: "clientes", de: 365 },
  CV: { grupo: "CV", familia: "conversa" },
  PP: { grupo: "PP", familia: "perdido_preco" },
};
const ORDEM_GRUPOS = ["C4", "C5", "N1", "N2", "N3", "CV", "PP"];

/** Listas da campanha: as gravadas ou, sem elas, as dos grupos antigos (clientes primeiro). */
export function segmentosDaCampanha(listas: unknown, grupos: string[] | null): Segmento[] {
  if (Array.isArray(listas) && listas.length) {
    return listas.flatMap((x): Segmento[] => {
      const s = x as Partial<Segmento>;
      if (!s || typeof s.grupo !== "string" || !FAMILIAS.some((f) => f.familia === s.familia))
        return [];
      return [
        {
          grupo: s.grupo,
          familia: s.familia as Familia,
          ...(typeof s.de === "number" ? { de: s.de } : {}),
          ...(typeof s.ate === "number" ? { ate: s.ate } : {}),
        },
      ];
    });
  }
  return (grupos ?? [])
    .filter((g) => SEGMENTO_DO_GRUPO[g])
    .sort((a, b) => ORDEM_GRUPOS.indexOf(a) - ORDEM_GRUPOS.indexOf(b))
    .map((g) => SEGMENTO_DO_GRUPO[g]!);
}

/** "Clientes · de 91 dias a 1 ano". */
export function nomeDoSegmento(s: Segmento): string {
  return nomeDoFiltro(s.familia, {
    ...(s.de !== undefined ? { de: s.de } : {}),
    ...(s.ate !== undefined ? { ate: s.ate } : {}),
  });
}

/** Nome da lista de um código de grupo, pelas listas da campanha (ou pelo padrão do grupo). */
export function nomeDoGrupo(grupo: string, segmentos: Segmento[]): string {
  const s = segmentos.find((x) => x.grupo === grupo) ?? SEGMENTO_DO_GRUPO[grupo];
  return s ? nomeDoSegmento(s) : "Outros";
}

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

/** Cabeçalho e linhas de uma lista (mesmas colunas no CSV e na planilha do Google). */
export function linhasDaLista(pessoas: PessoaLista[]): Array<Array<string | number>> {
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
  return [
    cab,
    ...pessoas.map((p) => [
      p.nome ?? "",
      p.telefone,
      p.familias.map((f) => nomesFamilia[f] ?? f).join(", "),
      p.dias_orcamento ?? "",
      p.dias_conversa ?? "",
      p.dias_cliente ?? "",
      TIPO_SERVICO[p.servico_tipo ?? ""] ?? p.servico_tipo ?? "",
      p.orcamento_valor === null ? "" : Number(p.orcamento_valor),
      p.pode_receber ? "sim" : "não",
      p.motivo ?? "",
    ]),
  ];
}

/**
 * CSV para Excel e Google Planilhas (separador ";" e BOM, como o Excel em português espera).
 */
export function csvDaLista(pessoas: PessoaLista[]): string {
  const [cab, ...linhas] = linhasDaLista(pessoas);
  const texto = (v: string | number) => (typeof v === "number" ? String(v).replace(".", ",") : v);
  return (
    "\ufeff" +
    [cab!.join(";"), ...linhas.map((l) => l.map((v) => celula(texto(v))).join(";"))].join("\r\n")
  );
}

/** Dias da pessoa na família (o que as opções "até X dias" contam). */
function diasNaFamilia(p: PessoaLista, f: Familia): number | null {
  if (f === "orcamento") return p.dias_orcamento;
  if (f === "conversa") return p.dias_conversa;
  if (f === "clientes") return p.dias_cliente;
  return 0;
}

/** Quem está em cada família (uma pessoa pode estar em mais de uma). */
export function pessoasDaFamilia<T extends PessoaLista>(pessoas: T[], f: Familia): T[] {
  return pessoas.filter((p) => p.familias.includes(f));
}

/** Aba Resumo: cada opção de cada lista com quantas pessoas e quantas podem receber agora. */
export function resumoDasListas(
  pessoas: PessoaLista[],
  atualizadaEm: string,
): Array<Array<string | number>> {
  const linhas: Array<Array<string | number>> = [
    ["Lista", "Opção", "Pessoas", "Podem receber agora"],
  ];
  for (const def of FAMILIAS) {
    const daFamilia = pessoasDaFamilia(pessoas, def.familia);
    for (const o of def.opcoes) {
      const dentro = daFamilia.filter((p) => {
        if (o.filtro.ate === undefined) return true;
        const d = diasNaFamilia(p, def.familia);
        return d !== null && d <= o.filtro.ate;
      });
      linhas.push([def.nome, o.rotulo, dentro.length, dentro.filter((p) => p.pode_receber).length]);
    }
  }
  linhas.push(
    [],
    [`Atualizada em ${atualizadaEm}. As listas se atualizam sozinhas todo dia às 9h.`],
  );
  return linhas;
}
