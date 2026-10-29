/**
 * Gerente comercial: a ficha fixa que a IA preenche para cada lead (formato, instruções, leitura da
 * resposta e custo). Regras puras, sem banco. A IA só lê: nada é enviado ao cliente e a mensagem
 * sugerida é só para a equipe copiar, se quiser.
 */
import type { Fatos } from "./fatos";

export const MODELO_FICHA = "claude-sonnet-5-5";

/** Preço do Sonnet 5.5 por milhão de tokens (US$): entrada, gravação e leitura do cache, saída. */
export const PRECO_SONNET = { entrada: 2, cacheGravar: 2.5, cacheLer: 0.2, saida: 10 } as const;

export type Uso = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export function custoUsd(u: Uso, p: typeof PRECO_SONNET = PRECO_SONNET): number {
  const v =
    (u.input_tokens * p.entrada +
      (u.cache_creation_input_tokens ?? 0) * p.cacheGravar +
      (u.cache_read_input_tokens ?? 0) * p.cacheLer +
      u.output_tokens * p.saida) /
    1_000_000;
  return Math.round(v * 100_000) / 100_000;
}

export const REGRAS = [
  "foto_cep",
  "empatia",
  "nao_repetir_pergunta",
  "sem_ficou_com_duvida",
  "pix",
] as const;
export type Regra = (typeof REGRAS)[number];

export const NOME_REGRA: Record<Regra, string> = {
  foto_cep: "Pediu foto e CEP",
  empatia: "Empatia",
  nao_repetir_pergunta: "Não repetiu pergunta",
  sem_ficou_com_duvida: 'Sem "ficou com alguma dúvida?"',
  pix: "Ofereceu o desconto no Pix",
};

export type Ficha = {
  servico: string;
  perfil: {
    tipo: "residencia" | "empresa" | "nao_sabe";
    motivo: string;
    urgencia: "alta" | "media" | "baixa" | "nao_sabe";
  };
  objecao_principal: string;
  regras: Array<{
    regra: Regra;
    situacao: "seguiu" | "quebrou" | "nao_se_aplica";
    quem: "alice" | "equipe" | "nao_se_aplica";
    evidencia: string;
  }>;
  momento_esfriou: string;
  resumo_resultado: string;
  motivo_perda_sugerido: string;
  frase_cliente: string;
  pediu_encaixe: boolean;
  o_que_poderia_ter_sido_feito: string;
  nota: number;
  ainda_vale_chamar: boolean;
  mensagem_sugerida: string;
  o_que_ajudou_a_vender: string;
  erros: Array<{ quem: "alice" | "equipe"; erro: string }>;
};

const texto = { type: "string" } as const;

/** Formato JSON da ficha (saída estruturada da API). */
export const ESQUEMA_FICHA = {
  type: "object",
  additionalProperties: false,
  required: [
    "servico",
    "perfil",
    "objecao_principal",
    "regras",
    "momento_esfriou",
    "resumo_resultado",
    "motivo_perda_sugerido",
    "frase_cliente",
    "pediu_encaixe",
    "o_que_poderia_ter_sido_feito",
    "nota",
    "ainda_vale_chamar",
    "mensagem_sugerida",
    "o_que_ajudou_a_vender",
    "erros",
  ],
  properties: {
    servico: texto,
    perfil: {
      type: "object",
      additionalProperties: false,
      required: ["tipo", "motivo", "urgencia"],
      properties: {
        tipo: { type: "string", enum: ["residencia", "empresa", "nao_sabe"] },
        motivo: texto,
        urgencia: { type: "string", enum: ["alta", "media", "baixa", "nao_sabe"] },
      },
    },
    objecao_principal: texto,
    regras: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["regra", "situacao", "quem", "evidencia"],
        properties: {
          regra: { type: "string", enum: [...REGRAS] },
          situacao: { type: "string", enum: ["seguiu", "quebrou", "nao_se_aplica"] },
          quem: { type: "string", enum: ["alice", "equipe", "nao_se_aplica"] },
          evidencia: texto,
        },
      },
    },
    momento_esfriou: texto,
    resumo_resultado: texto,
    motivo_perda_sugerido: texto,
    frase_cliente: texto,
    pediu_encaixe: { type: "boolean" },
    o_que_poderia_ter_sido_feito: texto,
    nota: { type: "integer" },
    ainda_vale_chamar: { type: "boolean" },
    mensagem_sugerida: texto,
    o_que_ajudou_a_vender: texto,
    erros: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quem", "erro"],
        properties: {
          quem: { type: "string", enum: ["alice", "equipe"] },
          erro: texto,
        },
      },
    },
  },
} as const;

