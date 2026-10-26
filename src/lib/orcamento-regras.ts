/**
 * Regras de preço do orçamento, por empresa (todas desligadas por padrão). Ordem do cálculo:
 * tabela → desconto dos itens adicionais → mínimo de cadeiras → sujidade e distância →
 * desconto no total → forma de pagamento (vitrine: valor do estofado, cartão com boas-vindas e
 * Pix). Funções puras: valem na tela, no servidor e nos testes.
 */

import { categoriaDeLimpeza } from "./unidade";

/** tapete (por m²) e persiana: limpeza, fora das regras de item adicional. */
export type Categoria = "sofa" | "colchao" | "cadeira" | "outro" | "tapete" | "persiana";
/** Classe do estofado: A tem acréscimo; B (padrão) e C ficam no preço da tabela. */
export type Classe = "A" | "B" | "C";
export type Arredondamento = "dezena_5" | "noventa";
/** Faixa da taxa de deslocamento: até `ate` reais (null = sem teto), `pct` sobre os itens. */
export type FaixaValor = { ate: number | null; pct: number };

export type RegrasOrcamento = {
  descontoAdicional: { ligado: boolean; pct: number; categorias: Categoria[] };
  minimoCadeiras: number | null;
  sujidade: { ligado: boolean; pct: number };
  distancia: {
    ligado: boolean;
    semAcrescimoKm: number | null;
    limiteKm: number | null;
    /** Percentual fixo (vale quando não há faixas por valor). */
    pct: number;
    /** Faixas por valor do serviço (soma dos itens): o % da primeira faixa em que o valor cabe. */
    faixas: FaixaValor[];
  };
  vitrine: {
    ligada: boolean;
    boasVindasPct: number;
    pixPct: number;
    arredondamento: Arredondamento;
  };
  parcelasMax: number | null;
  validadeDias: number | null;
  classe: { ligada: boolean; aPct: number };
  acrescimos: { ligado: boolean; almofadasPct: number; encardidoPct: number };
  /** Colchão dupla face (os dois lados + laterais): acréscimo no item do colchão. */
  duplaFace: { ligada: boolean; pct: number };
};

export const REGRAS_DESLIGADAS: RegrasOrcamento = {
  descontoAdicional: { ligado: false, pct: 40, categorias: ["sofa", "colchao"] },
  minimoCadeiras: null,
  sujidade: { ligado: false, pct: 10 },
  distancia: { ligado: false, semAcrescimoKm: null, limiteKm: null, pct: 10, faixas: [] },
  vitrine: { ligada: false, boasVindasPct: 20, pixPct: 10, arredondamento: "dezena_5" },
  parcelasMax: null,
  validadeDias: null,
  classe: { ligada: false, aPct: 20 },
  acrescimos: { ligado: false, almofadasPct: 10, encardidoPct: 10 },
  duplaFace: { ligada: false, pct: 20 },
};

