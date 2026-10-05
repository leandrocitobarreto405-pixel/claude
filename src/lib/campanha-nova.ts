/**
 * Campanha nova criada pelo app (Marketing → Nova campanha): as listas que dá para escolher, o
 * modelo sugerido de cada uma, a ordem dos lotes (quentes primeiro) e a validação do formulário.
 * Sem banco nem rede, para poder testar. O servidor valida de novo com a mesma função.
 */
import { segmentosDaCampanha, type Familia } from "@/lib/listas";
import type { FormModelo } from "@/lib/modelos-mensagem";

export type QuemResponde = "alice" | "equipe";

/** Lista que dá para escolher. O código (grupo) é interno e nunca aparece na tela. */
export type OpcaoLista = {
  grupo: string;
  familia: Familia;
  de?: number;
  ate?: number;
  rotulo: string;
  /** Finalidade do modelo sugerido (mkt_configuracoes.modelos). */
  finalidade: string;
  /** Faixas à escolha ("até 10 dias", "até 20 dias"...), quando a lista tem. */
  faixas?: Faixa[];
  faixaPadrao?: string;
};

export type Faixa = { valor: string; rotulo: string; ate?: number };

const ate = (n: number): Faixa => ({ valor: String(n), rotulo: `até ${n} dias`, ate: n });

/** Faixas dos orçamentos recentes (até 90 dias). */
export const FAIXAS_ORCAMENTO: Faixa[] = [ate(10), ate(20), ate(30), ate(60), ate(90)];

/** Faixas da lista "Conversou e não pediu orçamento". */
export const FAIXAS_CONVERSA: Faixa[] = [
  ate(10),
  ate(20),
  ate(30),
  ate(90),
  { valor: "todos", rotulo: "todos" },
];

export const OPCOES_LISTAS: OpcaoLista[] = [
  {
    grupo: "C4",
    familia: "clientes",
    de: 90,
    ate: 365,
    rotulo: "Clientes · 91 dias a 1 ano",
    finalidade: "oferta",
  },
  {
    grupo: "C5",
    familia: "clientes",
    de: 365,
    rotulo: "Clientes · mais de 1 ano",
    finalidade: "reativacao",
  },
  {
    grupo: "N1",
    familia: "orcamento",
    ate: 90,
    rotulo: "Orçamento sem agendamento · recentes",
    finalidade: "orcamento",
    faixas: FAIXAS_ORCAMENTO,
    faixaPadrao: "90",
  },
  {
    grupo: "N2",
    familia: "orcamento",
    de: 90,
    ate: 365,
    rotulo: "Orçamento sem agendamento · 91 dias a 1 ano",
    finalidade: "orcamento",
  },
  {
    grupo: "N3",
    familia: "orcamento",
    de: 365,
    rotulo: "Orçamento sem agendamento · mais de 1 ano",
    finalidade: "orcamento",
  },
  {
    grupo: "CV",
    familia: "conversa",
    rotulo: "Conversou e não pediu orçamento",
    finalidade: "conversa",
    faixas: FAIXAS_CONVERSA,
    faixaPadrao: "todos",
  },
  { grupo: "PP", familia: "perdido_preco", rotulo: "Perdido por preço", finalidade: "preco" },
];

const PADRAO_FINALIDADE: Record<string, string> = {
  oferta: "oferta_trimestral",
  reativacao: "reativacao_cliente",
  orcamento: "orcamento_retomada",
  conversa: "conversa_retomada",
  preco: "preco_retomada",
};

/** Modelo sugerido para a lista, pelos nomes da empresa (ex.: tc_oferta_trimestral). */
export function modeloSugerido(grupo: string, modelosDaEmpresa: unknown): string {
  const op = OPCOES_LISTAS.find((o) => o.grupo === grupo);
  if (!op) return "";
  const m = (
    modelosDaEmpresa && typeof modelosDaEmpresa === "object" ? modelosDaEmpresa : {}
  ) as Record<string, unknown>;
  const v = typeof m[op.finalidade] === "string" ? String(m[op.finalidade]).trim() : "";
  return v || PADRAO_FINALIDADE[op.finalidade] || "";
}