/** Instruções fixas (iguais para todos os leads: ficam no cache da API). */
export function instrucoesFicha(o: { empresa: string; pixPct: number | null }): string {
  const pix = o.pixPct ? `${String(o.pixPct).replace(".", ",")}%` : "o da empresa";
  return [
    `Você é o gerente comercial da ${o.empresa}, empresa de limpeza e higienização de estofados (sofás, colchões, cadeiras, tapetes) que atende pelo WhatsApp. A atendente virtual se chama Alice; a equipe são pessoas da empresa.`,
    "Você vai ler UM atendimento já encerrado ou parado (fatos calculados pelo sistema + a conversa) e preencher uma ficha fixa. Você só analisa: nada do que escrever será enviado ao cliente automaticamente.",
    "",
    "Regras de leitura:",
    "- Use os fatos do sistema como verdade para números, datas, valores, resultado e quem atendeu. Não invente valores nem datas.",
    '- Baseie cada julgamento no que está escrito na conversa. Se não dá para saber, diga isso ("não dá para saber") em vez de supor.',
    "- Escreva em português do Brasil, frases curtas e diretas. Não cite o nome nem o telefone do cliente.",
    "",
    "Como preencher:",
    '- servico: o serviço que o cliente quis (ex.: "Higienização de sofá 3 lugares").',
    "- perfil: residência ou empresa; motivo (por que quer o serviço: mancha, xixi de pet, mudança, alergia, visita, manutenção...); urgência.",
    "- objecao_principal: o que travou a venda, nas palavras do problema (preço, data, confiança, distância, só cotando...). Vazio se não houve.",
    `- regras: avalie as 5 regras, uma linha cada: foto_cep (pediu foto do item e CEP antes do preço), empatia (acolheu o problema do cliente antes de vender), nao_repetir_pergunta (não perguntou de novo algo que o cliente já respondeu), sem_ficou_com_duvida (não usou "ficou com alguma dúvida?" ou parecido), pix (ofereceu o desconto no Pix de ${pix} quando falou de preço). Diga quem seguiu ou quebrou (alice ou equipe) e a evidência (trecho curto ou o que faltou). Use nao_se_aplica quando a regra não teve chance de acontecer.`,
    '- momento_esfriou: em que ponto o cliente parou de responder ou perdeu o interesse (ex.: "depois de receber o preço", "depois do 2º follow-up"). Se vendeu, "não esfriou".',
    "- resumo_resultado: uma frase com o desfecho.",
    "- motivo_perda_sugerido: se NÃO vendeu, escolha exatamente um nome da lista de motivos da empresa; se vendeu, deixe vazio.",
    "- frase_cliente: a frase do cliente que melhor mostra o motivo (copiada da conversa, curta). Vazio se não houver.",
    "- pediu_encaixe: true se o cliente pediu um horário que não tinha (manhã, sábado, data cheia) ou pediu para avisar se abrir vaga.",
    "- o_que_poderia_ter_sido_feito: 1 a 3 frases práticas, específicas deste atendimento.",
    "- nota: 0 a 10 para o atendimento (não para o cliente).",
    "- ainda_vale_chamar: true só se fizer sentido retomar agora (não comprou, não disse não, não fechou com outro). mensagem_sugerida: a mensagem curta que a equipe poderia mandar (tom humano, sem pressão, sem inventar desconto); vazio se não vale.",
    "- o_que_ajudou_a_vender: se vendeu, o que fez fechar; senão, vazio.",
    "- erros: os erros concretos do atendimento, separados por quem errou (alice ou equipe). Lista vazia se não houve.",
  ].join("\n");
}

const entre = (n: unknown, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(Number(n) || 0)));

/** Confere a ficha devolvida pela IA (formato garantido pela API; aqui só os limites). */
export function lerFicha(json: string): Ficha {
  const f = JSON.parse(json) as Ficha;
  if (!f || typeof f !== "object" || !Array.isArray(f.regras)) throw new Error("ficha sem formato");
  f.nota = entre(f.nota, 0, 10);
  f.regras = f.regras.filter((r) => (REGRAS as readonly string[]).includes(r.regra));
  f.erros = Array.isArray(f.erros) ? f.erros : [];
  return f;
}

/** O que vai para a IA além das instruções: fatos, lista de motivos e a conversa. */
export function pedidoDaFicha(o: { fatos: Fatos; motivos: string[]; conversa: string }): string {
  const { fatos } = o;
  return [
    "FATOS DO SISTEMA (verdade para números e datas):",
    JSON.stringify(fatos, null, 1),
    "",
    "MOTIVOS DE PERDA DA EMPRESA (escolha exatamente um nome, se não vendeu):",
    o.motivos.map((m) => `- ${m}`).join("\n"),
    "",
    "CONVERSA (horário de São Paulo):",
    o.conversa || "(sem mensagens registradas)",
  ].join("\n");
}

/** Motivo sugerido → id, pelo nome exato (sem diferenciar maiúsculas e espaços). */
export function idDoMotivo(
  nome: string,
  motivos: Array<{ id: string; nome: string }>,
): string | null {
  const n = nome.trim().toLowerCase();
  if (!n) return null;
  return motivos.find((m) => m.nome.trim().toLowerCase() === n)?.id ?? null;
}
