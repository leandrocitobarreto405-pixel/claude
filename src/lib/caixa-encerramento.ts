/**
 * Encerramento automático de conversas (regras puras, sem banco): conversa em que a EMPRESA
 * (equipe ou Alice) falou por último e o cliente não respondeu em N horas vai para Encerradas no
 * Nexa e "resolved" no Chatwoot. Regras:
 *  0. conversa com o cliente falando por último NUNCA é encerrada por tempo: fica em "Precisam"
 *     com "sem resposta há X h" destacado (21/10: 48 clientes esperando foram encerrados);
 *  1. conversa com follow-up, lembrete, pós-venda ou campanha agendados e ainda não enviados
 *     (ou com tarefa da Alice pendente) NÃO encerra até sair;
 *  2. ao reabrir por mensagem do cliente, volta para quem estava com ela (Alice ou equipe) e
 *     para a aba certa — é a marca encerrada_de (gatilho do banco);
 *  3. encerrar não manda nada ao cliente: só muda o status no Nexa e resolved no Chatwoot
 *     (a pesquisa de satisfação do Chatwoot está desligada na caixa).
 * Padrão: ligado, 24 h, equipe e Alice; cada empresa ajusta em Configurações › Mensagens.
 * Roda de hora em hora.
 */
export type ConfigEncerramento = {
  ligado: boolean;
  /** Horas sem mensagem (de 1 a 720). */
  horas: number;
  /** Também encerra as conversas que estão com a Alice (status "pending"). */
  incluirAlice: boolean;
};

export const PADRAO_ENCERRAMENTO: ConfigEncerramento = {
  ligado: true,
  horas: 24,
  incluirAlice: true,
};

export const CHAVE_CONFIG_CAIXA = "caixa_entrada";

/** "Digitando… e lido" na Meta: ligado por padrão (só faz algo onde há conexão Meta). */
export function digitandoLigado(salvo: unknown): boolean {
  const s = (salvo && typeof salvo === "object" ? salvo : {}) as Record<string, unknown>;
  return s["digitando_meta"] !== false;
}

/** Intervalo entre rodadas por empresa. */
export const INTERVALO_RODADA_MS = 55 * 60_000;

/**
 * Conversas por rodada e por empresa. Quando uma rodada enche o lote (sobrou fila, como na
 * primeira rodada da Turbine, ~600), a próxima varredura (5 min) continua em vez de esperar a
 * hora: o lote fica abaixo do limite de chamadas por minuto do Chatwoot.
 */
export const MAX_POR_RODADA = 250;

/** Lê o que está salvo em app_settings "caixa_entrada" (parcial ou vazio) com os padrões. */
export function configEncerramento(salvo: unknown): ConfigEncerramento {
  const s = (salvo && typeof salvo === "object" ? salvo : {}) as Record<string, unknown>;
  const horas = Number(s["encerramento_horas"]);
  return {
    ligado:
      typeof s["encerramento_automatico"] === "boolean"
        ? s["encerramento_automatico"]
        : PADRAO_ENCERRAMENTO.ligado,
    horas:
      Number.isFinite(horas) && horas >= 1 && horas <= 720
        ? Math.round(horas)
        : PADRAO_ENCERRAMENTO.horas,
    incluirAlice:
      typeof s["encerramento_inclui_alice"] === "boolean"
        ? s["encerramento_inclui_alice"]
        : PADRAO_ENCERRAMENTO.incluirAlice,
  };
}

/** O que gravar em app_settings (junto com o que já houver na chave). */
export function paraSalvar(c: ConfigEncerramento): Record<string, unknown> {
  return {
    encerramento_automatico: c.ligado,
    encerramento_horas: c.horas,
    encerramento_inclui_alice: c.incluirAlice,
  };
}

/** Situações que o encerramento alcança. */
export function situacoesAlcancadas(c: ConfigEncerramento): string[] {
  return c.incluirAlice ? ["open", "pending"] : ["open"];
}

/** Instante-limite: conversas com última atividade antes disto estão paradas. */
export function limiteParada(c: ConfigEncerramento, agora = new Date()): string {
  return new Date(agora.getTime() - c.horas * 3_600_000).toISOString();
}

