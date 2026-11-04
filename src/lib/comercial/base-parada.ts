/**
 * Base parada (04/11): toda semana, na revisão de domingo, a Tatiana olha os leads abertos sem
 * desfecho, sem toque marcado, sem orçamento aberto nos últimos 30 dias, sem OS e sem mensagem há
 * mais de 7 dias; separa pelo que aconteceu, lê uma amostra e deixa um recado só para o admin, com a
 * recomendação de cada grupo e se vale uma campanha nova. Nada é encerrado nem enviado por ela.
 */

export const TIPO_BASE_PARADA = "base_parada";

export const GRUPOS_BASE = [
  "so_campanha",
  "respondeu_campanha",
  "chegou_sozinho",
  "orcamento_antigo",
  "equipe_sem_resposta",
  "retomado_parou",
] as const;
export type GrupoBase = (typeof GRUPOS_BASE)[number];

export const NOME_GRUPO_BASE: Record<GrupoBase, string> = {
  so_campanha: "Só recebeu campanha e nunca respondeu",
  respondeu_campanha: "Respondeu a campanha e parou",
  chegou_sozinho: "Chegou sozinho e sumiu",
  orcamento_antigo: "Recebeu orçamento antigo e sumiu",
  equipe_sem_resposta: "A equipe chamou e nunca respondeu",
  retomado_parou: "Retomado pela equipe, respondeu e parou",
};

export const RECOMENDACOES = ["guardar", "encerrar", "tarefa", "misto"] as const;
export type Recomendacao = (typeof RECOMENDACOES)[number];
export const NOME_RECOMENDACAO: Record<Recomendacao, string> = {
  guardar: "Guardar para campanha",
  encerrar: "Encerrar só no app",
  tarefa: "Tarefa para a equipe",
  misto: "Separar um a um",
};

/** Dias sem mensagem para o lead contar como parado. */
export const DIAS_PARADO = 7;
/** Leads lidos por semana e mínimo por grupo (grupo pequeno não fica com 1 ou 2 exemplos). */
export const AMOSTRA_BASE = 50;
export const MINIMO_POR_GRUPO = 6;
/** Intervalo mínimo entre campanhas para o mesmo público, e limite de descadastro. */
export const DIAS_ENTRE_CAMPANHAS = 30;

export function grupoDaBase(l: {
  entrada: string | null;
  respondeu: boolean;
  recebeuDisparo: boolean;
  teveOrcamento: boolean;
}): GrupoBase {
  if (l.entrada === "ativo" && !l.respondeu)
    return l.recebeuDisparo ? "so_campanha" : "equipe_sem_resposta";
  if (l.teveOrcamento) return "orcamento_antigo";
  if (l.entrada === "ativo") return l.recebeuDisparo ? "respondeu_campanha" : "retomado_parou";
  return "chegou_sozinho";
}

/**
 * Quantos ler de cada grupo: o mínimo por grupo (ou o grupo inteiro, se for menor) e o resto
 * proporcional ao tamanho, pelo maior resto, sem passar do tamanho do grupo nem do total.
 */
export function amostraProporcional(
  contagem: Partial<Record<GrupoBase, number>>,
  total = AMOSTRA_BASE,
  minimo = MINIMO_POR_GRUPO,
): Record<GrupoBase, number> {
  const saida = Object.fromEntries(GRUPOS_BASE.map((g) => [g, 0])) as Record<GrupoBase, number>;
  const grupos = GRUPOS_BASE.filter((g) => (contagem[g] ?? 0) > 0);
  let resta = total;
  for (const g of grupos) {
    const n = Math.min(contagem[g] ?? 0, minimo, Math.max(resta, 0));
    saida[g] = n;
    resta -= n;
  }
  if (resta <= 0) return saida;
  const sobra = grupos.map((g) => ({ g, livre: (contagem[g] ?? 0) - saida[g] }));
  const livres = sobra.reduce((s, x) => s + x.livre, 0);
  if (livres <= 0) return saida;
  const parte = Math.min(resta, livres);
  const cotas = sobra.map((x) => {
    const exata = (x.livre / livres) * parte;
    return { ...x, inteira: Math.floor(exata), resto: exata - Math.floor(exata) };
  });
  let distribuido = cotas.reduce((s, c) => s + c.inteira, 0);
  for (const c of [...cotas].sort((a, b) => b.resto - a.resto)) {
    if (distribuido >= parte) break;
    if (c.inteira < c.livre) {
      c.inteira++;
      distribuido++;
    }
  }
  for (const c of cotas) saida[c.g] += Math.min(c.inteira, c.livre);
  return saida;
}

