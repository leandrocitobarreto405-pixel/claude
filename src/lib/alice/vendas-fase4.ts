/**
 * Plano "Alice e vendas", fase 4 (itens 6, 8, 9 e 10). Funções puras; cada parte só vale com a
 * sua chave em ia_configuracoes (todas começam desligadas):
 * - retomada_manha_alice: o toque 3 da trilha A sai pela Alice às 8h do dia seguinte, uma frase só;
 * - followup5_novo: o toque 5 leva o desconto total a 20% (piso de R$ 200) com o valor na mensagem;
 * - retorno_alice_cobre: retorno marcado pela equipe e ninguém chamou em 15 min → a Alice chama;
 * - fora_area_regra: fora da área, só transfere pedido grande perto; senão despede e registra.
 * Nenhum texto aqui vai ao cliente sem a chave da empresa ligada.
 */
import type { Passo } from "./cadencia";

export type ChavesFase4 = {
  retomadaManha: boolean;
  followup5: boolean;
  followup5Pct: number;
  followup5Piso: number;
  retornoCobre: boolean;
  retornoCobreMin: number;
  foraAreaRegra: boolean;
  foraAreaKm: number;
  foraAreaPedidoMinimo: number;
};

const num = (v: unknown, padrao: number) => {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? padrao : n;
};

export function chavesFase4(cfg: unknown): ChavesFase4 {
  const c = (cfg ?? {}) as {
    retomada_manha_alice?: unknown;
    followup5_novo?: unknown;
    followup5_total_pct?: unknown;
    followup5_piso?: unknown;
    retorno_alice_cobre?: unknown;
    retorno_alice_cobre_min?: unknown;
    fora_area_regra?: unknown;
    fora_area_decisao_km?: unknown;
    fora_area_pedido_minimo?: unknown;
  };
  return {
    retomadaManha: c.retomada_manha_alice === true,
    followup5: c.followup5_novo === true,
    followup5Pct: Math.min(40, Math.max(0, num(c.followup5_total_pct, 20))),
    followup5Piso: Math.max(0, num(c.followup5_piso, 200)),
    retornoCobre: c.retorno_alice_cobre === true,
    retornoCobreMin: Math.max(1, num(c.retorno_alice_cobre_min, 15)),
    foraAreaRegra: c.fora_area_regra === true,
    foraAreaKm: Math.max(0, num(c.fora_area_decisao_km, 50)),
    foraAreaPedidoMinimo: Math.max(0, num(c.fora_area_pedido_minimo, 1000)),
  };
}

export const reais = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\u00a0/g, " ");

/* ------------------------------------------------------------------------------------------ */
/* Item 8: retomada da manhã (toque 3 da trilha A pela Alice, às 8h)                            */
/* ------------------------------------------------------------------------------------------ */

export const HORA_RETOMADA_MANHA = 8;
/** Modelo da Meta para a retomada fora da janela de 24 h ({{1}} = nome). */
export const MODELO_RETOMADA_MANHA = "fu_retomada_manha";

export const GUIA_RETOMADA_MANHA =
  'Retomada da manhã: mande UMA frase só, sem se apresentar, sem horários, valores, áudio ou outra pergunta. Escolha pelo que o cliente disse: se ele ia ver com a esposa, "Oi, [nome], bom dia! Conseguiu ver com a sua esposa?"; se ia ver com o marido, "Oi, [nome], bom dia! Conseguiu ver com o seu marido?"; nos outros casos, "Oi, [nome], bom dia! Conseguiu analisar o orçamento?". Sem nome confiável, comece por "Oi, bom dia!".';

/** Toque 3 da trilha A como retomada da Alice às 8h (com a chave); os outros passos não mudam. */
export function comRetomadaManha<P extends Passo | null>(passo: P, ligado: boolean): P {
  if (!passo || !ligado || passo.etapa !== "A3") return passo;
  return {
    ...passo,
    quando: { dia: 1, hora: HORA_RETOMADA_MANHA },
    guia: GUIA_RETOMADA_MANHA,
    modelo: MODELO_RETOMADA_MANHA,
    horarios: false,
    equipe: false,
    retomadaManha: true,
  };
}

