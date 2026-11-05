/**
 * "O que a Alice não soube" (05/11): toda semana, junto com a base parada, a Tatiana lê as
 * passagens da Alice para a equipe e as respostas em que ela disse que a especialista confirma.
 * Separa só o que foi falta de conhecimento (serviço, preço, tecido, produto, prazo, região), agrupa
 * por assunto e propõe o texto a acrescentar no roteiro da Alice, em antes/depois. Só o admin vê;
 * nada vira tarefa e nada é salvo no texto da Alice sem o OK do dono.
 */

export const TIPO_NAO_SOUBE = "alice_nao_soube";

/** Motivos de passagem que são regra (não falta de conhecimento): ficam fora da lista. */
const MOTIVOS_DE_REGRA =
  /fora da [aá]rea|^combo|desconto|concorr|encaixe|cancel|agendamento sem|confirmar hor[aá]rio|p[oó]s-venda|pagamento combinado|humano|atendente|proposta comercial|parceria/i;

export function passagemDeRegra(motivo: string): boolean {
  return MOTIVOS_DE_REGRA.test(motivo.trim());
}

/** Resposta da Alice que admite não saber ("quem confirma é a especialista", "não tenho essa informação"). */
const NAO_SEI =
  /especialista (confirma|te (explica|responde))|quem (confirma|combina) (isso|direitinho)|n[aã]o tenho essa informa[cç][aã]o|n[aã]o sei (te )?(dizer|informar)|vou confirmar com (a equipe|a especialista)/i;

export function aliceAdmitiuNaoSaber(texto: string | null | undefined): boolean {
  return Boolean(texto && NAO_SEI.test(texto));
}

export type CasoNaoSoube = {
  /** Só os 4 últimos dígitos do telefone. */
  fim: string;
  dia: string;
  pergunta: string;
  alice: string;
  equipe: string;
};

export type GrupoNaoSoube = {
  assunto: string;
  casos: CasoNaoSoube[];
  /** Onde entra no roteiro (módulo de serviço, núcleo ou perguntas frequentes). */
  onde: string;
  antes: string;
  depois: string;
  /** Falta resposta da equipe ou decisão do dono para escrever o texto. */
  pergunta_ao_dono: string;
};

export type DadosNaoSoube = {
  tipo: typeof TIPO_NAO_SOUBE;
  dia: string;
  resumo: string;
  total: number;
  grupos: GrupoNaoSoube[];
};

export const ESQUEMA_NAO_SOUBE = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "grupos"],
  properties: {
    resumo: { type: "string" },
    grupos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["assunto", "casos", "onde", "antes", "depois", "pergunta_ao_dono"],
        properties: {
          assunto: { type: "string" },
          casos: { type: "array", items: { type: "integer" } },
          onde: { type: "string" },
          antes: { type: "string" },
          depois: { type: "string" },
          pergunta_ao_dono: { type: "string" },
        },
      },
    },
  },
} as const;

export function instrucoesNaoSoube(empresa: string): string {
  return [
    `Você é a Tatiana, gerente comercial da ${empresa}. Toda semana você lê os casos em que a Alice (atendente virtual) passou a conversa para a equipe ou disse que a especialista confirmaria, para ensinar a Alice.`,
    "Cada caso vem numerado, com a pergunta do cliente, o que a Alice fez e o que a equipe respondeu depois (se respondeu). Você também recebe o roteiro atual da Alice (módulos de serviço e perguntas frequentes).",
    "1. Fique só com os casos em que a Alice não sabia responder (serviço, preço, tecido, produto, prazo, região, item fora da tabela, dúvida técnica). Deixe de fora o que é regra da empresa (CEP fora da área, combo, pedido de desconto, concorrente, agenda, pagamento, pós-venda, cliente que pediu atendente) e o que precisa de ferramenta, não de texto (PDF, remarcação).",
    "2. Agrupe por assunto. Em casos, os números dos casos do grupo.",
    "3. Para cada grupo, proponha o texto para a Alice saber da próxima vez, usando só o que a equipe respondeu de fato. onde: o módulo (ex.: persiana, tapete, sofa, colchao, outros), o núcleo ou perguntas frequentes. antes: o trecho atual do roteiro que muda (copiado exatamente), ou vazio se for texto novo. depois: o texto novo, curto, no mesmo estilo do roteiro.",
    "4. Se a equipe não respondeu, ou respondeu de jeitos diferentes, não invente: deixe depois vazio e escreva em pergunta_ao_dono o que falta decidir.",
    "Nunca escreva nome, telefone inteiro ou endereço de cliente. No resumo, 1 ou 2 frases.",
  ].join("\n");
}
