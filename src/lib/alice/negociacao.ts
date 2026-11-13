/**
 * Desconto com autorização (plano "Alice e vendas", item 5; decisões do dono em 12/11). A Alice nunca
 * dá desconto sozinha: pede autorização ao gestor com um valor sugerido. Regras puras, sem banco.
 *
 * - Teto: o desconto TOTAL (combo, cupom e negociação juntos) vai até 12% do valor cheio; esse é o
 *   valor final, sem o Pix por cima. No Pix, o máximo é 15% no total.
 * - Concorrente dentro do teto: sugere igualar. Mais de 12% abaixo: sugere o teto e mostra quanto
 *   falta para igualar (igualar só com autorização).
 * - Sem resposta em 10 minutos, a Alice segue sozinha com o sugerido (dentro do teto). Nunca segue
 *   sozinha quando o cliente tem cupom, nem de noite quando o pedido passa do teto.
 * - Volta ao cliente no mínimo 4 minutos depois do pedido, mesmo se autorizarem antes.
 */

export type ParametrosNegociacao = {
  /** Teto do desconto total, em % do valor cheio (padrão 12). */
  tetoPct: number;
  /** Teto quando o cliente pergunta do Pix (padrão 15). */
  tetoPixPct: number;
  /** Minutos sem resposta até a Alice seguir sozinha (padrão 10). */
  esperaMin: number;
  /** Minutos mínimos antes de a Alice voltar ao cliente (padrão 4). */
  voltaMin: number;
};

export function parametrosDaConfig(cfg: unknown): ParametrosNegociacao & { ligada: boolean } {
  const c = (cfg ?? {}) as Record<string, unknown>;
  const num = (k: string, padrao: number, min: number, max: number) => {
    const v = Number(c[k]);
    return Number.isFinite(v) && v >= min && v <= max ? v : padrao;
  };
  return {
    ligada: c["negociacao_ligada"] === true,
    tetoPct: num("negociacao_teto_pct", 12, 0, 30),
    tetoPixPct: num("negociacao_teto_pix_pct", 15, 0, 30),
    esperaMin: num("negociacao_espera_min", 10, 1, 120),
    voltaMin: num("negociacao_volta_min", 4, 1, 30),
  };
}

export type EntradaPedido = {
  /** Valor cheio do orçamento (soma dos itens, antes de qualquer desconto). */
  valorCheio: number;
  /** Desconto que o orçamento já tem (combo, cupom, campanha, indicação), em reais. */
  descontoAtual: number;
  /** O cliente tem cupom (a Alice nunca segue sozinha). */
  temCupom: boolean;
  /** Valor da outra empresa, quando o cliente disse. */
  concorrente: number | null;
  /** O pedido acontece fora do horário de atendimento. */
  foraDoHorario: boolean;
};

export type Pedido = {
  /** Valor final sugerido ao gestor (reais inteiros, nunca passando do teto). */
  valorSugerido: number;
  /** Desconto total do sugerido sobre o valor cheio. */
  descontoValor: number;
  descontoPct: number;
  /** Quanto falta para igualar o concorrente (só quando ele está abaixo do teto). */
  faltaParaIgualar: number | null;
  /** O concorrente está mais de 12% abaixo do valor cheio. */
  acimaDoTeto: boolean;
  /** Sem resposta no prazo, a Alice segue com o sugerido. */
  segueSozinha: boolean;
  /** Valor mínimo no Pix (teto do Pix), só para a equipe ver. */
  valorPixMinimo: number;
  /** O orçamento já está no teto ou acima: não há mais o que sugerir sem a equipe. */
  jaNoTeto: boolean;
};

const centavos = (v: number) => Math.round(v * 100) / 100;

export function calcularPedido(e: EntradaPedido, p: ParametrosNegociacao): Pedido {
  const cheio = centavos(e.valorCheio);
  const atual = centavos(Math.max(0, cheio - e.descontoAtual));
  // Valor no teto, arredondado para o real de cima (o desconto nunca passa do teto).
  const noTeto = Math.ceil(cheio * (1 - p.tetoPct / 100));
  const valorPixMinimo = Math.ceil(cheio * (1 - p.tetoPixPct / 100));
  const jaNoTeto = atual <= noTeto;
  let sugerido: number;
  let falta: number | null = null;
  let acimaDoTeto = false;
  if (e.concorrente !== null && e.concorrente > 0) {
    if (e.concorrente >= noTeto) {
      sugerido = Math.min(atual, Math.ceil(e.concorrente));
    } else {
      sugerido = Math.min(atual, noTeto);
      acimaDoTeto = true;
      falta = centavos(sugerido - e.concorrente);
    }
  } else {
    sugerido = Math.min(atual, noTeto);
  }
  sugerido = Math.max(1, sugerido);
  const descontoValor = centavos(cheio - sugerido);
  return {
    valorSugerido: sugerido,
    descontoValor,
    descontoPct: cheio > 0 ? Math.round((descontoValor / cheio) * 10000) / 100 : 0,
    faltaParaIgualar: falta,
    acimaDoTeto,
    // Cupom: nunca sozinha. De noite, passando do teto: espera o gestor de manhã. Já no teto: não
    // há desconto novo para a Alice dar sozinha.
    segueSozinha: !e.temCupom && !(e.foraDoHorario && acimaDoTeto) && !jaNoTeto,
    valorPixMinimo,
    jaNoTeto,
  };
}