/**
 * Retomada barrada por retorno combinado (correção do dono, 13/11): se o cliente tem retorno
 * pendente (trilha C da Alice ou retorno marcado pela equipe) a partir de 3 h atrás, a retomada das
 * 8h não sai. O cliente nunca recebe duas mensagens na mesma manhã.
 */
export function retornoBarraRetomada(
  retornos: Array<{ scheduled_at: string; trilha: string | null }>,
  agora: Date,
): boolean {
  const desde = agora.getTime() - 3 * 3_600_000;
  return retornos.some(
    (r) => (r.trilha === "C" || r.trilha === null) && Date.parse(r.scheduled_at) >= desde,
  );
}

/** Texto exato da retomada (conferência do ensaio e do modelo). */
export function textoRetomadaManha(nome: string | null, com: "esposa" | "marido" | null) {
  const oi = nome ? `Oi, ${nome}, bom dia!` : "Oi, bom dia!";
  if (com === "esposa") return `${oi} Conseguiu ver com a sua esposa?`;
  if (com === "marido") return `${oi} Conseguiu ver com o seu marido?`;
  return `${oi} Conseguiu analisar o orçamento?`;
}

/* ------------------------------------------------------------------------------------------ */
/* Item 9: follow-up 5 novo (desconto total até 20%, piso R$ 200)                              */
/* ------------------------------------------------------------------------------------------ */

export type EntradaOferta5 = {
  /** Valor cheio do orçamento atual (antes de qualquer desconto, com o deslocamento). */
  cheio: number;
  /** Desconto que o orçamento já tem (cupom, combo, campanha), em R$. */
  descontoAtual: number;
  /** O cliente já teve negociação (autorizada, automática, outro valor ou negada). */
  negociou: boolean;
  pct: number;
  piso: number;
};

export type Oferta5 =
  /** Desconto novo: valor final; `vinte` = o desconto total é exatamente o percentual cheio. */
  | { tipo: "desconto"; valor: number; vinte: boolean }
  /** Sem desconto novo: lembra o valor atual com prazo. */
  | { tipo: "lembrete"; valor: number };

const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Regra do dono (12/11): o desconto TOTAL chega a 20% e nunca passa. Sem desconto: 20%. Com cupom
 * ou combo: só o que falta para 20%. Já em 20% ou mais, ou já negociou: sem desconto novo (lembra o
 * valor com prazo). Valor final nunca abaixo do piso (R$ 200).
 */
export function calcularOferta5(e: EntradaOferta5): Oferta5 {
  const cheio = centavos(Math.max(0, e.cheio));
  const atual = centavos(Math.max(0, cheio - Math.max(0, e.descontoAtual)));
  if (e.negociou || cheio <= 0) return { tipo: "lembrete", valor: atual };
  const alvo = centavos(cheio * (1 - e.pct / 100));
  const valor = centavos(Math.max(alvo, e.piso));
  // Só vale se baixar pelo menos R$ 1 do valor de hoje.
  if (valor > atual - 1) return { tipo: "lembrete", valor: atual };
  const semDescontoAntes = e.descontoAtual <= 0.009;
  return { tipo: "desconto", valor, vinte: semDescontoAntes && Math.abs(valor - alvo) < 0.01 };
}

/** Modelos da Meta do toque 5 com 20% ({{1}} = nome, {{2}} = valor, ex.: "480,00"). */
export const MODELO_OFERTA5_VAGA = "fu_orcamento_20_vaga";
export const MODELO_OFERTA5_SEMANA = "fu_orcamento_20_proxima_semana";

const comNome = (nome: string | null, resto: string) =>
  nome ? `${nome}, ${resto}` : resto.charAt(0).toUpperCase() + resto.slice(1);

/**
 * Texto do toque 5 (textos aprovados em 12/11). Com vaga nesta semana ou não; 20% cheios ou valor
 * final sem porcentagem (cupom/combo/piso); lembrete com prazo quando não há desconto novo.
 */