/**
 * Temperatura da lista (a mesma regra do preparo no banco): 1 clientes, 2 orçamentos até 1 ano,
 * 3 perdido por preço, 4 orçamentos de mais de 1 ano, 5 conversou e não pediu orçamento.
 * 4 e 5 são frias: vão nos últimos lotes.
 */
export function temperatura(s: { familia: string; de?: number | null }): number {
  if (s.familia === "clientes") return 1;
  if (s.familia === "orcamento") return (s.de ?? 0) >= 365 ? 4 : 2;
  if (s.familia === "conversa") return 5;
  return 3;
}

export const listaFria = (s: { familia: string; de?: number | null }) => temperatura(s) >= 4;

/** Listas na ordem em que os lotes saem (quentes primeiro, recentes antes). */
export function ordemDosLotes<T extends { familia: string; de?: number | null }>(listas: T[]): T[] {
  return listas
    .map((s, i) => ({ s, i }))
    .sort(
      (a, b) => temperatura(a.s) - temperatura(b.s) || (a.s.de ?? 0) - (b.s.de ?? 0) || a.i - b.i,
    )
    .map((x) => x.s);
}

/**
 * Próximas datas permitidas (dias de disparo da empresa, 1 = segunda ... 7 = domingo).
 * `incluirHoje`: com dia e horário próprios, hoje também pode.
 */
export function proximasDatas(
  hoje: string,
  dias: number[],
  quantas = 12,
  incluirHoje = false,
): string[] {
  const r: string[] = [];
  const d = new Date(`${hoje}T12:00:00Z`);
  for (let i = incluirHoje ? 0 : 1; r.length < quantas && i <= 120; i++) {
    const x = new Date(d.getTime() + i * 86_400_000);
    const isodow = x.getUTCDay() === 0 ? 7 : x.getUTCDay();
    if (dias.includes(isodow)) r.push(x.toISOString().slice(0, 10));
  }
  return r;
}

/** Quantas pessoas de uma lista entram: um terço ou dois terços de quem pode receber agora. */
export function quantidadeDaFracao(podem: number, fracao: "1/3" | "2/3"): number {
  const n = fracao === "1/3" ? podem / 3 : (podem * 2) / 3;
  return Math.max(1, Math.ceil(n));
}

export type EntradaNovaCampanha = {
  nome: string;
  listas: Array<{
    grupo: string;
    modelo: string;
    faixa?: string | undefined;
    /** Quantas pessoas desta lista (as mais recentes); vazio = todas. */
    quantidade?: number | null | undefined;
  }>;
  semCondicao: boolean;
  condicaoTexto: string | null;
  condicaoPct: number | null;
  datas: string[];
  /** "14:30": dia e horário próprios (qualquer dia, inclusive hoje). Vazio = configuração. */
  horaInicio?: string | null | undefined;
  quemResponde: QuemResponde;
};