/** Linha do banco (orcamento_configuracoes) → regras. Sem linha: tudo desligado. */
export function regrasDaLinha(l: Record<string, unknown> | null | undefined): RegrasOrcamento {
  if (!l) return REGRAS_DESLIGADAS;
  const n = (v: unknown, p: number) => (v === null || v === undefined ? p : Number(v));
  const nn = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  const cats = Array.isArray(l["desconto_categorias"])
    ? (l["desconto_categorias"] as string[]).filter((c): c is Categoria =>
        ["sofa", "colchao", "cadeira", "outro"].includes(c),
      )
    : REGRAS_DESLIGADAS.descontoAdicional.categorias;
  return {
    descontoAdicional: {
      ligado: Boolean(l["desconto_adicional_ligado"]),
      pct: n(l["desconto_adicional_pct"], 40),
      categorias: cats,
    },
    minimoCadeiras: nn(l["minimo_cadeiras"]),
    sujidade: { ligado: Boolean(l["sujidade_ligado"]), pct: n(l["sujidade_pct"], 10) },
    distancia: {
      ligado: Boolean(l["distancia_ligado"]),
      semAcrescimoKm: nn(l["distancia_sem_acrescimo_km"]),
      limiteKm: nn(l["distancia_limite_km"]),
      pct: n(l["distancia_pct"], 10),
      faixas: faixasDaLinha(l["distancia_faixas"]),
    },
    vitrine: {
      ligada: Boolean(l["vitrine_ligada"]),
      boasVindasPct: n(l["boas_vindas_pct"], 20),
      pixPct: n(l["pix_pct"], 10),
      arredondamento: l["arredondamento"] === "noventa" ? "noventa" : "dezena_5",
    },
    parcelasMax: nn(l["parcelas_max"]),
    validadeDias: nn(l["validade_dias"]),
    classe: { ligada: Boolean(l["classe_ligada"]), aPct: n(l["classe_a_pct"], 20) },
    acrescimos: {
      ligado: Boolean(l["acrescimos_ligado"]),
      almofadasPct: n(l["almofadas_soltas_pct"], 10),
      encardidoPct: n(l["encardido_pct"], 10),
    },
    duplaFace: { ligada: Boolean(l["dupla_face_ligada"]), pct: n(l["dupla_face_pct"], 20) },
  };
}

/** Faixas gravadas (jsonb) → lista válida, em ordem de valor (a sem teto por último). */
export function faixasDaLinha(v: unknown): FaixaValor[] {
  if (!Array.isArray(v)) return [];
  const out: FaixaValor[] = [];
  for (const f of v as Array<Record<string, unknown>>) {
    const pct = Number(f?.["pct"]);
    const ateBruto = f?.["ate"];
    const ate =
      ateBruto === null || ateBruto === undefined || ateBruto === "" ? null : Number(ateBruto);
    if (!Number.isFinite(pct) || pct < 0 || (ate !== null && !(Number.isFinite(ate) && ate > 0)))
      continue;
    out.push({ ate, pct });
  }
  return out.sort((a, b) => (a.ate ?? Infinity) - (b.ate ?? Infinity));
}

/** % da taxa de deslocamento para o valor dos itens (até o teto da faixa, inclusive). */
export function pctDaFaixa(faixas: FaixaValor[], valor: number): number {
  const f = faixas.find((x) => x.ate === null || valor <= x.ate + 1e-9);
  return f ? f.pct : 0;
}

// ---------------------------------------------------------------- classe e acréscimos do item

export type MarcasItem = {
  classe?: Classe | null;
  almofadasSoltas?: boolean;
  muitoEncardido?: boolean;
  /** Colchão dupla face (só vale em item de colchão; quem marca confere a categoria). */
  duplaFace?: boolean;
};

/**
 * Acréscimo do item em % sobre a tabela: classe A + almofadas soltas + muito encardido (somam).
 * Só conta o que a empresa ligou. Ex.: A (20) + almofadas (10) + encardido (10) = 40.
 */
export function acrescimoDoItem(regras: RegrasOrcamento, m: MarcasItem): number {
  let pct = 0;
  if (regras.classe.ligada && m.classe === "A") pct += regras.classe.aPct;
  if (regras.acrescimos.ligado) {
    if (m.almofadasSoltas) pct += regras.acrescimos.almofadasPct;
    if (m.muitoEncardido) pct += regras.acrescimos.encardidoPct;
  }
  if (regras.duplaFace.ligada && m.duplaFace) pct += regras.duplaFace.pct;
  return r2(pct);
}