export function textoOferta5(o: {
  nome: string | null;
  oferta: Oferta5;
  comVaga: boolean;
  pct: number;
  /** Dia do prazo do lembrete ("sexta"). */
  prazo: string;
}): string {
  const v = reais(o.oferta.valor);
  if (o.oferta.tipo === "lembrete")
    return comNome(
      o.nome,
      `seu orçamento de ${v} vale até ${o.prazo}. Quer que eu reserve um horário pra você?`,
    );
  const pct = `${o.pct.toLocaleString("pt-BR")}%`;
  if (o.comVaga)
    return comNome(
      o.nome,
      o.oferta.vinte
        ? `abriram alguns horários nesta semana e consigo chegar em ${pct} de desconto no seu orçamento: fica ${v}. Quer ver os horários disponíveis?`
        : `abriram alguns horários nesta semana e consigo fazer o seu orçamento por ${v}. Quer ver os horários disponíveis?`,
    );
  return comNome(
    o.nome,
    o.oferta.vinte
      ? `as vagas desta semana já esgotaram e estamos fechando a agenda da semana que vem. Como você já fez o orçamento com a gente, consigo ${pct} de desconto: fica ${v}. Quer aproveitar?`
      : `as vagas desta semana já esgotaram e estamos fechando a agenda da semana que vem. Como você já fez o orçamento com a gente, consigo fazer por ${v}. Quer aproveitar?`,
  );
}

/** Modelo do toque 5 fora da janela: só a versão com os 20% cheios e com nome; senão, equipe. */
export function modeloDaOferta5(o: {
  nome: string | null;
  oferta: Oferta5;
  comVaga: boolean;
}): { modelo: string; valores: string[] } | null {
  if (o.oferta.tipo !== "desconto" || !o.oferta.vinte || !o.nome) return null;
  const valor = o.oferta.valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return {
    modelo: o.comVaga ? MODELO_OFERTA5_VAGA : MODELO_OFERTA5_SEMANA,
    valores: [o.nome, valor],
  };
}

/** Dia do prazo do lembrete e da oferta: amanhã ("sábado"). */
export function diaDoPrazo(agora: Date): string {
  const amanha = new Date(agora.getTime() + 86_400_000);
  return amanha.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "America/Sao_Paulo" });
}

/** Aviso à Alice no toque 5 novo: mandar exatamente o texto; se o cliente quiser, horários reais. */
export function avisoDaOferta5(texto: string, oferta: Oferta5): string {
  return [
    "Hora do toque 5 da trilha A (cadência do sistema). O cliente não respondeu desde a última mensagem da empresa.",
    `Mande exatamente esta mensagem, sem mudar nem acrescentar nada: "${texto}"`,
    oferta.tipo === "desconto"
      ? 'Se o cliente quiser, refaça o orçamento com criar_orcamento e desconto "oferta_followup" (o sistema aplica o valor desta mensagem; sem Pix por cima) e mande dois horários reais da agenda (consultar_agenda). Não ofereça nenhum outro desconto.'
      : "Não ofereça desconto nem condição nova. Se o cliente quiser, mande dois horários reais da agenda (consultar_agenda).",
    'Se não fizer sentido mandar (atendimento encerrado, cliente já decidiu), responda exatamente "NADA".',
    "Não agende o próximo toque: o sistema agenda sozinho.",
  ].join(" ");
}

/* ------------------------------------------------------------------------------------------ */
/* Item 6: retorno combinado marcado pela equipe e ninguém chamou                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * A Alice chama no lugar da equipe? Só quando passou o tempo (15 min) do horário combinado,
 * ninguém escreveu ao cliente desde o horário, o cliente não escreveu depois e a janela de 24 h do
 * WhatsApp está aberta (fora dela, fica a tarefa da equipe). Até 3 h depois do horário.
 */
