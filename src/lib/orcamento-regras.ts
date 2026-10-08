/**
 * Regras de preço do orçamento, por empresa (todas desligadas por padrão). Ordem do cálculo:
 * tabela → desconto dos itens adicionais → mínimo de cadeiras → sujidade e distância →
 * desconto no total → forma de pagamento (vitrine: valor do estofado, cartão com boas-vindas e
 * Pix). Funções puras: valem na tela, no servidor e nos testes.
 */

export type Categoria = "sofa" | "colchao" | "cadeira" | "outro";
export type Arredondamento = "dezena_5" | "noventa";

export type RegrasOrcamento = {
  descontoAdicional: { ligado: boolean; pct: number; categorias: Categoria[] };
  minimoCadeiras: number | null;
  sujidade: { ligado: boolean; pct: number };
  distancia: {
    ligado: boolean;
    semAcrescimoKm: number | null;
    limiteKm: number | null;
    pct: number;
  };
  vitrine: {
    ligada: boolean;
    boasVindasPct: number;
    pixPct: number;
    arredondamento: Arredondamento;
  };
  parcelasMax: number | null;
  validadeDias: number | null;
};

export const REGRAS_DESLIGADAS: RegrasOrcamento = {
  descontoAdicional: { ligado: false, pct: 40, categorias: ["sofa", "colchao"] },
  minimoCadeiras: null,
  sujidade: { ligado: false, pct: 10 },
  distancia: { ligado: false, semAcrescimoKm: null, limiteKm: null, pct: 10 },
  vitrine: { ligada: false, boasVindasPct: 20, pixPct: 10, arredondamento: "dezena_5" },
  parcelasMax: null,
  validadeDias: null,
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
    },
    vitrine: {
      ligada: Boolean(l["vitrine_ligada"]),
      boasVindasPct: n(l["boas_vindas_pct"], 20),
      pixPct: n(l["pix_pct"], 10),
      arredondamento: l["arredondamento"] === "noventa" ? "noventa" : "dezena_5",
    },
    parcelasMax: nn(l["parcelas_max"]),
    validadeDias: nn(l["validade_dias"]),
  };
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

export type LinhaValor = { categoria: Categoria; precoAplicado: number; quantidade: number };

export type Totais = {
  subtotalItens: number;
  minimoAplicado: number;
  acrescimoSujidade: number;
  acrescimoDistancia: number;
  foraDaArea: boolean;
  desconto: number;
  /** Valor de tabela no Pix depois de todas as regras (o mínimo que a empresa recebe). */
  base: number;
  vitrine: Vitrine | null;
};

export function faixaDistancia(km: number | null, d: RegrasOrcamento["distancia"]) {
  if (!d.ligado || km === null || !Number.isFinite(km)) return { pct: 0, foraDaArea: false };
  const sem = d.semAcrescimoKm ?? Infinity;
  const limite = d.limiteKm ?? Infinity;
  if (km <= sem) return { pct: 0, foraDaArea: false };
  return { pct: d.pct, foraDaArea: km > limite };
}

export function calcularTotais(args: {
  linhas: LinhaValor[];
  regras: RegrasOrcamento;
  muitoSujo: boolean;
  distanciaKm: number | null;
  desconto: number;
  clienteNovo: boolean;
}): Totais {
  const { regras } = args;
  const subtotalItens = r2(
    args.linhas.reduce((s, l) => s + l.precoAplicado * Math.max(1, l.quantidade), 0),
  );
  const soCadeiras = args.linhas.length > 0 && args.linhas.every((l) => l.categoria === "cadeira");
  const minimoAplicado =
    soCadeiras && regras.minimoCadeiras !== null && subtotalItens < regras.minimoCadeiras
      ? r2(regras.minimoCadeiras - subtotalItens)
      : 0;
  const baseAdicionais = r2(subtotalItens + minimoAplicado);
  const acrescimoSujidade =
    regras.sujidade.ligado && args.muitoSujo ? r2((baseAdicionais * regras.sujidade.pct) / 100) : 0;
  const faixa = faixaDistancia(args.distanciaKm, regras.distancia);
  const acrescimoDistancia = r2((baseAdicionais * faixa.pct) / 100);
  const antes = r2(baseAdicionais + acrescimoSujidade + acrescimoDistancia);
  const desconto = Math.min(Math.max(r2(args.desconto), 0), antes);
  const base = r2(antes - desconto);
  return {
    subtotalItens,
    minimoAplicado,
    acrescimoSujidade,
    acrescimoDistancia,
    foraDaArea: faixa.foraDaArea,
    desconto,
    base,
    vitrine:
      regras.vitrine.ligada && base > 0
        ? calcularVitrine(base, regras.vitrine, args.clienteNovo)
        : null,
  };
}