export type GrupoNoRecado = {
  grupo: GrupoBase;
  leads: number;
  recomendacao: Recomendacao;
  texto: string;
  /** Só os 4 últimos dígitos do telefone. */
  exemplos: string[];
};

export type CampanhaNoRecado = {
  vale: boolean;
  publico: string;
  oferta: string;
  quando: string;
  porque: string;
};

/** O que fica em comercial_relatorios.dados (tipo base_parada). */
export type DadosBaseParada = {
  tipo: typeof TIPO_BASE_PARADA;
  /** Dia da análise (AAAA-MM-DD, São Paulo). */
  dia: string;
  total: number;
  lidos: number;
  resumo: string;
  grupos: GrupoNoRecado[];
  campanha: CampanhaNoRecado;
};

export const ESQUEMA_BASE_PARADA = {
  type: "object",
  additionalProperties: false,
  required: ["resumo", "grupos", "campanha"],
  properties: {
    resumo: { type: "string" },
    grupos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["grupo", "recomendacao", "texto", "exemplos"],
        properties: {
          grupo: { type: "string", enum: [...GRUPOS_BASE] },
          recomendacao: { type: "string", enum: [...RECOMENDACOES] },
          texto: { type: "string" },
          exemplos: { type: "array", items: { type: "string" } },
        },
      },
    },
    campanha: {
      type: "object",
      additionalProperties: false,
      required: ["vale", "publico", "oferta", "quando", "porque"],
      properties: {
        vale: { type: "boolean" },
        publico: { type: "string" },
        oferta: { type: "string" },
        quando: { type: "string" },
        porque: { type: "string" },
      },
    },
  },
} as const;

export function instrucoesBaseParada(empresa: string): string {
  return [
    `Você é a Tatiana, gerente comercial da ${empresa}. Toda semana você olha a base parada: leads abertos, sem desfecho, sem toque marcado, sem orçamento aberto nos últimos 30 dias, sem OS e sem mensagem há mais de ${DIAS_PARADO} dias.`,
    "Você recebe quantos leads há em cada grupo, uma amostra de conversas de cada grupo (cada lead identificado só pelo final do telefone) e os números das últimas campanhas.",
    "Para cada grupo com leads, escreva em português simples, em 1 a 3 frases, o que aconteceu de verdade nas conversas da amostra e a sua recomendação:",
    "- guardar: guardar para a próxima campanha (diga a oferta que faz sentido);",
    "- encerrar: encerrar só no app, sem mensagem (cliente disse não, fechou com outra, pediu para parar, só agradeceu, ou ficou sem contexto e sem resposta);",
    "- tarefa: tarefa para a equipe (cliente mostrou interesse, ficou de voltar, pediu orçamento ou tem detalhe em aberto);",
    "- misto: o grupo tem casos diferentes; diga quais finais vão para cada lado.",
    "Em exemplos, use de 2 a 3 finais de telefone da amostra daquele grupo, exatamente como vieram. Nunca escreva nome, telefone inteiro ou endereço de cliente.",
    `Campanha: diga se vale uma campanha nova, para qual público, com qual oferta e quando. Regras: o mesmo público só recebe campanha ${DIAS_ENTRE_CAMPANHAS} dias depois da última; campanha com descadastro acima de 5% não se repete com o mesmo texto para o mesmo público; sugira começar por um lote pequeno. Se não valer, diga por quê.`,
    "Você só recomenda. Nada é encerrado, enviado ou criado sem o OK do dono da empresa.",
    "No resumo, 2 ou 3 frases com o principal da semana.",
  ].join("\n");
}

/** Finais de telefone válidos (4 dígitos) que vieram na amostra do grupo. */
export function exemplosValidos(exemplos: string[], daAmostra: ReadonlySet<string>): string[] {
  return [
    ...new Set(exemplos.map((e) => e.replace(/\D/g, "").slice(-4)).filter((e) => daAmostra.has(e))),
  ].slice(0, 3);
}