/**
 * Hora de rodar de novo? Última rodada e resultado ficam em app_settings; sem registro, roda.
 * Se a rodada anterior encheu o lote, continua já na próxima varredura.
 */
export function horaDeRodar(
  ultimaRodada: unknown,
  agora = new Date(),
  ultimoResultado?: unknown,
): boolean {
  if (typeof ultimaRodada !== "string") return true;
  const t = new Date(ultimaRodada).getTime();
  if (!Number.isFinite(t)) return true;
  const r = (ultimoResultado && typeof ultimoResultado === "object" ? ultimoResultado : {}) as {
    lotada?: unknown;
  };
  if (r.lotada === true) return true;
  return agora.getTime() - t >= INTERVALO_RODADA_MS;
}

export type Candidata = {
  id: string;
  status: string | null;
  crm_lead_id: string | null;
  chatwoot_conversation_id: number | string;
  normalized_phone: string | null;
};

export type Pendencias = {
  /** Conversas em que a última mensagem é do cliente (ele espera resposta). */
  clientePorUltimo: Iterable<string>;
  /** Follow-ups pendentes (da Alice ou da equipe): por conversa ou por lead. */
  followups: Array<{ conversa_id: string | null; crm_lead_id: string | null }>;
  /** Envios de marketing ainda não enviados (lembretes 6 m/13º mês, pós-venda, campanhas). */
  envios: Array<{
    normalized_phone: string | null;
    chatwoot_conversation_id: number | string | null;
  }>;
  /** Tarefas da Alice pendentes (responder, follow-up, devolver…). */
  tarefas: Array<{ conversa_id: string | null }>;
};

export type Selecao<T extends Candidata> = {
  encerrar: T[];
  /** Quantas ficaram de fora e por quê (cliente = regra 0; o resto, regra 1). */
  protegidas: { total: number; cliente: number; followup: number; envio: number; tarefa: number };
  /** O lote encheu (vieram tantas candidatas quanto o limite): ainda há fila. */
  lotada: boolean;
};

/** Regras 0 e 1: separa as que podem encerrar das que têm o cliente esperando ou algo agendado. */
export function aplicarRegra1<T extends Candidata>(
  candidatas: T[],
  p: Pendencias,
  limite = MAX_POR_RODADA,
): Selecao<T> {
  const conversasComFollowup = new Set(p.followups.map((f) => f.conversa_id).filter(Boolean));
  const leadsComFollowup = new Set(p.followups.map((f) => f.crm_lead_id).filter(Boolean));
  const fonesComEnvio = new Set(p.envios.map((e) => e.normalized_phone).filter(Boolean));
  const chatwootComEnvio = new Set(
    p.envios
      .map((e) => e.chatwoot_conversation_id)
      .filter((x) => x != null)
      .map(String),
  );
  const conversasComTarefa = new Set(p.tarefas.map((t) => t.conversa_id).filter(Boolean));
  const clientePorUltimo = new Set(p.clientePorUltimo);
  const protegidas = { total: 0, cliente: 0, followup: 0, envio: 0, tarefa: 0 };
  const encerrar: T[] = [];
  for (const c of candidatas) {
    if (clientePorUltimo.has(c.id)) {
      protegidas.total++;
      protegidas.cliente++;
      continue;
    }
    const followup =
      conversasComFollowup.has(c.id) ||
      (c.crm_lead_id != null && leadsComFollowup.has(c.crm_lead_id));
    const envio =
      (c.normalized_phone != null && fonesComEnvio.has(c.normalized_phone)) ||
      chatwootComEnvio.has(String(c.chatwoot_conversation_id));
    const tarefa = conversasComTarefa.has(c.id);
    if (followup || envio || tarefa) {
      protegidas.total++;
      if (followup) protegidas.followup++;
      if (envio) protegidas.envio++;
      if (tarefa) protegidas.tarefa++;
    } else encerrar.push(c);
  }
  return { encerrar, protegidas, lotada: candidatas.length >= limite };
}

/** Marca de quem estava com a conversa ao encerrar (regra 2). */
export function encerradaDe(status: string | null | undefined): "alice" | "equipe" {
  return status === "pending" ? "alice" : "equipe";
}
