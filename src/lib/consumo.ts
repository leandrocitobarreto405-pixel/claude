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

/** Cotação do dólar da Alice: revisar a cada 30 dias (Painel Nexa avisa). */
export const DIAS_REVISAR_COTACAO = 30;

export function cotacaoVencida(
  atualizadaEm: string | null,
  agora: Date,
  dias = DIAS_REVISAR_COTACAO,
) {
  if (!atualizadaEm) return true;
  return agora.getTime() - Date.parse(atualizadaEm) > dias * 86_400_000;
}

/** Valor digitado ("5,65") vira número; inválido ou fora da faixa (padrão 1 a 20), null. */
export function lerCotacao(texto: string, minimo = 1, maximo = 20): number | null {
  const n = Number(texto.replace(",", ".").trim());
  if (!texto.trim() || !Number.isFinite(n) || n < minimo || n > maximo) return null;
  return Math.round(n * 10000) / 10000;
}

export type FranquiaEmpresa = {
  empresa_id: string;
  conversas: number;
  franquia: number | null;
  trava: boolean;
  excedentes: number;
  valor_excedente: number;
  para_equipe: number;
};

export function lerFranquia(linha: Record<string, unknown>): FranquiaEmpresa {
  return {
    empresa_id: String(linha["empresa_id"]),
    conversas: Number(linha["conversas"] ?? 0),
    franquia:
      linha["franquia"] === null || linha["franquia"] === undefined
        ? null
        : Number(linha["franquia"]),
    trava: linha["trava"] === true,
    excedentes: Number(linha["excedentes"] ?? 0),
    valor_excedente: Number(linha["valor_excedente"] ?? 0),
    para_equipe: Number(linha["para_equipe"] ?? 0),
  };
}
