/**
 * Consumo das empresas no mês (Painel Nexa › Consumo): IA da Alice, áudio e mensagens automáticas
 * (campanhas, pós-atendimento e agenda dos técnicos, que não usam IA). Os números vêm do banco
 * (`consumo_empresas`, só a Nexa).
 */
export type ConsumoEmpresa = {
  empresa_id: string;
  nome: string;
  eh_teste: boolean;
  ia_respostas: number;
  ia_mensagens: number;
  ia_custo_usd: number;
  audios: number;
  audio_custo_reais: number;
  mkt_mensagens: number;
  pos_atendimento_mensagens: number;
  agenda_mensagens: number;
};

/** Mensagens que saíram sem IA (cada uma pode ter custo na Meta, pago pela empresa). */
export function mensagensAutomaticas(c: ConsumoEmpresa): number {
  return c.mkt_mensagens + c.pos_atendimento_mensagens + c.agenda_mensagens;
}

/** Totais das empresas reais (as de teste ficam fora). */
export function totaisDoConsumo(lista: ConsumoEmpresa[]) {
  const reais = lista.filter((c) => !c.eh_teste);
  const soma = (f: (c: ConsumoEmpresa) => number) =>
    Math.round(reais.reduce((s, c) => s + f(c), 0) * 10000) / 10000;
  return {
    iaRespostas: soma((c) => c.ia_respostas),
    iaCustoUsd: Math.round(soma((c) => c.ia_custo_usd) * 100) / 100,
    audioCustoReais: Math.round(soma((c) => c.audio_custo_reais) * 100) / 100,
    automaticas: soma(mensagensAutomaticas),
  };
}

/** Normaliza a linha do banco (números chegam como texto em numeric/bigint). */
export function lerConsumo(linha: Record<string, unknown>): ConsumoEmpresa {
  const n = (k: string) => Number(linha[k] ?? 0) || 0;
  return {
    empresa_id: String(linha["empresa_id"]),
    nome: String(linha["nome"] ?? ""),
    eh_teste: linha["eh_teste"] === true,
    ia_respostas: n("ia_respostas"),
    ia_mensagens: n("ia_mensagens"),
    ia_custo_usd: n("ia_custo_usd"),
    audios: n("audios"),
    audio_custo_reais: n("audio_custo_reais"),
    mkt_mensagens: n("mkt_mensagens"),
    pos_atendimento_mensagens: n("pos_atendimento_mensagens"),
    agenda_mensagens: n("agenda_mensagens"),
  };
}