/** Texto dos acréscimos aplicados (ex.: ["classe A +20%", "almofadas soltas +10%"]). */
export function rotulosAcrescimo(regras: RegrasOrcamento, m: MarcasItem): string[] {
  const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const r: string[] = [];
  if (regras.classe.ligada && m.classe === "A") r.push(`classe A +${fmt(regras.classe.aPct)}%`);
  if (regras.acrescimos.ligado && m.almofadasSoltas)
    r.push(`almofadas soltas +${fmt(regras.acrescimos.almofadasPct)}%`);
  if (regras.acrescimos.ligado && m.muitoEncardido)
    r.push(`muito encardido +${fmt(regras.acrescimos.encardidoPct)}%`);
  if (regras.duplaFace.ligada && m.duplaFace) r.push(`dupla face +${fmt(regras.duplaFace.pct)}%`);
  return r;
}

/** Preço do item com acréscimo, arredondado para o real inteiro de cima (sem acréscimo: a tabela). */
export function precoComAcrescimo(precoTabela: number, pct: number): number {
  const base = r2(precoTabela);
  if (pct <= 0 || base <= 0) return base;
  return Math.ceil(r2(base * (1 + pct / 100)) - 1e-9);
}

/** Desconto de campanha ou indicação: percentual sobre o valor antes do desconto. */
export function descontoPorPct(valor: number, pct: number): number {
  return pct > 0 ? r2((valor * pct) / 100) : 0;
}

/** Valor no Pix: total menos o desconto do Pix (com centavos). */
export function valorPix(total: number, pixPct: number): number {
  return r2(total * (1 - Math.max(0, pixPct) / 100));
}

const r2 = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

// ---------------------------------------------------------------- desconto do item adicional

/** "auto": segue a regra (sofá e colchão); "sim"/"nao": a atendente decidiu. */
export type ModoDesconto = "auto" | "sim" | "nao";

export type LinhaRegra = {
  key: string;
  categoria: Categoria;
  precoTabela: number;
  quantidade: number;
  desconto?: ModoDesconto;
};

export type Sugestao = {
  /** Preço unitário sugerido (média da linha, quando só parte das unidades tem desconto). */
  precoSugerido: number;
  descontoValor: number;
  descontoTexto: string | null;
  principal: boolean;
};

function ordinais(ns: number[]): string {
  const t = ns.map((n) => `${n}º`);
  if (t.length === 1) return `${t[0]} item`;
  return `${t.slice(0, -1).join(", ")} e ${t.at(-1)} itens`;
}

/**
 * Preço cheio no item principal (o mais caro, ou o que a atendente escolheu) e desconto em cada
 * item adicional: automático para as categorias da regra (sofá e colchão), à mão em qualquer
 * item. Dois itens iguais: o segundo também tem desconto.
 */
export function sugerirPrecos(
  linhas: LinhaRegra[],
  regras: RegrasOrcamento,
  principalKey?: string | null,
): Map<string, Sugestao> {
  const out = new Map<string, Sugestao>();
  const cheio = (l: LinhaRegra): Sugestao => ({
    precoSugerido: r2(l.precoTabela),
    descontoValor: 0,
    descontoTexto: null,
    principal: false,
  });
  const da = regras.descontoAdicional;
  if (!da.ligado || da.pct <= 0) {
    for (const l of linhas) out.set(l.key, cheio(l));
    return out;
  }
  const comDesconto = (l: LinhaRegra) =>
    l.precoTabela > 0 &&
    !categoriaDeLimpeza(l.categoria) &&
    (l.desconto === "sim" ||
      ((l.desconto ?? "auto") === "auto" && da.categorias.includes(l.categoria)));
  const validas = linhas.filter((l) => l.precoTabela > 0 && l.quantidade > 0);
  const escolhida = validas.find((l) => l.key === principalKey);
  const principal =
    escolhida ??
    [...validas].filter(comDesconto).sort((a, b) => b.precoTabela - a.precoTabela)[0] ??
    null;

  // Unidades em ordem: a do principal é a 1ª; as outras seguem a ordem da lista.
  let ordem = 1;
  const unidades = new Map<string, number[]>();
  if (principal) unidades.set(principal.key, [ordem++]);
  for (const l of validas) {
    // Tapete (m²) e persiana não entram na contagem de itens do desconto.
    if (categoriaDeLimpeza(l.categoria)) continue;
    const qtd = Math.max(1, Math.round(l.quantidade));
    const ja = unidades.get(l.key) ?? [];
    while (ja.length < qtd) ja.push(ordem++);
    unidades.set(l.key, ja);
  }

  for (const l of linhas) {
    const us = unidades.get(l.key);
    if (!us || !comDesconto(l)) {
      out.set(l.key, { ...cheio(l), principal: l.key === principal?.key });
      continue;
    }
    const descontadas = us.filter((n) => n !== 1);
    const valor = r2(descontadas.length * l.precoTabela * (da.pct / 100));
    const qtd = us.length;
    out.set(l.key, {
      precoSugerido: r2((l.precoTabela * qtd - valor) / qtd),
      descontoValor: valor,
      descontoTexto: descontadas.length ? `${ordinais(descontadas)}: -${da.pct}%` : null,
      principal: l.key === principal?.key,
    });
  }
  return out;
}

