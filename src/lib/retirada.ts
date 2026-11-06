/**
 * Retirada e entrega de tapete e persiana (05/11, plano aprovado). Toda OS de tapete ou persiana
 * tem duas etapas na agenda: a Retirada (dia escolhido) e a Entrega (prevista em dias úteis depois
 * da retirada: persiana 7, tapete 15). Dias úteis: segunda a sexta, pulando os feriados da empresa
 * em que ela não vai trabalhar. Horário comercial (8h às 18h); não ocupa técnico próprio.
 */
export type TipoRetirada = "persiana" | "tapete";

export const PRAZO_DIAS_UTEIS: Record<TipoRetirada, number> = { persiana: 7, tapete: 15 };

export const HORARIO_COMERCIAL = "Horário comercial (8h às 18h)";
/** Horário gravado no atendimento de retirada (a agenda mostra "horário comercial"). */
export const HORA_RETIRADA = "08:00";

const NOME_DIA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

function somar(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function diaUtil(dia: string, bloqueados: ReadonlySet<string>): boolean {
  const s = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return s !== 0 && s !== 6 && !bloqueados.has(dia);
}

/** Dia útil N depois de `dia` (o próprio dia não conta). */
export function somarDiasUteis(dia: string, n: number, bloqueados: ReadonlySet<string>): string {
  let atual = dia;
  let contados = 0;
  for (let guarda = 0; contados < n && guarda < 400; guarda++) {
    atual = somar(atual, 1);
    if (diaUtil(atual, bloqueados)) contados++;
  }
  return atual;
}

export function entregaPrevista(
  retirada: string,
  tipo: TipoRetirada,
  bloqueados: ReadonlySet<string> = new Set(),
): string {
  return somarDiasUteis(retirada, PRAZO_DIAS_UTEIS[tipo], bloqueados);
}

/** "sex 13/11" */
export function diaCurto(dia: string): string {
  const s = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return `${NOME_DIA[s]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Tipo de retirada pela categoria do item da tabela de preços. */
export function tipoDaCategoria(categoria: string | null | undefined): TipoRetirada | null {
  return categoria === "persiana" || categoria === "tapete" ? categoria : null;
}

/** Linha do prazo no orçamento para o cliente (cartão, PDF e mensagem). */
export function linhaDoPrazo(tipo: TipoRetirada, quantidade: number): string {
  const dias = PRAZO_DIAS_UTEIS[tipo];
  if (tipo === "persiana")
    return quantidade > 1
      ? `As persianas são retiradas e lavadas no nosso galpão, com entrega em até ${dias} dias úteis após a retirada.`
      : `A persiana é retirada e lavada no nosso galpão, com entrega em até ${dias} dias úteis após a retirada.`;
  return quantidade > 1
    ? `Os tapetes são retirados e lavados no nosso galpão, com entrega em até ${dias} dias úteis após a retirada.`
    : `O tapete é retirado e lavado no nosso galpão, com entrega em até ${dias} dias úteis após a retirada.`;
}

/** Texto do bloco na agenda: "Retirada · 3 persianas rolo 2,13 m · Diego". */
export function textoDoBloco(
  etapa: "Retirada" | "Entrega",
  itens: string,
  parceiro: string | null,
): string {
  return [etapa, itens, parceiro].filter(Boolean).join(" · ");
}

type ItemCatalogoRetirada = { nome: string; categoria?: string | null };

/** Tipo de retirada de uma linha da OS pela descrição ("Persiana rolo (até 2 m) — Limpeza"). */
export function tipoDaLinha(
  descricao: string,
  catalogo: ItemCatalogoRetirada[],
): TipoRetirada | null {
  const d = descricao.trim();
  const item = catalogo
    .filter((c) => c.nome.length > 0 && (d === c.nome || d.startsWith(`${c.nome} —`)))
    .sort((a, b) => b.nome.length - a.nome.length)[0];
  if (item) return tipoDaCategoria(item.categoria);
  // Sem item da tabela: pelo nome da linha.
  if (/^persiana/i.test(d)) return "persiana";
  if (/^tapete/i.test(d)) return "tapete";
  return null;
}

/**
 * Situação de um atendimento: "retirada" (todos os itens de um tipo só), "misturado" (persiana ou
 * tapete junto com outros itens: separar em atendimento próprio) ou "comum".
 */
export function retiradaDoAtendimento(
  descricoes: string[],
  catalogo: ItemCatalogoRetirada[],
):
  | { situacao: "retirada"; tipo: TipoRetirada }
  | { situacao: "misturado"; tipos: TipoRetirada[] }
  | { situacao: "comum" } {
  // A linha da taxa de deslocamento é distribuída nos itens ao salvar: não conta.
  const tipos = descricoes
    .filter((d) => d.trim() && !/^taxa de deslocamento/i.test(d.trim()))
    .map((d) => tipoDaLinha(d, catalogo));
  if (!tipos.length || tipos.every((t) => t === null)) return { situacao: "comum" };
  const unicos = [...new Set(tipos.filter((t): t is TipoRetirada => t !== null))];
  if (tipos.every((t) => t !== null) && unicos.length === 1)
    return { situacao: "retirada", tipo: unicos[0]! };
  return { situacao: "misturado", tipos: unicos };
}

/** Quais linhas de um atendimento misturado vão para o atendimento de retirada de cada tipo. */
export function separarPorTipo<T>(
  itens: T[],
  descricao: (item: T) => string,
  catalogo: ItemCatalogoRetirada[],
): { comum: T[]; porTipo: Partial<Record<TipoRetirada, T[]>> } {
  const comum: T[] = [];
  const porTipo: Partial<Record<TipoRetirada, T[]>> = {};
  for (const it of itens) {
    const tipo = tipoDaLinha(descricao(it), catalogo);
    if (tipo) (porTipo[tipo] ??= []).push(it);
    else comum.push(it);
  }
  return { comum, porTipo };
}

// ---------------------------------------------------------------- confirmação na véspera

const DIA_LONGO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

function somarDia(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dias confirmados hoje: amanhã; no sábado também a segunda (domingo a equipe não confirma). */
export function datasDaVespera(hoje: string): string[] {
  const amanha = somarDia(hoje, 1);
  const domingo = new Date(`${amanha}T12:00:00Z`).getUTCDay() === 0;
  return domingo ? [amanha, somarDia(hoje, 2)] : [amanha];
}

/** "amanhã (sex 06/11)" ou "na segunda (09/11)". */
export function quandoDaVespera(dia: string, hoje: string): string {
  const dm = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  if (dia === somarDia(hoje, 1)) return `amanhã (${diaCurto(dia)})`;
  const s = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return `${s === 0 || s === 6 ? "no" : "na"} ${DIA_LONGO[s]} (${dm})`;
}

/** "as 3 persianas", "a persiana", "os 2 tapetes", "o tapete" (variável {{2}} dos modelos). */
export function itensDaConfirmacao(tipo: TipoRetirada, quantidade: number): string {
  const n = Math.max(1, Math.round(quantidade || 1));
  if (tipo === "persiana") return n > 1 ? `as ${n} persianas` : "a persiana";
  return n > 1 ? `os ${n} tapetes` : "o tapete";
}

/**
 * Texto dos modelos tc_confirmacao_retirada / tc_confirmacao_entrega (e as variantes _sn, sem
 * nome). Enquanto a Meta não aprova, vira a mensagem pronta da tarefa da equipe na véspera.
 */
export function mensagemDaVespera(
  etapa: "Retirada" | "Entrega",
  nome: string,
  itens: string,
  quando: string,
): string {
  const oi = nome ? `Oi, ${nome}, tudo bem?` : "Oi, tudo bem?";
  return etapa === "Retirada"
    ? `${oi} Tá tudo certo pra gente retirar ${itens} ${quando}, dentro do horário comercial, entre 8h e 18h?`
    : `${oi} A limpeza ficou pronta! Tá tudo certo pra gente entregar ${itens} ${quando}, dentro do horário comercial, entre 8h e 18h?`;
}

/**
 * Linhas do prazo de entrega no orçamento (mensagem e PDF): uma por tipo presente. Persiana conta
 * pela quantidade; tapete (por m²) conta cada linha como uma peça.
 */
export function linhasDoPrazo(
  itens: Array<{ categoria?: string | null; quantidade?: number | string | null }>,
): string[] {
  const pecas: Partial<Record<TipoRetirada, number>> = {};
  for (const it of itens) {
    const tipo = tipoDaCategoria(it.categoria);
    if (!tipo) continue;
    const n = tipo === "tapete" ? 1 : Math.max(1, Math.round(Number(it.quantidade) || 1));
    pecas[tipo] = (pecas[tipo] ?? 0) + n;
  }
  return (["persiana", "tapete"] as const)
    .filter((t) => pecas[t])
    .map((t) => linhaDoPrazo(t, pecas[t]!));
}
