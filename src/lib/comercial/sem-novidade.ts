/**
 * Lead sem novidade não passa pela IA (12/11, decisão do dono, custo). Regras puras, sem banco.
 *
 * Na noite, o lead que desde a última leitura não teve mensagem nova (do cliente ou nossa), nem
 * novidade no app (orçamento, OS, visita, pagamento, desfecho de tarefa), nem "rever em" ou retorno
 * combinado chegando fica FORA da leitura: vale o mesmo resumo e a mesma decisão. Pular a leitura
 * não cancela, não substitui e não reescreve a tarefa: ela continua na lista, envelhecendo.
 *
 * Passa pela IA: lead novo (nunca lido), lead com qualquer novidade, follow-up esquecido e a
 * releitura completa a cada 7 dias.
 */
import { RELEITURA_DIAS, TOLERANCIA_RELEITURA_MS } from "./resumo-dia";

/** Por que o lead passa pela IA nesta noite. */
export type MotivoDaLeitura =
  | "lead_novo"
  | "releitura_semanal"
  | "follow_up_esquecido"
  | "mensagem_nova"
  | "novidade_no_app"
  | "retorno_combinado"
  | "rever_chegou"
  /** Não deu para conferir no banco se havia novidade: passa pela IA. */
  | "na_duvida";

/** Como fica o lead pulado. */
export type SituacaoDoPulado =
  /** Tem tarefa da equipe na lista: ela continua, a mesma, com o contador. */
  | "tarefa_na_lista"
  /** Sem tarefa: está esperando a data combinada ou a próxima olhada. */
  | "esperando_data"
  /** Sem tarefa e sem data (ex.: cliente bloqueado). */
  | "sem_pendencia";

export type NovidadesDoApp = {
  /** Data da mudança mais recente de cada tipo (ISO) ou null. */
  orcamento: string | null;
  os: string | null;
  visita: string | null;
  pagamento: string | null;
  /** Tarefa/follow-up concluído, pulado ou marcado por alguém depois da leitura. */
  tarefa: string | null;
};

export type SinaisDoLead = {
  /** Última leitura da IA (última decisão gravada); null = nunca lido. */
  lidaEm: string | null;
  /** Última leitura completa da conversa; null = não se sabe. */
  completaEm: string | null;
  /** Até que mensagem a última leitura cobriu (resumo_ate); sem resumo, vale a própria leitura. */
  resumoAte: string | null;
  /** Há toque vencido que ninguém fez (follow-up esquecido). */
  esquecido: boolean;
  /** Última mensagem não privada, de qualquer lado, fora disparo de campanha. */
  ultimaMensagemEm: string | null;
  app: NovidadesDoApp;
  reverEm: string | null;
  reverMotivo: string | null;
  /** Retorno combinado ou prometido pelo cliente (o próximo), ISO. */
  retornoEm: string | null;
  /** Tarefa da Tatiana para a equipe, pendente, para este lead. */
  tarefaPendente: boolean;
};

export type Leitura =
  | { passa: true; motivo: MotivoDaLeitura; detalhe?: string }
  | { passa: false; situacao: SituacaoDoPulado };

/** Motivos do "rever em" que só existem para conferir a tarefa: com ela na lista, não é novidade. */
export const REVER_DA_TAREFA = ["ver se respondeu à tarefa", "ver se remarcou"] as const;

/** Folga entre a IA ler a conversa e a decisão ser gravada (sem resumo, vale a hora da decisão). */
const FOLGA_DA_LEITURA_MS = 5 * 60_000;

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const depois = (iso: string | null | undefined, corte: number) => {
  const t = ms(iso);
  return !Number.isNaN(t) && t > corte;
};

const NOME_DO_APP: Record<keyof NovidadesDoApp, string> = {
  orcamento: "orçamento",
  os: "OS",
  visita: "visita",
  pagamento: "pagamento",
  tarefa: "tarefa",
};

/**
 * O lead passa pela IA nesta noite ou fica como está? `fimDeHoje` e `fimDeAmanha`: fim do dia em
 * São Paulo (ISO). Na dúvida (data que não se lê), passa.
 */