// ---------------------------------------------------------------- arredondamento e vitrine

const acima = (v: number, passo: number) => Math.ceil(r2(v) / passo - 1e-9) * passo;
const perto = (v: number, passo: number) => Math.round(r2(v) / passo) * passo;

/** Valor "redondo" pela regra da empresa: dezena (vitrine) e múltiplo de 5, ou final ,90. */
function redondo(v: number, passo: number, modo: Arredondamento, jeito: "acima" | "perto") {
  const f = jeito === "acima" ? acima : perto;
  if (modo === "noventa") return r2(f(v + 0.1, passo) - 0.1);
  return f(v, passo);
}

export type Vitrine = {
  vitrine: number;
  cartao: number;
  pix: number;
  boasVindas: boolean;
};

/**
 * A tabela guarda o valor no Pix (mínimo). Cliente novo: valor do estofado (V) → cartão com
 * boas-vindas (C) → Pix (P). Cliente antigo: V no cartão e V − Pix no Pix. O Pix nunca fica
 * abaixo da tabela.
 */
export function calcularVitrine(
  base: number,
  regras: RegrasOrcamento["vitrine"],
  clienteNovo: boolean,
): Vitrine {
  const bv = regras.boasVindasPct / 100;
  const px = regras.pixPct / 100;
  const modo = regras.arredondamento;
  const piso = redondo(base, 5, modo, "acima");
  const v = redondo(base / ((1 - bv) * (1 - px)), 10, modo, "acima");
  if (!clienteNovo) {
    const pix = Math.max(redondo(v * (1 - px), 5, modo, "acima"), piso);
    return { vitrine: v, cartao: v, pix: r2(pix), boasVindas: false };
  }
  const c = redondo(v * (1 - bv), 5, modo, "perto");
  const p = redondo(Math.max(c * (1 - px), base), 5, modo, "acima");
  return { vitrine: v, cartao: r2(c), pix: r2(Math.max(p, piso)), boasVindas: true };
}

// ---------------------------------------------------------------- totais do orçamento

export type LinhaValor = {
  categoria: Categoria;
  precoAplicado: number;
  quantidade: number;
  /** Adicional pós-fechamento: preço fixo, fora dos acréscimos do pedido e do desconto. */
  adicional?: boolean;
};

export type Totais = {
  subtotalItens: number;
  minimoAplicado: number;
  acrescimoSujidade: number;
  /** Taxa de deslocamento cobrada (a da regra, ou o valor que a equipe pôs). */
  acrescimoDistancia: number;
  /** Taxa pela regra, para comparar com a cobrada (equipe alterou ou tirou). */
  acrescimoDistanciaRegra: number;
  /** % da regra para esta distância e este valor (0 sem acréscimo). */
  distanciaPct: number;
  foraDaArea: boolean;
  desconto: number;
  /** Valor de tabela no Pix depois de todas as regras (o mínimo que a empresa recebe). */
  base: number;
  vitrine: Vitrine | null;
};