export type NovaCampanha = {
  nome: string;
  listas: Array<{ grupo: string; familia: Familia; de?: number; ate?: number }>;
  templates: Record<string, string>;
  condicaoTexto: string | null;
  condicaoPct: number | null;
  datas: string[];
  mesRef: string;
  /** Quantas pessoas de cada lista (código da lista → número). */
  limites: Record<string, number>;
  horaInicio: string | null;
  quemResponde: QuemResponde;
};

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const NOME_MODELO = /^[a-z0-9_]{1,200}$/;
const DIA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Confere e normaliza. Problemas em português, para mostrar na tela. */
export function validarNovaCampanha(
  e: EntradaNovaCampanha,
  ctx: { hoje: string; dias: number[]; agora?: string },
): { ok: true; campanha: NovaCampanha } | { ok: false; problemas: string[] } {
  const p: string[] = [];
  const nome = String(e.nome ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (nome.length < 3) p.push("Dê um nome para a campanha.");
  if (nome.length > 80) p.push("Nome com mais de 80 caracteres.");

  const vistos = new Set<string>();
  const listas: NovaCampanha["listas"] = [];
  const templates: Record<string, string> = {};
  const limites: Record<string, number> = {};
  for (const l of e.listas ?? []) {
    const op = OPCOES_LISTAS.find((o) => o.grupo === l.grupo);
    if (!op || vistos.has(op.grupo)) continue;
    vistos.add(op.grupo);
    const modelo = String(l.modelo ?? "").trim();
    if (!NOME_MODELO.test(modelo))
      p.push(`${op.rotulo}: escolha o modelo (só letras minúsculas, números e _).`);
    const faixa = op.faixas
      ? (op.faixas.find((f) => f.valor === (l.faixa ?? op.faixaPadrao)) ?? null)
      : null;
    if (op.faixas && !faixa) p.push(`${op.rotulo}: escolha a faixa.`);
    if (l.quantidade !== null && l.quantidade !== undefined) {
      const q = Number(l.quantidade);
      if (!Number.isInteger(q) || q < 1 || q > 100_000)
        p.push(`${op.rotulo}: a quantidade de pessoas precisa ser um número a partir de 1.`);
      else limites[op.grupo] = q;
    }
    listas.push({
      grupo: op.grupo,
      familia: op.familia,
      ...(op.de !== undefined ? { de: op.de } : {}),
      ...(faixa
        ? faixa.ate !== undefined
          ? { ate: faixa.ate }
          : {}
        : op.ate !== undefined
          ? { ate: op.ate }
          : {}),
    });
    templates[op.grupo] = modelo;
  }
  if (!listas.length) p.push("Escolha pelo menos uma lista.");

  let condicaoTexto: string | null = null;
  let condicaoPct: number | null = null;
  if (!e.semCondicao) {
    condicaoTexto =
      String(e.condicaoTexto ?? "")
        .trim()
        .slice(0, 200) || null;
    condicaoPct =
      e.condicaoPct === null || e.condicaoPct === undefined || String(e.condicaoPct) === ""
        ? null
        : Number(e.condicaoPct);
    if (
      condicaoPct !== null &&
      (!Number.isFinite(condicaoPct) || condicaoPct < 0 || condicaoPct > 25)
    )
      p.push("A condição vai de 0% a 25%.");
    if (!condicaoTexto && !condicaoPct)
      p.push('Escreva a condição (texto ou %) ou marque "Sem condição".');
  }

  const horaInicio = e.horaInicio ? String(e.horaInicio).trim().slice(0, 5) : null;
  if (horaInicio !== null) {
    if (!HORA.test(horaInicio) || minutos(horaInicio) < 8 * 60 || minutos(horaInicio) > 20 * 60)
      p.push("O horário de início vai das 08:00 às 20:00.");
  }
  const datas = [...new Set((e.datas ?? []).map(String))].filter((d) => DIA_ISO.test(d)).sort();
  if (!datas.length) p.push("Escolha pelo menos uma data de disparo.");
  for (const d of datas) {
    const dia = new Date(`${d}T12:00:00Z`).getUTCDay();
    const isodow = dia === 0 ? 7 : dia;
    const br = d.split("-").reverse().join("/");
    if (horaInicio !== null) {
      // Dia e horário próprios: qualquer dia; hoje só se ainda faltar meia hora.
      if (d < ctx.hoje) p.push(`${br} já passou.`);
      else if (
        d === ctx.hoje &&
        ctx.agora &&
        HORA.test(horaInicio) &&
        minutos(horaInicio) < minutos(ctx.agora) + 30
      )
        p.push(
          `Hoje às ${horaInicio} não dá tempo de preparar e aprovar: escolha um horário pelo menos 30 minutos depois de agora (${ctx.agora}).`,
        );
    } else if (d <= ctx.hoje) p.push(`${br} já passou (a primeira é amanhã).`);
    else if (!ctx.dias.includes(isodow))
      p.push(`${br} não é um dos dias de disparo da configuração.`);
  }

  const quem: QuemResponde = e.quemResponde === "equipe" ? "equipe" : "alice";
  if (p.length) return { ok: false, problemas: [...new Set(p)] };
  return {
    ok: true,
    campanha: {
      nome,
      listas,
      templates,
      condicaoTexto,
      condicaoPct,
      datas,
      mesRef: `${datas[0]!.slice(0, 7)}-01`,
      limites,
      horaInicio,
      quemResponde: quem,
    },
  };
}

/** "terça, quarta e quinta" a partir dos dias da configuração. */
export function diasTexto(dias: number[]): string {
  const nomes = ["", "segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"];
  const n = [...new Set(dias)]
    .filter((d) => d >= 1 && d <= 7)
    .sort()
    .map((d) => nomes[d]!);
  return n.length <= 1 ? (n[0] ?? "") : `${n.slice(0, -1).join(", ")} e ${n.at(-1)}`;
}

// ---------------------------------------------------------------- modelos aprovados e prévia
export type ModeloAprovado = {
  nome: string;
  categoria: string;
  form: FormModelo;
  /** A versão "_sn" (para quem está sem nome) também está aprovada. */
  temSn: boolean;
};

/** Só os modelos aprovados na Meta, no idioma da empresa, sem as versões "_sn" (vão junto). */
export function modelosAprovados(
  modelos: Array<{
    nome: string;
    idioma: string;
    status: string;
    categoria: string;
    form: FormModelo;
  }>,
  idioma: string,
): ModeloAprovado[] {
  const ok = modelos.filter(
    (m) =>
      String(m.status).toUpperCase() === "APPROVED" &&
      m.idioma.toLowerCase() === idioma.toLowerCase(),
  );
  const nomes = new Set(ok.map((m) => m.nome));
  return ok
    .filter((m) => !m.nome.endsWith("_sn"))
    .map((m) => ({
      nome: m.nome,
      categoria: m.categoria,
      form: m.form,
      temSn: nomes.has(`${m.nome}_sn`),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * Prévia como o cliente vê: {{1}} = um nome de exemplo e {{2}} = a condição da campanha (ou um
 * aviso de que falta). `usaCondicao`: o texto do modelo traz a condição.
 */
export function previaDoModelo(
  form: FormModelo,
  condicao: string | null,
): { texto: string; botoes: string[]; usaCondicao: boolean } {
  const usaCondicao = /\{\{\s*2\s*\}\}/.test(form.corpo);
  const exemplos = ["Ana", condicao?.trim() || "[condição da campanha]"];
  const texto = form.corpo.replace(
    /\{\{\s*(\d+)\s*\}\}/g,
    (inteiro, n: string) => exemplos[Number(n) - 1] ?? inteiro,
  );
  return {
    texto: [form.cabecalho.trim(), texto.trim(), form.rodape.trim()].filter(Boolean).join("\n\n"),
    botoes: form.botoes.map((b) => b.texto).filter(Boolean),
    usaCondicao,
  };
}

/** Formulário de "Nova campanha" já preenchido (ex.: "Mandar para quem ficou de fora"). */
export type InicialNovaCampanha = {
  nome: string;
  listas: Array<{ grupo: string; modelo: string; faixa?: string }>;
  condicaoTexto: string | null;
  condicaoPct: number | null;
  quemResponde: QuemResponde;
};

/**
 * Mesma campanha de novo, para quem ficou de fora: mesmas listas (e faixas), modelos, condição
 * e quem responde. Quem já recebeu fica de fora sozinho pelo limite de marketing (30 dias).
 */
export function repetirCampanha(c: {
  nome: string;
  listas: unknown;
  grupos: string[] | null;
  templates: unknown;
  condicao_texto: string | null;
  condicao_pct: number | null;
  quem_responde?: string | null;
}): InicialNovaCampanha {
  const templates =
    c.templates && typeof c.templates === "object" ? (c.templates as Record<string, unknown>) : {};
  const listas = segmentosDaCampanha(c.listas, c.grupos).flatMap((s) => {
    const op = OPCOES_LISTAS.find((o) => o.grupo === s.grupo);
    if (!op) return [];
    const faixa = op.faixas?.find((f) => f.ate === s.ate)?.valor;
    const modelo = typeof templates[s.grupo] === "string" ? (templates[s.grupo] as string) : "";
    return [{ grupo: s.grupo, modelo, ...(faixa ? { faixa } : {}) }];
  });
  return {
    nome: `${c.nome} (resto)`.slice(0, 80),
    listas,
    condicaoTexto: c.condicao_texto,
    condicaoPct: c.condicao_pct === null ? null : Number(c.condicao_pct),
    quemResponde: c.quem_responde === "equipe" ? "equipe" : "alice",
  };
}