export function lerOuPular(
  s: SinaisDoLead,
  o: { agora: Date; fimDeHoje: string; fimDeAmanha: string },
): Leitura {
  if (s.esquecido) return { passa: true, motivo: "follow_up_esquecido" };
  const lida = ms(s.lidaEm);
  if (Number.isNaN(lida)) return { passa: true, motivo: "lead_novo" };
  const completa = ms(s.completaEm);
  if (
    Number.isNaN(completa) ||
    o.agora.getTime() - completa >= RELEITURA_DIAS * 86_400_000 - TOLERANCIA_RELEITURA_MS
  )
    return { passa: true, motivo: "releitura_semanal" };
  const resumoAte = ms(s.resumoAte);
  const coberto = Number.isNaN(resumoAte) ? lida - FOLGA_DA_LEITURA_MS : resumoAte;
  if (depois(s.ultimaMensagemEm, coberto)) return { passa: true, motivo: "mensagem_nova" };
  for (const k of Object.keys(NOME_DO_APP) as Array<keyof NovidadesDoApp>)
    if (depois(s.app[k], lida))
      return { passa: true, motivo: "novidade_no_app", detalhe: NOME_DO_APP[k] };
  const retorno = ms(s.retornoEm);
  if (!Number.isNaN(retorno) && retorno > lida && retorno <= ms(o.fimDeAmanha))
    return { passa: true, motivo: "retorno_combinado" };
  const rever = ms(s.reverEm);
  const reverChegou = !Number.isNaN(rever) && rever <= ms(o.fimDeHoje);
  if (s.reverEm && Number.isNaN(rever)) return { passa: true, motivo: "rever_chegou" };
  if (reverChegou) {
    const daTarefa = (REVER_DA_TAREFA as readonly string[]).includes(s.reverMotivo ?? "");
    if (!(daTarefa && s.tarefaPendente)) return { passa: true, motivo: "rever_chegou" };
  }
  if (s.tarefaPendente) return { passa: false, situacao: "tarefa_na_lista" };
  return { passa: false, situacao: s.reverEm ? "esperando_data" : "sem_pendencia" };
}

// ---------------------------------------------------------------- relatório da noite

export type ExemploPulado = {
  lead: string;
  /** Final do telefone (4 dígitos) para conferir na tela. */
  final: string;
  situacao: SituacaoDoPulado;
  caixinha: number | null;
  lidaEm: string | null;
  ultimaMensagemEm: string | null;
  reverEm: string | null;
  /** Tarefa na lista: desde quando e quantas vezes já voltou. */
  tarefa: { criadaEm: string; adiamentos: number } | null;
};

export type RelatorioDosPulados = {
  total: number;
  porSituacao: Record<SituacaoDoPulado, number>;
  /** Quantos pulados tinham tarefa na lista no começo da noite (ela tem de continuar lá). */
  comTarefa: number;
  exemplos: ExemploPulado[];
  /** Quem passou pela IA, por motivo. */
  lidos: Partial<Record<MotivoDaLeitura, number>>;
};

export const QUANTOS_EXEMPLOS = 5;

/**
 * Cinco exemplos para o dono conferir: primeiro os que têm tarefa na lista (é onde uma tarefa
 * poderia sumir), depois os outros; dentro de cada grupo, os lidos há mais tempo.
 */
export function escolherExemplos(pulados: ExemploPulado[]): ExemploPulado[] {
  const idade = (e: ExemploPulado) => ms(e.lidaEm) || 0;
  const comTarefa = pulados.filter((p) => p.tarefa).sort((a, b) => idade(a) - idade(b));
  const semTarefa = pulados.filter((p) => !p.tarefa).sort((a, b) => idade(a) - idade(b));
  const saida = [...comTarefa.slice(0, 3), ...semTarefa.slice(0, 2)];
  for (const p of [...comTarefa.slice(3), ...semTarefa.slice(2)]) {
    if (saida.length >= QUANTOS_EXEMPLOS) break;
    saida.push(p);
  }
  return saida.slice(0, QUANTOS_EXEMPLOS);
}

// ---------------------------------------------------------------- a lista de tarefas

/** Tipos de tarefa de venda (as outras, pós-venda e remarcar, têm regra própria). */
export const TAREFAS_DE_VENDA = ["mensagem", "ligar", "follow_up_esquecido"] as const;
export const ehTarefaDeVenda = (tipo: string | null | undefined) =>
  (TAREFAS_DE_VENDA as readonly string[]).includes(tipo ?? "mensagem");

/**
 * Saída automática para a campanha: DESLIGADA (12/11). O dono pediu para trocar a contagem (7 dias
 * da última mensagem do cliente ou do orçamento, com exceções) e ver a lista antes de aplicar; até
 * o OK dele, nenhuma tarefa sai da lista sozinha por tempo.
 */
export const SAIDA_PARA_CAMPANHA_LIGADA = false;

/** Dias que a tarefa de venda fica na lista sem resposta do cliente antes de ir para a campanha. */
export const DIAS_NA_LISTA = 7;

const diaSP = (iso: string) =>
  new Date(iso).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** Dias corridos (calendário de São Paulo) entre a criação da tarefa e hoje. */
