/**
 * Tatiana, desempenho de campanha (01/11/2026): regras puras. Cada campanha de WhatsApp enviada é
 * acompanhada por 7 dias a partir do primeiro envio: enviados, responderam, pediram orçamento,
 * fecharam, R$ vendido, custo de envio e retorno; respostas classificadas (botão, descadastro ou
 * IA) e, no fim da janela, 2–3 sugestões para a próxima campanha. Nada é enviado a clientes.
 */

export const JANELA_DIAS = 7;

export const CLASSES_RESPOSTA = [
  "interesse",
  "preco",
  "sem_interesse",
  "descadastro",
  "duvida",
  "outro",
] as const;
export type ClasseResposta = (typeof CLASSES_RESPOSTA)[number];

export const NOME_CLASSE: Record<ClasseResposta, string> = {
  interesse: "Interesse",
  preco: "Perguntou preço",
  sem_interesse: "Não quer",
  descadastro: "Pediu para parar",
  duvida: "Dúvida",
  outro: "Outra",
};

export type EnvioCampanha = {
  id: string;
  status: string;
  enviadoEm: string | null;
  respondidoEm: string | null;
  botaoClicado: string | null;
  quoteId: string | null;
  workOrderId: string | null;
  valorVenda: number | null;
  bloqueio: boolean;
  /** Opt-out do contato (data) para contar descadastro depois do envio. */
  optoutEm: string | null;
};

export type NumerosCampanha = {
  enviados: number;
  erros: number;
  responderam: number;
  orcamentos: number;
  fecharam: number;
  vendido: number;
  /** Custo de envio em R$ (enviados × custo por mensagem). */
  custo: number;
  /** R$ vendido ÷ custo (null sem custo). */
  retorno: number | null;
  descadastros: number;
  bloqueios: number;
  /** Respostas ÷ enviados, em %. */
  pctResposta: number | null;
  pctVenda: number | null;
};

/** Janela de acompanhamento: do primeiro envio até 7 dias depois. */
export function janelaDaCampanha(envios: EnvioCampanha[]): { inicio: string; fim: string } | null {
  const datas = envios.map((e) => e.enviadoEm).filter((d): d is string => Boolean(d));
  if (!datas.length) return null;
  const inicio = datas.sort()[0]!;
  return {
    inicio,
    fim: new Date(Date.parse(inicio) + JANELA_DIAS * 86_400_000).toISOString(),
  };
}

export function numerosDaCampanha(
  envios: EnvioCampanha[],
  custoMsg: number,
  fim: string,
): NumerosCampanha {
  const ate = Date.parse(fim);
  const dentro = (d: string | null) => d !== null && Date.parse(d) <= ate;
  const enviados = envios.filter((e) => e.status === "enviado").length;
  const responderam = envios.filter((e) => dentro(e.respondidoEm)).length;
  const fechados = envios.filter((e) => e.workOrderId);
  const vendido =
    Math.round(fechados.reduce((s, e) => s + Number(e.valorVenda ?? 0), 0) * 100) / 100;
  const custo = Math.round(enviados * custoMsg * 100) / 100;
  return {
    enviados,
    erros: envios.filter((e) => e.status === "erro").length,
    responderam,
    orcamentos: envios.filter((e) => e.quoteId).length,
    fecharam: fechados.length,
    vendido,
    custo,
    retorno: custo > 0 ? Math.round((vendido / custo) * 10) / 10 : null,
    descadastros: envios.filter(
      (e) => e.optoutEm && e.enviadoEm && e.optoutEm >= e.enviadoEm && dentro(e.optoutEm),
    ).length,
    bloqueios: envios.filter((e) => e.bloqueio).length,
    pctResposta: enviados ? Math.round((responderam / enviados) * 1000) / 10 : null,
    pctVenda: enviados ? Math.round((fechados.length / enviados) * 1000) / 10 : null,
  };
}

/**
 * Classe pelo que o sistema já sabe (botão do modelo, opt-out): sem IA. null = precisa ler a
 * resposta. `botoes` é a configuração da empresa (texto do botão → ação).
 */
export function classePeloSistema(
  e: EnvioCampanha,
  botoes: Record<string, string>,
): ClasseResposta | null {
  if (e.optoutEm && e.enviadoEm && e.optoutEm >= e.enviadoEm) return "descadastro";
  if (e.botaoClicado) {
    const acao = botoes[e.botaoClicado.toLowerCase()] ?? botoes[e.botaoClicado] ?? "";
    if (acao === "interesse") return "interesse";
    if (acao === "sem_interesse") return "sem_interesse";
  }
  if (e.quoteId || e.workOrderId) return "interesse";
  return null;
}