/** Frase para o cliente enquanto o pedido está com o gestor (textos aprovados pelo dono). */
export function fraseDeEspera(o: { nome: string | null; noite: boolean }): string {
  return o.noite
    ? `Já deixei seu pedido com o meu gestor${o.nome ? `, ${o.nome}` : ""}. Amanhã logo cedo eu te confirmo o valor, tá bom? 💙`
    : "Me dá uns minutinhos que eu já volto com a resposta, tá bom? 💙";
}

/** Frase quando o gestor nega (texto aprovado: sem falar em Pix; o valor é o que já foi passado). */
export function fraseDeNegado(o: { nome: string | null; valor: number }): string {
  return `Falei com o meu gestor e não consegui baixar mais${o.nome ? `, ${o.nome}` : ""}. O que eu consigo é manter os ${reais(o.valor)} e já reservar o seu horário. Quer que eu reserve?`;
}

export const reais = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

export type SituacaoAutorizacao =
  "pendente" | "autorizado" | "outro_valor" | "negado" | "automatico" | "assumido" | "cancelado";

export type AutorizacaoAberta = {
  situacao: SituacaoAutorizacao;
  criadoEm: string;
  prazoEm: string | null;
  voltarApos: string;
  segueSozinha: boolean;
  respondidoEm: string | null;
  clienteAvisadoEm: string | null;
};

/** O que a varredura faz agora com o pedido. */
export function proximoPasso(
  a: AutorizacaoAberta,
  agora: Date,
): "esperar" | "seguir_sozinha" | "avisar_cliente" | "nada" {
  const t = agora.getTime();
  if (a.clienteAvisadoEm) return "nada";
  if (a.situacao === "pendente") {
    if (a.segueSozinha && a.prazoEm && t >= Date.parse(a.prazoEm)) return "seguir_sozinha";
    return "esperar";
  }
  if (["autorizado", "outro_valor", "negado", "automatico"].includes(a.situacao))
    return t >= Date.parse(a.voltarApos) ? "avisar_cliente" : "esperar";
  return "nada";
}

/** Aviso do sistema para a Alice voltar ao cliente com a resposta do gestor. */
export function avisoDaVolta(o: {
  situacao: "autorizado" | "outro_valor" | "negado" | "automatico";
  valorFinal: number | null;
  valorAtual: number;
  valorCheio: number;
  nome: string | null;
  acimaDoTeto: boolean;
  combo: boolean;
}): string {
  if (o.situacao === "negado")
    return [
      "Volta da autorização de desconto: o gestor NÃO liberou desconto.",
      `Mande ao cliente exatamente esta frase e nada mais: "${fraseDeNegado({ nome: o.nome, valor: o.valorAtual })}"`,
      "Não crie orçamento novo, não ofereça Pix nem outro desconto.",
    ].join(" ");
  const valor = reais(o.valorFinal ?? o.valorAtual);
  const pct =
    o.valorCheio > 0 ? Math.round((1 - (o.valorFinal ?? 0) / o.valorCheio) * 1000) / 10 : 0;
  const frase =
    o.situacao === "automatico" && o.acimaDoTeto
      ? `Consegui chegar em ${valor}! 🎉`
      : `Consegui liberar! 🎉 Ficou ${valor}.`;
  return [
    `Volta da autorização de desconto: o valor liberado é ${valor} (desconto total de ${pct.toLocaleString("pt-BR")}% sobre o valor cheio). Esse é o valor final: não fale em Pix nem em outro desconto.`,
    `Numa resposta só: (1) criar_orcamento com os mesmos itens${o.combo ? " (combo true)" : ""} e desconto "negociacao" (o sistema aplica o valor liberado); (2) enviar_mensagem com o cartão do orçamento inteiro; (3) consultar_agenda e o texto final: "${frase} Tenho duas vagas: [dia e horário] ou [dia e horário]. Qual é melhor pra você?" (dois horários reais, em dias diferentes).`,
  ].join(" ");
}

/** Aviso do momento enquanto o pedido está com o gestor. */
export const AVISO_AUTORIZACAO_PENDENTE =
  "Você pediu autorização de desconto ao gestor e ele ainda não respondeu. Se o cliente escrever, responda o que ele perguntou e diga que ainda está vendo com o gestor e já volta. Não prometa valor, não dê desconto e não peça outra autorização.";

export function textoDoPush(o: {
  nome: string;
  final: string;
  valorCheio: number;
  valorAtual: number;
  sugerido: number;
  pct: number;
  concorrente: number | null;
  cupom: number | null;
  minutos: number;
}): { titulo: string; corpo: string } {
  const quem = `${o.nome || "Cliente"}${o.final ? ` (final ${o.final})` : ""}`;
  const partes = [
    `Orçamento ${reais(o.valorAtual)}${o.valorAtual !== o.valorCheio ? ` (cheio ${reais(o.valorCheio)})` : ""}.`,
    `Sugerido: ${reais(o.sugerido)} (${o.pct.toLocaleString("pt-BR")}%).`,
  ];
  if (o.concorrente) partes.push(`Concorrente: ${reais(o.concorrente)}.`);
  if (o.cupom) partes.push(`Cliente já tem cupom de ${reais(o.cupom)}.`);
  if (o.minutos > 0) partes.push(`Esperando há ${o.minutos} min.`);
  return { titulo: `💰 Autorizar desconto: ${quem}`, corpo: partes.join(" ") };
}