export function diasNaLista(criadaEm: string, hoje: string): number {
  const a = Date.parse(`${diaSP(criadaEm)}T12:00:00Z`);
  const b = Date.parse(`${hoje}T12:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? 0 : Math.round((b - a) / 86_400_000);
}

/**
 * A tarefa sai da lista e o lead vai para a campanha? Só tarefa de venda, há 7 dias ou mais na
 * lista, sem nenhuma resposta do cliente desde que foi criada.
 */
export function saiParaCampanha(t: {
  tipo: string | null;
  criadaEm: string;
  ultimaDoCliente: string | null;
  hoje: string;
}): boolean {
  if (!ehTarefaDeVenda(t.tipo)) return false;
  if (diasNaLista(t.criadaEm, t.hoje) < DIAS_NA_LISTA) return false;
  return !depois(t.ultimaDoCliente, ms(t.criadaEm));
}

/**
 * Mensagem só no dia: a tarefa marcada para depois de amanhã nasce com o rascunho da mensagem e
 * esta marca nas notas. Na véspera o lead volta para a leitura e a mensagem final é escrita.
 */
export const MARCA_VESPERA = "[mensagem na véspera]";

/**
 * A tarefa da equipe que espera a mensagem final: tem a marca e cai até amanhã. `fimDeAmanha`: ISO.
 */
export function tarefaDaVespera<T extends { notes: string | null; scheduled_at: string }>(
  tarefas: T[],
  fimDeAmanha: string,
): T | null {
  return (
    tarefas.find(
      (t) => (t.notes ?? "").includes(MARCA_VESPERA) && ms(t.scheduled_at) <= ms(fimDeAmanha),
    ) ?? null
  );
}

/** Aviso que vai para a IA na leitura da véspera (junto com o estado do app). */
export function blocoDaVespera(t: { scheduled_at: string; motivo: string | null }): string {
  const quando = new Date(t.scheduled_at)
    .toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" })
    .slice(0, 16)
    .replace(" ", "T");
  return [
    `TAREFA DE AMANHÃ: a equipe já tem uma tarefa sua marcada para ${quando}${t.motivo ? ` (${t.motivo})` : ""}, com a mensagem ainda em rascunho.`,
    `Esta é a leitura da véspera: escreva agora a mensagem final dessa tarefa (acao "agendar", quando ${quando}), com o que a conversa mostra hoje.`,
    "O toque marcado e o retorno combinado acima são essa mesma tarefa: não use como motivo para esperar. Só não escreva se a conversa mostrar que não faz mais sentido chamar.",
  ].join("\n");
}

export const RESULTADO_CAMPANHA =
  "saiu da lista: mais de 7 dias sem resposta do cliente (lead guardado para campanha)";
export const RESULTADO_MUDOU = "saiu da lista: a situação mudou";

const PREFIXO_ONTEM = /^(Pendente de ontem \(\d+ª vez\)\.\s*)+/;
/** Notas da tarefa que voltou: um prefixo só, sem empilhar os das noites anteriores. */
export function notasDaQueVoltou(notas: string | null, vez: number): string {
  return `Pendente de ontem (${vez}ª vez). ${(notas ?? "").replace(PREFIXO_ONTEM, "")}`.slice(
    0,
    500,
  );
}

/** Selo do cartão da tarefa que voltou ("Pendente de ontem", "Volta há 3 dias"). */
export function seloDaQueVoltou(adiamentos: number): string | null {
  if (adiamentos <= 0) return null;
  return adiamentos === 1 ? "Pendente de ontem" : `Volta há ${adiamentos} dias`;
}

const MAX_NOMES = 5;

/**
 * Cobrança das tarefas não feitas no resumo da manhã (regra sobre a lista, sem IA):
 * "3 tarefas de ontem sem fazer: Ana (há 2 dias), Bia, Caio. ..." null quando não há nenhuma.
 */
export function linhaDasNaoFeitas(tarefas: Array<{ nome: string; dias: number }>): string | null {
  if (!tarefas.length) return null;
  const ordenadas = [...tarefas].sort((a, b) => b.dias - a.dias);
  const nomes = ordenadas.slice(0, MAX_NOMES).map((t) => {
    const n = (t.nome || "cliente sem nome").slice(0, 18);
    return t.dias > 1 ? `${n} (há ${t.dias} dias)` : n;
  });
  const resto = ordenadas.length - nomes.length;
  const n = tarefas.length;
  return (
    `${n} ${n === 1 ? "tarefa de ontem" : "tarefas de ontem"} sem fazer: ${nomes.join(", ")}` +
    `${resto > 0 ? ` e mais ${resto}` : ""}. Se não deu para fazer, toque em Pular e conte o motivo.`
  );
}

/** Junta a cobrança das não feitas com o resumo do recado, sem passar do limite do banco. */
export function resumoComNaoFeitas(linha: string | null, resumo: string, limite = 600): string {
  if (!linha) return resumo.slice(0, limite);
  if (linha.length >= limite) return linha.slice(0, limite);
  const sobra = limite - linha.length - 1;
  return `${linha} ${resumo.slice(0, Math.max(0, sobra))}`.trim();
}