/** Contagem por classe e a ordem para mostrar (mais comuns primeiro). */
export function resumoDasClasses(
  porEnvio: Record<string, ClasseResposta>,
): Array<{ classe: ClasseResposta; nome: string; n: number }> {
  const n = new Map<ClasseResposta, number>();
  for (const c of Object.values(porEnvio)) n.set(c, (n.get(c) ?? 0) + 1);
  return [...n.entries()]
    .map(([classe, total]) => ({ classe, nome: NOME_CLASSE[classe], n: total }))
    .sort((a, b) => b.n - a.n);
}

// ---------------------------------------------------------------- IA

export const ESQUEMA_CLASSES = {
  type: "object",
  additionalProperties: false,
  required: ["classes"],
  properties: {
    classes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "classe"],
        properties: {
          n: { type: "integer" },
          classe: { type: "string", enum: [...CLASSES_RESPOSTA] },
        },
      },
    },
  },
} as const;

export function instrucoesClasses(): string {
  return [
    "Você classifica respostas de clientes a uma campanha de WhatsApp de uma empresa de higienização e impermeabilização de estofados. Para cada resposta numerada, escolha UMA classe:",
    "interesse (quer orçamento, pergunta sobre o serviço, pede horário, diz sim), preco (pergunta ou reclama do preço, pede desconto), sem_interesse (não quer, não precisa, já fez, agora não), descadastro (pede para parar de receber mensagens, sair da lista, bloquear), duvida (pergunta que não é preço nem interesse claro: como funciona, área, prazo) ou outro (nada a ver, engano, só emoji).",
    "Devolva uma classe para cada número informado, sem pular nenhum.",
  ].join("\n");
}

export const TIPOS_SUGESTAO = ["texto", "oferta", "publico", "horario", "modelo"] as const;
export type TipoSugestao = (typeof TIPOS_SUGESTAO)[number];
export type Sugestao = { tipo: TipoSugestao; sugestao: string };
export const NOME_TIPO_SUGESTAO: Record<TipoSugestao, string> = {
  texto: "Texto",
  oferta: "Oferta",
  publico: "Público",
  horario: "Horário",
  modelo: "Modelo",
};

export const ESQUEMA_SUGESTOES = {
  type: "object",
  additionalProperties: false,
  required: ["leitura", "sugestoes"],
  properties: {
    leitura: { type: "string" },
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "sugestao"],
        properties: {
          tipo: { type: "string", enum: [...TIPOS_SUGESTAO] },
          sugestao: { type: "string" },
        },
      },
    },
  },
} as const;

export function instrucoesSugestoes(empresa: string): string {
  return [
    `Você é a Tatiana, gerente comercial da ${empresa} (higienização e impermeabilização de estofados). Você recebe os números de uma campanha de WhatsApp depois de 7 dias, o que foi enviado (modelo, oferta, público, horário), como as respostas se dividiram e trechos de respostas, além dos números das campanhas anteriores da empresa para comparar.`,
    "Escreva em português do Brasil, direto e prático, sem nomes de clientes.",
    "- leitura: 1 ou 2 frases sobre o resultado (foi bem ou mal em relação às anteriores, e por quê, pelas respostas).",
    "- sugestoes: 2 ou 3 sugestões concretas para a PRÓXIMA campanha, cada uma com um tipo: texto (como escrever), oferta (desconto/condição, sem passar do que a empresa permite), publico (quem receber ou quem tirar), horario (dia/hora do envio) ou modelo (o modelo da Meta: botões, pergunta, variável). Nada é aplicado sem o dono aprovar.",
    "- Não invente números: use os informados. Se a campanha ainda não vendeu, diga o que testar, não prometa resultado.",
  ].join("\n");
}

/** Campanha como entra no relatório de domingo (dados.campanhas). */
export type CampanhaRelatorio = {
  nome: string;
  resumo: string;
  numeros: NumerosCampanha;
  classes: Array<{ nome: string; n: number }>;
  sugestoes: Sugestao[];
  leitura: string | null;
  encerrada: boolean;
};

/** Texto curto para o relatório e a tela: "120 enviados · 18 responderam · 3 vendas (R$ 1.200)". */
export function resumoCurto(n: NumerosCampanha): string {
  const brl = (v: number) =>
    `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  return `${n.enviados} enviados · ${n.responderam} responderam · ${n.orcamentos} pediram orçamento · ${n.fecharam} ${n.fecharam === 1 ? "venda" : "vendas"} (${brl(n.vendido)})${n.retorno !== null ? ` · retorno ${String(n.retorno).replace(".", ",")}x` : ""}`;
}
