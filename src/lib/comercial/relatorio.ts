/**
 * Gerente comercial: relatório do período (regras puras). A parte de números sai daqui (sem IA);
 * a parte de leitura (padrões, perfil de quem fecha, erros com exemplos, sugestões e mudanças na
 * Alice com antes/depois) é pedida à IA com as fichas resumidas. As mudanças na Alice são só
 * sugestão: nada é salvo na configuração dela.
 */
import { DEFEITOS_ALICE, NOME_DEFEITO, type DefeitoAlice, type Ficha } from "./ficha";
import type { Fatos } from "./fatos";
import {
  conversaoPor,
  funil,
  mediaNota,
  perdasPorMotivo,
  regrasQuebradas,
  servicoPrincipal,
  type FichaResumo,
} from "./resumo";

/** Data da mudança da Alice (núcleo de 28/10) usada para separar os defeitos em antes e depois. */
export const CORTE_ALICE = "2026-10-28T03:00:00Z";

export type DefeitoContado = {
  defeito: DefeitoAlice;
  nome: string;
  antes: number;
  depois: number;
  total: number;
};

export function defeitosAntesDepois(fichas: FichaResumo[], corte = CORTE_ALICE): DefeitoContado[] {
  const corteMs = new Date(corte).getTime();
  const linhas = DEFEITOS_ALICE.map((d) => ({
    defeito: d,
    nome: NOME_DEFEITO[d],
    antes: 0,
    depois: 0,
    total: 0,
  }));
  for (const f of fichas) {
    if (f.status !== "ok" || !f.ficha) continue;
    const em = f.fatos?.primeiraMensagemCliente
      ? new Date(f.fatos.primeiraMensagemCliente).getTime()
      : 0;
    for (const d of new Set(f.ficha.defeitos_alice ?? [])) {
      const l = linhas.find((x) => x.defeito === d);
      if (!l) continue;
      if (em >= corteMs) l.depois++;
      else l.antes++;
      l.total++;
    }
  }
  return linhas.filter((l) => l.total > 0).sort((a, b) => b.total - a.total);
}

/** Quantos leads (com ficha) começaram antes e depois do corte, para comparar proporções. */
export function leadsAntesDepois(fichas: FichaResumo[], corte = CORTE_ALICE) {
  const corteMs = new Date(corte).getTime();
  const ok = fichas.filter((f) => f.status === "ok" && f.fatos?.primeiraMensagemCliente);
  const depois = ok.filter(
    (f) => new Date(f.fatos!.primeiraMensagemCliente!).getTime() >= corteMs,
  ).length;
  return { antes: ok.length - depois, depois };
}

export type NumerosRelatorio = {
  fichas: number;
  grupos: Array<{
    grupo: string;
    leads: number;
    comOrcamento: number;
    vendas: number;
    vendido: number;
    notaMedia: number | null;
  }>;
  funil: ReturnType<typeof funil>;
  porServico: ReturnType<typeof conversaoPor>;
  porOrigem: ReturnType<typeof conversaoPor>;
  topMotivos: ReturnType<typeof perdasPorMotivo>;
  regras: ReturnType<typeof regrasQuebradas>;
  defeitosAlice: DefeitoContado[];
  leadsAntesDepois: { antes: number; depois: number };
  custo: { fichasUsd: number; medioUsd: number };
};

export function numerosDoRelatorio(fichas: FichaResumo[]): NumerosRelatorio {
  const ok = fichas.filter((f) => f.status === "ok");
  const grupo = (g: "google" | "outras") => {
    const fs = ok.filter((f) => f.grupo === g);
    return {
      grupo: g === "google" ? "Google" : "Outras origens",
      leads: fs.length,
      comOrcamento: fs.filter((f) => f.resultado !== "sem_orcamento").length,
      vendas: fs.filter((f) => f.resultado === "vendeu").length,
      vendido: fs.reduce((s, f) => s + (f.valorVendido ?? 0), 0),
      notaMedia: mediaNota(fs),
    };
  };
  const gasto = fichas.reduce((s, f) => s + f.custoUsd, 0);
  return {
    fichas: ok.length,
    grupos: [grupo("google"), grupo("outras")],
    funil: funil(ok),
    porServico: conversaoPor(ok, (f) => servicoPrincipal(f.servico)),
    porOrigem: conversaoPor(ok, (f) => f.origem ?? "Sem origem"),
    topMotivos: perdasPorMotivo(ok).slice(0, 5),
    regras: regrasQuebradas(ok),
    defeitosAlice: defeitosAntesDepois(ok),
    leadsAntesDepois: leadsAntesDepois(ok),
    custo: { fichasUsd: gasto, medioUsd: ok.length ? gasto / ok.length : 0 },
  };
}

