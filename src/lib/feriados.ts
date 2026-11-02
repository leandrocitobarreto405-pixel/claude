/**
 * Feriados por empresa (02/11/2026): calendário com nacionais, estaduais (SP) e municipais (São
 * Paulo) já preenchidos, Páscoa calculada, e a decisão "vamos trabalhar?" por feriado. Regras
 * puras, sem banco: a leitura e a gravação ficam em feriados.server.ts.
 *
 * Em feriado sem decisão ou com "não vamos": a Alice não oferece nem agenda, a Tatiana não cria
 * tarefa nesse dia, a agenda livre e os dias úteis da meta não contam o dia.
 */

export type OrigemFeriado = "nacional" | "estadual" | "municipal" | "facultativo" | "manual";

export type Feriado = {
  id: string;
  data: string;
  nome: string;
  origem: OrigemFeriado;
  /** null = sem decisão (vale "não trabalhamos"); true = dia normal; false = bloqueado. */
  trabalhamos: boolean | null;
  decididoEm: string | null;
  /** "admin" = alguém decidiu; "padrao" = a véspera chegou sem resposta. */
  decididoOrigem: "admin" | "padrao" | null;
};

export const ROTULO_ORIGEM: Record<OrigemFeriado, string> = {
  nacional: "nacional",
  estadual: "estadual (SP)",
  municipal: "municipal (São Paulo)",
  facultativo: "ponto facultativo",
  manual: "da empresa",
};

/** A pergunta "vamos trabalhar?" sai com esta antecedência (dias), o lembrete e o padrão. */
export const DIAS_PERGUNTA = 21;
export const DIAS_LEMBRETE = 3;
export const DIAS_PADRAO = 1;

export function somarDias(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Dias de `de` até `ate` (negativo quando `ate` já passou). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
}

/** Páscoa (domingo) de um ano, pelo algoritmo de Meeus/Jones/Butcher. */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export type FeriadoPadrao = { data: string; nome: string; origem: OrigemFeriado };

/** Calendário padrão de um ano: Brasil, estado de São Paulo e cidade de São Paulo. */
export function feriadosPadrao(ano: number): FeriadoPadrao[] {
  const p = pascoa(ano);
  const fixo = (md: string, nome: string, origem: OrigemFeriado): FeriadoPadrao => ({
    data: `${ano}-${md}`,
    nome,
    origem,
  });
  const lista: FeriadoPadrao[] = [
    fixo("01-01", "Confraternização Universal", "nacional"),
    fixo("01-25", "Aniversário de São Paulo", "municipal"),
    { data: somarDias(p, -48), nome: "Carnaval (segunda)", origem: "facultativo" },
    { data: somarDias(p, -47), nome: "Carnaval (terça)", origem: "facultativo" },
    { data: somarDias(p, -2), nome: "Sexta-feira Santa", origem: "nacional" },
    fixo("04-21", "Tiradentes", "nacional"),
    fixo("05-01", "Dia do Trabalho", "nacional"),
    { data: somarDias(p, 60), nome: "Corpus Christi", origem: "municipal" },
    fixo("07-09", "Revolução Constitucionalista", "estadual"),
    fixo("09-07", "Independência do Brasil", "nacional"),
    fixo("10-12", "Nossa Senhora Aparecida", "nacional"),
    fixo("11-02", "Finados", "nacional"),
    fixo("11-15", "Proclamação da República", "nacional"),
    fixo("11-20", "Dia da Consciência Negra", "nacional"),
    fixo("12-25", "Natal", "nacional"),
  ];
  return lista.sort((a, b) => a.data.localeCompare(b.data));
}

/** Dia bloqueado: feriado sem decisão ou com "não vamos". */
export function feriadoBloqueia(f: Pick<Feriado, "trabalhamos">): boolean {
  return f.trabalhamos !== true;
}

/** Mapa data → nome só dos feriados que bloqueiam o dia. */
export function diasBloqueados(
  feriados: Array<Pick<Feriado, "data" | "nome" | "trabalhamos">>,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of feriados) if (feriadoBloqueia(f)) m.set(f.data, f.nome);
  return m;
}

export type EtapaPergunta = "pergunta" | "lembrete" | "padrao";

/**
 * O que a Tatiana faz hoje com um feriado sem decisão: pergunta (até DIAS_PERGUNTA antes),
 * lembra (até DIAS_LEMBRETE antes) ou aplica o padrão "não trabalhamos" (véspera). Null = ainda
 * longe, ou já passou.
 */
export function etapaDaPergunta(
  f: Pick<Feriado, "data" | "trabalhamos">,
  hoje: string,
): EtapaPergunta | null {
  if (f.trabalhamos !== null) return null;
  const dias = diasEntre(hoje, f.data);
  if (dias < 0) return null;
  if (dias <= DIAS_PADRAO) return "padrao";
  if (dias <= DIAS_LEMBRETE) return "lembrete";
  if (dias <= DIAS_PERGUNTA) return "pergunta";
  return null;
}

export const dataCurta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

const DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const diaSemanaDe = (iso: string) =>
  DIA_SEMANA[new Date(`${iso}T12:00:00Z`).getUTCDay()] ?? "";

/** Título e corpo do aviso ao admin em cada etapa. */
export function textoPergunta(
  f: Pick<Feriado, "data" | "nome">,
  etapa: EtapaPergunta,
): { titulo: string; corpo: string } {
  const dia = `${diaSemanaDe(f.data)} ${dataCurta(f.data)}`;
  if (etapa === "padrao")
    return {
      titulo: `Feriado ${dataCurta(f.data)} ficou bloqueado`,
      corpo: `Ninguém respondeu se vamos trabalhar em ${dia} (${f.nome}). Valeu o padrão: dia bloqueado, sem horário para a Alice e sem tarefas. Para trabalhar, troque em Configurações › Agenda › Feriados.`,
    };
  const base = `Dia ${dataCurta(f.data)} (${diaSemanaDe(f.data)}) é feriado: ${f.nome}. Vamos trabalhar?`;
  return etapa === "lembrete"
    ? {
        titulo: `Falta decidir: feriado ${dataCurta(f.data)}`,
        corpo: `${base} Sem resposta até a véspera, o dia fica bloqueado.`,
      }
    : { titulo: `Feriado ${dataCurta(f.data)}: vamos trabalhar?`, corpo: base };
}

/** Texto da tarefa "remarcar" de um atendimento marcado em feriado bloqueado. */
export function textoRemarcarFeriado(
  f: Pick<Feriado, "data" | "nome">,
  osNumero: string | null,
): { motivo: string; mensagem: string } {
  return {
    motivo: `${osNumero ? `OS ${osNumero} ` : "Atendimento "}marcado em ${dataCurta(f.data)}, feriado bloqueado (${f.nome}): remarcar com o cliente`,
    mensagem: `Oi! Aqui é da equipe. No dia ${dataCurta(f.data)} é ${f.nome} e não vamos atender. Posso remarcar o seu atendimento para outro dia? Me diz o melhor período que eu vejo os horários livres.`,
  };
}
