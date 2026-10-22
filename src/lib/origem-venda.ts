// Origem da venda detectada (orçamento e OS): o aviso embaixo do campo e as regras de
// obrigatoriedade. A detecção em si é do banco (public.origem_detectada_venda, migração
// 20261201120000). Sem banco nem rede, para testar.

export type ComoDetectada =
  | "landing"
  | "botao_anuncio"
  | "site_blog"
  | "canal"
  | "primeira_mensagem"
  | "campanha"
  | "indicacao"
  | "cliente_antigo"
  | "alice";

export type OrigemDetectada = { origemId: string; como: ComoDetectada };

const COMO: Record<ComoDetectada, string> = {
  landing: "pela landing (pop-up do anúncio)",
  botao_anuncio: "pelo botão de WhatsApp do anúncio",
  site_blog: "pelo texto do site ou do blog",
  canal: "pelo canal (Instagram ou Facebook)",
  primeira_mensagem: "pela primeira mensagem",
  campanha: "pela resposta à campanha",
  indicacao: "pela indicação registrada",
  cliente_antigo: "cliente com serviço anterior",
  alice: "pela Alice",
};

/** Resposta da função do banco ({} quando nada foi detectado). */
export function lerDeteccao(r: unknown): OrigemDetectada | null {
  const o = (r ?? {}) as { origem_id?: unknown; como?: unknown };
  if (typeof o.origem_id !== "string" || !o.origem_id) return null;
  const como = typeof o.como === "string" && o.como in COMO ? (o.como as ComoDetectada) : null;
  return como ? { origemId: o.origem_id, como } : null;
}

/** "detectada pela primeira mensagem", "detectada pela landing (pop-up do anúncio)"… */
export function avisoDaDeteccao(como: string | null | undefined): string | null {
  if (!como || !(como in COMO)) return null;
  const texto = COMO[como as ComoDetectada];
  return como === "cliente_antigo" ? `detectada: ${texto}` : `detectada ${texto}`;
}

/** Código da origem (metadata.codigo) de uma opção, ou "". */
export function codigoDaOrigem(
  opcoes: Array<{ id: string; metadata?: unknown }>,
  id: string | null | undefined,
): string {
  const o = opcoes.find((x) => x.id === id);
  const cod = (o?.metadata as { codigo?: unknown } | null | undefined)?.codigo;
  return typeof cod === "string" ? cod : "";
}

/** Erro da origem (vazia, ou indicação sem o nome de quem indicou), ou null. */
export function erroDaOrigem(o: {
  origemId: string;
  origemCodigo: string;
  indicacaoNome: string;
}): string | null {
  if (!o.origemId) return "Selecione a origem da venda.";
  if (o.origemCodigo === "indicacao" && o.indicacaoNome.trim().length < 2)
    return "Informe quem indicou.";
  return null;
}

/** Ao trocar a origem: a indicação só fica quando a origem continua sendo indicação. */
export function semIndicacaoSeNaoFor(codigo: string, nome: string): string {
  return codigo === "indicacao" ? nome : "";
}

export type LinhaDeteccao = {
  id: string;
  osNumber: string;
  criadaEm: string;
  escolhidaId: string | null;
  detectadaId: string | null;
  como: string | null;
  trocadaPor: string | null;
};

/** Quadro "Detecção da origem": quantas OS tiveram a origem detectada, quantas ficaram iguais e
 *  quais foram trocadas. As da Alice ficam à parte (ela grava a própria escolha como detectada). */
export function resumoDeteccao(linhas: LinhaDeteccao[]) {
  const daEquipe = linhas.filter((l) => l.detectadaId && l.como !== "alice");
  const trocadas = daEquipe.filter((l) => l.escolhidaId && l.escolhidaId !== l.detectadaId);
  const semDeteccao = linhas.filter((l) => !l.detectadaId).length;
  return {
    detectadas: daEquipe.length,
    iguais: daEquipe.length - trocadas.length,
    trocadas,
    pctIguais: daEquipe.length
      ? Math.round(((daEquipe.length - trocadas.length) * 100) / daEquipe.length)
      : null,
    daAlice: linhas.filter((l) => l.como === "alice").length,
    semDeteccao,
  };
}