/** Uma linha compacta por ficha para a IA ler (sem nome, sem telefone, sem mensagem sugerida). */
export function fichaCompacta(n: number, f: FichaResumo): Record<string, unknown> | null {
  const fi: Ficha | null = f.ficha;
  const fa: Fatos | null = f.fatos;
  if (f.status !== "ok" || !fi || !fa) return null;
  return {
    n,
    grupo: f.grupo,
    origem: f.origem,
    servico: servicoPrincipal(f.servico),
    resultado: f.resultado,
    orcado: f.valorOrcado,
    vendido: f.valorVendido,
    quem: f.quemAtendeu,
    antes_de_28_10: fa.primeiraMensagemCliente ? fa.primeiraMensagemCliente < CORTE_ALICE : null,
    primeira_resposta_min: fa.primeiraRespostaMin,
    ate_preco_min: fa.tempoAtePrecoMin,
    perfil: fi.perfil,
    objecao: fi.objecao_principal,
    regras_quebradas: fi.regras
      .filter((r) => r.situacao === "quebrou")
      .map((r) => `${r.regra} (${r.quem}): ${r.evidencia}`),
    esfriou: fi.momento_esfriou,
    motivo: f.motivoRegistrado ?? f.motivoSugerido,
    frase: fi.frase_cliente,
    ajudou_a_vender: fi.o_que_ajudou_a_vender,
    poderia: fi.o_que_poderia_ter_sido_feito,
    erros: fi.erros,
    defeitos_alice: fi.defeitos_alice,
    nota: fi.nota,
  };
}

export const ESQUEMA_RELATORIO = {
  type: "object",
  additionalProperties: false,
  required: [
    "padroes_vendas",
    "perfil_que_mais_fecha",
    "vendeu_x_nao_vendeu",
    "onde_somem",
    "erros_recorrentes",
    "sugestoes",
    "mudancas_alice",
  ],
  properties: {
    padroes_vendas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["padrao", "casos"],
        properties: { padrao: { type: "string" }, casos: { type: "integer" } },
      },
    },
    perfil_que_mais_fecha: { type: "string" },
    vendeu_x_nao_vendeu: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["servico", "diferenca"],
        properties: { servico: { type: "string" }, diferenca: { type: "string" } },
      },
    },
    onde_somem: { type: "string" },
    erros_recorrentes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["quem", "erro", "casos", "exemplos"],
        properties: {
          quem: { type: "string", enum: ["alice", "equipe"] },
          erro: { type: "string" },
          casos: { type: "integer" },
          exemplos: { type: "array", items: { type: "string" } },
        },
      },
    },
    sugestoes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sugestao", "forca", "casos"],
        properties: {
          sugestao: { type: "string" },
          forca: { type: "string", enum: ["hipotese", "forte"] },
          casos: { type: "integer" },
        },
      },
    },
    mudancas_alice: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tema", "defeito", "casos", "antes", "depois"],
        properties: {
          tema: { type: "string" },
          defeito: { type: "string", enum: [...DEFEITOS_ALICE, "nenhum"] },
          casos: { type: "integer" },
          antes: { type: "string" },
          depois: { type: "string" },
        },
      },
    },
  },
} as const;

export type LeituraRelatorio = {
  padroes_vendas: Array<{ padrao: string; casos: number }>;
  perfil_que_mais_fecha: string;
  vendeu_x_nao_vendeu: Array<{ servico: string; diferenca: string }>;
  onde_somem: string;
  erros_recorrentes: Array<{
    quem: "alice" | "equipe";
    erro: string;
    casos: number;
    exemplos: string[];
  }>;
  sugestoes: Array<{ sugestao: string; forca: "hipotese" | "forte"; casos: number }>;
  mudancas_alice: Array<{
    tema: string;
    defeito: string;
    casos: number;
    antes: string;
    depois: string;
  }>;
};

export function instrucoesRelatorio(empresa: string): string {
  return [
    `Você é o gerente comercial da ${empresa} (limpeza e higienização de estofados, atendimento pelo WhatsApp com a atendente virtual Alice e a equipe).`,
    "Você recebe: os números do período (calculados pelo sistema, são a verdade), uma linha por atendimento já analisado e o texto atual das instruções da Alice. Escreva a leitura do período em português do Brasil, direta e prática.",
    "Regras:",
    "- Conte os casos de verdade nas linhas (campo casos). Não invente números; use os do sistema para conversão e valores.",
    "- Sem nomes de clientes nem de pessoas da equipe; use [nome] e [atendente] se precisar.",
    "- padroes_vendas: os 5 padrões mais comuns nas vendas, com o número de casos.",
    "- perfil_que_mais_fecha: 2 a 3 frases.",
    "- vendeu_x_nao_vendeu: para os serviços com vendas e perdas, o que muda entre quem comprou e quem não comprou.",
    "- onde_somem: em que etapa os leads mais se perdem e por quê (2 a 3 frases).",
    "- erros_recorrentes: os erros que mais se repetem, Alice e equipe separadas, com 2 a 3 exemplos curtos cada (trechos das linhas, sem nomes).",
    '- sugestoes: até 10, cada uma marcada "forte" (muitos casos e padrão claro) ou "hipotese" (poucos casos ou causa incerta), com o número de casos.',
    '- mudancas_alice: mudanças no texto da Alice para os defeitos dela que mais aparecem. Em "antes", copie o trecho atual das instruções que trata do assunto (ou "(não há regra sobre isso)"); em "depois", o texto novo proposto, pronto para colar. Uma por tema, no máximo 8. É só sugestão: nada será aplicado sem o dono aprovar.',
  ].join("\n");
}