export function deveCobrirRetorno(o: {
  agendado: Date;
  agora: Date;
  minutos: number;
  ultimaDoCliente: Date | null;
  ultimaEnviada: Date | null;
}): { cobrir: true } | { cobrir: false; motivo: string } {
  const passou = o.agora.getTime() - o.agendado.getTime();
  if (passou < o.minutos * 60_000) return { cobrir: false, motivo: "ainda no prazo da equipe" };
  if (passou > 3 * 3_600_000) return { cobrir: false, motivo: "passou de 3 h do horário" };
  if (o.ultimaEnviada && o.ultimaEnviada.getTime() >= o.agendado.getTime())
    return { cobrir: false, motivo: "a equipe já chamou" };
  if (o.ultimaDoCliente && o.ultimaDoCliente.getTime() >= o.agendado.getTime())
    return { cobrir: false, motivo: "o cliente já escreveu" };
  if (!o.ultimaDoCliente || o.agora.getTime() - o.ultimaDoCliente.getTime() > 24 * 3_600_000)
    return { cobrir: false, motivo: "fora da janela de 24 h (fica com a equipe)" };
  return { cobrir: true };
}

/** Texto aprovado: "Oi, [nome]! A Maria me pediu pra te chamar no horário combinado 💙 ..." */
export function textoRetornoDaEquipe(nome: string | null, atendente: string | null) {
  const oi = nome ? `Oi, ${nome}!` : "Oi!";
  const quem = atendente ? `A ${atendente} me pediu` : "A equipe me pediu";
  return `${oi} ${quem} pra te chamar no horário combinado 💙 Conseguiu ver a proposta?`;
}

/* ------------------------------------------------------------------------------------------ */
/* Item 10: fora da área                                                                       */
/* ------------------------------------------------------------------------------------------ */

export const DESPEDIDA_FORA_DA_AREA =
  "Poxa, [nome], infelizmente a gente ainda não atende a sua região 😕 Agradeço muito o seu contato!";

/** Fora da área: transfere só pedido grande perto (até 50 km e acima de R$ 1.000 pela tabela). */
export function decisaoForaDaArea(o: {
  kmIda: number | null;
  valorItens: number;
  km: number;
  pedidoMinimo: number;
}): "transferir" | "encerrar" {
  return o.kmIda !== null && o.kmIda <= o.km && o.valorItens > o.pedidoMinimo
    ? "transferir"
    : "encerrar";
}

/** O que a ferramenta devolve à Alice (nunca com o valor do pedido). */
export function textoDecisaoForaDaArea(
  decisao: "transferir" | "encerrar",
  kmIda: number | null,
  limite: number | null,
): string {
  const onde = `Endereço a ~${kmIda ?? "?"} km da base: fora da área atendida${limite !== null ? ` (até ${limite} km)` : ""}. Não passe valores.`;
  return decisao === "transferir"
    ? `${onde} É um pedido grande e perto: transfira para a equipe com o motivo "fora da área, pedido grande" (não diga o valor ao cliente).`
    : `${onde} Não transfira: encerre com educação, sem prometer especialista, com esta mensagem (sem pergunta no fim): "${DESPEDIDA_FORA_DA_AREA}". Depois use registrar_motivo_perda com o motivo "Fora da área".`;
}

/**
 * Follow-up 5 só depois dos toques anteriores (regra do dono, 13/11): se algum toque anterior da
 * sequência (o 3 ou o 4 da equipe, ou outro da trilha A) ainda está pendente, o 5 espera. Toque
 * cancelado não segura (o cliente respondeu, a equipe assumiu); feito ou marcado como feito libera.
 */
export function anterioresPendentes(
  toques: Array<{ etapa: string | null; status: string | null }>,
  etapa: string,
): string[] {
  const ordem = ["A1", "A2", "A3", "A4", "A5"];
  const ate = ordem.indexOf(etapa);
  if (ate <= 0) return [];
  return toques
    .filter((t) => t.status === "Pendente" && t.etapa && ordem.indexOf(t.etapa) > -1)
    .filter((t) => ordem.indexOf(t.etapa!) < ate)
    .map((t) => t.etapa!);
}