/** Distância (só a ida) → % da taxa de deslocamento. Com faixas, o % depende do valor dos itens. */
export function faixaDistancia(km: number | null, d: RegrasOrcamento["distancia"], valor = 0) {
  if (!d.ligado || km === null || !Number.isFinite(km)) return { pct: 0, foraDaArea: false };
  const sem = d.semAcrescimoKm ?? Infinity;
  const limite = d.limiteKm ?? Infinity;
  if (km <= sem) return { pct: 0, foraDaArea: false };
  const pct = d.faixas.length ? pctDaFaixa(d.faixas, valor) : d.pct;
  return { pct, foraDaArea: km > limite };
}

/** Taxa de deslocamento pela regra (R$), sobre a soma dos itens antes do desconto do Pix. */
export function taxaDeslocamento(
  km: number | null,
  d: RegrasOrcamento["distancia"],
  valorItens: number,
) {
  const f = faixaDistancia(km, d, valorItens);
  return { ...f, valor: r2((valorItens * f.pct) / 100) };
}

export function calcularTotais(args: {
  linhas: LinhaValor[];
  regras: RegrasOrcamento;
  muitoSujo: boolean;
  distanciaKm: number | null;
  desconto: number;
  /** Desconto de campanha/indicação em %: quando vem, vale sobre o valor antes do desconto. */
  descontoPct?: number | null;
  clienteNovo: boolean;
  /** Taxa de deslocamento posta pela equipe (0 = tirou). Sem valor: a da regra. */
  taxaDistancia?: number | null;
}): Totais {
  const { regras } = args;
  const soma = (ls: LinhaValor[]) =>
    r2(ls.reduce((s, l) => s + l.precoAplicado * (l.quantidade > 0 ? l.quantidade : 1), 0));
  const normais = args.linhas.filter((l) => !l.adicional);
  const subtotalItens = soma(args.linhas);
  // Adicional pós-fechamento entra pelo preço fixo: sem sujidade/distância e sem desconto.
  const subtotalAdicional = soma(args.linhas.filter((l) => l.adicional));
  const subtotalNormais = r2(subtotalItens - subtotalAdicional);
  const soCadeiras = normais.length > 0 && normais.every((l) => l.categoria === "cadeira");
  const minimoAplicado =
    soCadeiras && regras.minimoCadeiras !== null && subtotalNormais < regras.minimoCadeiras
      ? r2(regras.minimoCadeiras - subtotalNormais)
      : 0;
  const baseAdicionais = r2(subtotalNormais + minimoAplicado);
  const acrescimoSujidade =
    regras.sujidade.ligado && args.muitoSujo ? r2((baseAdicionais * regras.sujidade.pct) / 100) : 0;
  const faixa = taxaDeslocamento(args.distanciaKm, regras.distancia, baseAdicionais);
  const manual = args.taxaDistancia;
  const acrescimoDistancia =
    manual === null || manual === undefined || !Number.isFinite(manual)
      ? faixa.valor
      : r2(Math.max(manual, 0));
  // A taxa de deslocamento não entra no desconto (campanha, indicação, cupom): só os itens.
  const antes = r2(baseAdicionais + acrescimoSujidade);
  const pedido = args.descontoPct ? descontoPorPct(antes, args.descontoPct) : args.desconto;
  const desconto = Math.min(Math.max(r2(pedido), 0), antes);
  const base = r2(antes - desconto + acrescimoDistancia + subtotalAdicional);
  return {
    subtotalItens,
    minimoAplicado,
    acrescimoSujidade,
    acrescimoDistancia,
    acrescimoDistanciaRegra: faixa.valor,
    distanciaPct: faixa.pct,
    foraDaArea: faixa.foraDaArea,
    desconto,
    base,
    vitrine:
      regras.vitrine.ligada && base > 0
        ? calcularVitrine(base, regras.vitrine, args.clienteNovo)
        : null,
  };
}
