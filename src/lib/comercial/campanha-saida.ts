/**
 * Lead com mais de 7 dias sem resposta sai das tarefas de venda e vai para a lista de campanha
 * (12/11, regra do dono). Conta da última mensagem do cliente ou do orçamento enviado, o que for
 * mais recente, mesmo que a tarefa tenha sido criada depois. Regras puras, sem banco e sem IA.
 *
 * Não sai: lead com data combinada no futuro (retorno combinado, "rever em" de data marcada,
 * tarefa agendada: fica guardado e volta na data); negociação ativa (P1); OS em aberto; acerto do
 * app pendente; cliente que respondeu nos últimos 7 dias; tarefa que a equipe mandou segurar.
 */

/**
 * Saída automática para a campanha: LIGADA em 12/11, com o OK do dono (ele viu a lista dos que
 * sairiam, mandou segurar cinco e aprovou a regra e o botão Segurar na lista).
 */
export const SAIDA_PARA_CAMPANHA_LIGADA = true;

/** Mais do que estes dias sem resposta do cliente: o lead sai das tarefas de venda. */
export const DIAS_SEM_RESPOSTA = 7;
/** Por quantos dias a tarefa segurada pela equipe não sai de novo. */
export const DIAS_SEGURADA = 7;

/** Tipos de tarefa de venda (as outras, pós-venda e remarcar, têm regra própria). */
export const TAREFAS_DE_VENDA = ["mensagem", "ligar", "follow_up_esquecido"] as const;
export const ehTarefaDeVenda = (tipo: string | null | undefined) =>
  (TAREFAS_DE_VENDA as readonly string[]).includes(tipo ?? "mensagem");

/**
 * A tarefa é mesmo da Tatiana? (13/11) A tarefa da manhã de uma transferência da Alice, a de um
 * pedido de autorização de desconto à noite e o retorno combinado pela equipe usam a lista da
 * equipe, mas não são dela: a leitura da Tatiana nunca as cancela nem substitui; só saem quando a
 * equipe responde.
 */
export const MARCA_TRANSFERENCIA = "[transferencia]";
export function tarefaDaTatiana(t: {
  origem?: string | null;
  notes?: string | null;
  motivo?: string | null;
}): boolean {
  if (t.origem !== undefined && t.origem !== "gerente") return false;
  const notas = t.notes ?? "";
  const motivo = t.motivo ?? "";
  if (notas.includes(MARCA_TRANSFERENCIA) || /\btransferiu: /.test(notas)) return false;
  if (/^A Alice transferiu fora do horário/.test(motivo)) return false;
  if (notas.includes("[autorizacao:") || /^Pedido de desconto da Alice/.test(motivo)) return false;
  return true;
}

export type SinaisDaSaida = {
  tipo: string | null;
  prioridade: number | null;
  notas: string | null;
  /** Última mensagem do cliente (ISO) ou null. */
  ultimaDoCliente: string | null;
  /** Orçamento enviado ou criado no app, o mais recente (ISO) ou null. */
  orcamentoEm: string | null;
  /** Retorno combinado, "rever em" de data marcada ou tarefa agendada, no futuro. */
  dataCombinada: boolean;
  osAberta: boolean;
  acertoPendente: boolean;
};

export type MotivoDeFicar =
  | "nao_e_venda"
  | "segurada"
  | "negociacao_p1"
  | "data_combinada"
  | "os_aberta"
  | "acerto_pendente"
  /** Sem mensagem do cliente nem orçamento: não há de onde contar. */
  | "sem_referencia"
  | "respondeu";

export type Saida = { sai: true; dias: number } | { sai: false; motivo: MotivoDeFicar };

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const SEGURADA = /\[segurada:(\d{4}-\d{2}-\d{2})\]/;

export const marcaSegurada = (hoje: string) => `[segurada:${hoje}]`;

/** Dia em que a equipe mandou segurar a tarefa (AAAA-MM-DD) ou null. */
export function seguradaEm(notas: string | null | undefined): string | null {
  return SEGURADA.exec(notas ?? "")?.[1] ?? null;
}

/** Notas da tarefa segurada: uma marca só, com a data de hoje, sem cortar o resto. */
export function notasDaSegurada(notas: string | null, hoje: string): string {
  const semMarca = (notas ?? "").replace(new RegExp(SEGURADA, "g"), "").trim();
  return `${semMarca.slice(0, 500 - 25)} ${marcaSegurada(hoje)}`.trim();
}

const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);

/** A tarefa sai da lista e o lead vai para a campanha? `hoje`: AAAA-MM-DD em São Paulo. */
export function saiParaCampanha(s: SinaisDaSaida, o: { agora: Date; hoje: string }): Saida {
  if (!ehTarefaDeVenda(s.tipo)) return { sai: false, motivo: "nao_e_venda" };
  const segurada = seguradaEm(s.notas);
  if (segurada && diasEntre(segurada, o.hoje) < DIAS_SEGURADA)
    return { sai: false, motivo: "segurada" };
  if (s.prioridade === 1) return { sai: false, motivo: "negociacao_p1" };
  if (s.dataCombinada) return { sai: false, motivo: "data_combinada" };
  if (s.osAberta) return { sai: false, motivo: "os_aberta" };
  if (s.acertoPendente) return { sai: false, motivo: "acerto_pendente" };
  const ref = Math.max(
    ...[ms(s.ultimaDoCliente), ms(s.orcamentoEm)].filter((t) => !Number.isNaN(t)),
  );
  if (!Number.isFinite(ref)) return { sai: false, motivo: "sem_referencia" };
  const parado = o.agora.getTime() - ref;
  if (parado <= DIAS_SEM_RESPOSTA * 86_400_000) return { sai: false, motivo: "respondeu" };
  return { sai: true, dias: Math.floor(parado / 86_400_000) };
}

/** Começo fixo do resultado gravado na tarefa que saiu (é por ele que a tela acha as saídas). */
export const PREFIXO_CAMPANHA = "saiu da lista: mais de 7 dias sem resposta";
export const resultadoCampanha = (dias: number) =>
  `${PREFIXO_CAMPANHA} do cliente (${dias} dias; lista de campanha)`;
/** Dias sem resposta gravados no resultado (para a tela) ou null. */
export function diasDoResultado(resultado: string | null | undefined): number | null {
  const m = /\((\d+) dias;/.exec(resultado ?? "");
  return m ? Number(m[1]) : null;
}

/** Linha do resumo da manhã: "3 leads saíram para a lista de campanha ...". null sem saída. */
export function linhaDasSaidas(n: number): string | null {
  if (n <= 0) return null;
  return `${n} ${n === 1 ? "lead saiu" : "leads saíram"} para a lista de campanha (mais de 7 dias sem resposta); para segurar algum, toque em Segurar na lista.`;
}
