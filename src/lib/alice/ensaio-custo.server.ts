/**
 * Ensaio de custo da Alice (ideias de 26/10, uma por vez). Roda a Alice de verdade em conversas de
 * teste, mensagem a mensagem como na produção (cada mensagem do cliente é uma resposta nova), no
 * jeito de hoje (ANTES) e no jeito novo (DEPOIS), e soma o custo de cada conversa. As respostas da
 * Alice no meio do histórico são as gravadas (iguais nos dois), para comparar só o custo; a última
 * resposta de cada conversa vai de exemplo. Nada é enviado; o resultado fica em app_settings
 * (alice_ensaio_custo) para a Nexa conferir.
 *
 * Ideia 2 (cache): ANTES = últimas 20 mensagens e cache só no fim; DEPOIS = janela que anda de 20
 * em 20 e ponto de cache de 1 hora no fim do histórico.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ferramentasDisponiveis } from "./ferramentas.server";
import { contextoEmpresa, etapasAbertas, lerConfig } from "./motor.server";
import { rodarAliceEnsaio, type FalaEnsaio } from "./ensaio-rodar.server";
import { CENARIOS_RESPOSTAS } from "./ensaio-respostas.server";
import {
  custoEstimadoUsd,
  instrucoesDoMomento,
  instrucoesFixas,
  janelaEstavel,
  marcarCacheDoHistorico,
  type ContextoLead,
  type Uso,
} from "./prompt";

type Db = SupabaseClient<Database>;

/** Conversa inventada, mais longa que 20 mensagens (a janela de hoje corta o começo). */
const LONGA: FalaEnsaio[] = [
  { de: "cliente", texto: "Boa tarde! Vocês fazem limpeza de sofá e cadeira?" },
  {
    de: "alice",
    texto:
      "Oii, tudo bem? Eu sou a Alice IA 💙 Fazemos sim, sofá e cadeiras!\nVocê consegue me mandar uma foto e o seu CEP?",
  },
  { de: "cliente", texto: "[foto do sofá]" },
  { de: "cliente", texto: "cep 05424-000" },
  {
    de: "alice",
    texto:
      "Recebi, obrigada! Seu endereço está dentro da nossa área 💙\nPela foto é um sofá retrátil de 3 lugares, certo?",
  },
  { de: "cliente", texto: "isso, retrátil e reclinável" },
  { de: "alice", texto: "Perfeito! E o que mais te incomoda nele hoje?" },
  { de: "cliente", texto: "tá encardido no braço e tem umas manchas de café" },
  {
    de: "alice",
    texto:
      "Entendi, mancha de café a gente tira bastante por aqui.\nAs almofadas do assento saem do lugar?",
  },
  { de: "cliente", texto: "não, são fixas" },
  {
    de: "alice",
    texto: "Anotado! E as cadeiras, quantas são e são estofadas no assento e encosto?",
  },
  { de: "cliente", texto: "6 cadeiras, só o assento é estofado" },
  { de: "alice", texto: "Ótimo! Você sabe qual é o tecido do sofá?" },
  { de: "cliente", texto: "acho que é suede" },
  {
    de: "alice",
    texto:
      "Perfeito, suede a gente trabalha sempre.\nVocê quer só a higienização ou também a impermeabilização?",
  },
  { de: "cliente", texto: "quanto fica a impermeabilização?" },
  {
    de: "alice",
    texto:
      "A impermeabilização protege contra líquidos e facilita a limpeza do dia a dia. Vou montar os dois valores pra você comparar, tá?",
  },
  { de: "cliente", texto: "pode ser" },
  { de: "alice", texto: "[orçamento enviado: sofá retrátil 3 lugares + 6 assentos de cadeira]" },
  { de: "cliente", texto: "e no pix tem desconto?" },
  { de: "alice", texto: "Tem sim! No Pix tem desconto, já está no orçamento que te mandei 💙" },
  { de: "cliente", texto: "beleza, tem horário semana que vem?" },
  {
    de: "alice",
    texto: "Tenho sim! Prefere de manhã ou à tarde, e qual dia fica melhor pra você?",
  },
  { de: "cliente", texto: "terça de manhã" },
];

const CENARIOS: Array<{ id: string; titulo: string; nome: string; historico: FalaEnsaio[] }> = [
  ...CENARIOS_RESPOSTAS.map((c) => ({
    id: c.id,
    titulo: c.titulo,
    nome: c.nome,
    historico: c.historico,
  })),
  {
    id: "longa",
    titulo: "Conversa longa (24 mensagens): sofá + cadeiras até o agendamento",
    nome: "Carla",
    historico: LONGA,
  },
];

function respostaDeEnsaio(nome: string): string {
  switch (nome) {
    case "consultar_cliente":
      return "IA desligada: não; sem pós-venda: não. Cliente novo, sem serviços anteriores.";
    case "consultar_cep":
      return "CEP dentro da área atendida (ensaio).";
    case "criar_orcamento":
      return "Orçamento criado (ensaio): itens conforme a tabela. Total, cartão e Pix calculados; válido pelo prazo da empresa.";
    case "transferir_para_humano":
      return "Transferência registrada: a equipe assume depois desta resposta. Se as instruções pedirem, avise o cliente numa frase curta; senão, não escreva nada.";
    default:
      return "Ok (ensaio).";
  }
}

/** Pontos do histórico em que a Alice responde (fim de cada sequência de mensagens do cliente). */
export function passosDaConversa(h: FalaEnsaio[]): number[] {
  const passos: number[] = [];
  for (let i = 0; i < h.length; i++)
    if (h[i]!.de === "cliente" && (i === h.length - 1 || h[i + 1]!.de === "alice"))
      passos.push(i + 1);
  return passos;
}

export type LadoEnsaio = {
  custoUsd: number;
  respostas: number;
  rodadas: number;
  uso: Uso;
  exemplo: string[];
  erro?: string;
};

export type ResultadoCusto = {
  id: string;
  titulo: string;
  ultimaDoCliente: string;
  antes: LadoEnsaio;
  depois: LadoEnsaio;
};

export type EnsaioCusto = {
  ideia: number;
  executadoEm: string;
  modelo: string;
  cenarios: ResultadoCusto[];
  mediaAntesUsd: number;
  mediaDepoisUsd: number;
};

const vazio = (): Uso => ({
  entrada: 0,
  saida: 0,
  cacheLeitura: 0,
  cacheEscrita: 0,
  cacheEscrita1h: 0,
});

export async function rodarEnsaioCusto(db: Db, empresaId: string): Promise<EnsaioCusto> {
  const cfg = await lerConfig(db, empresaId);
  if (!cfg) throw new Error("Esta empresa não tem a Alice configurada.");
  const etapas = await etapasAbertas(db, empresaId);
  const ferramentas = ferramentasDisponiveis(cfg, etapas, { regraNome: true });
  const empresa = await contextoEmpresa(
    db,
    empresaId,
    cfg,
    ferramentas.map((f) => f.name),
  );
  const fixas = instrucoesFixas({ ...empresa, regraNome: true, regraRespostas: true });
  const cliente = new Anthropic();

  async function lado(c: (typeof CENARIOS)[number], novo: boolean): Promise<LadoEnsaio> {
    const total = vazio();
    let rodadas = 0;
    let exemplo: string[] = [];
    const passos = passosDaConversa(c.historico);
    try {
      for (const fim of passos) {
        const ate = c.historico.slice(0, fim);
        const historico = novo ? janelaEstavel(ate) : ate.slice(-20);
        const lead: ContextoLead = {
          nome: c.nome,
          telefone: null,
          origem: "Google",
          campanha: null,
          servicoInteresse: "higienização",
          descricaoEstofados: null,
          resumo: null,
          etapa: null,
          clienteExistente: false,
          semPosVenda: false,
          nomeCliente: { confirmado: c.nome, origem: "perfil", perfil: c.nome, perguntas: 0 },
        };
        const r = await rodarAliceEnsaio({
          cliente,
          modelo: cfg!.modelo,
          esforco: cfg!.esforco,
          ferramentas,
          fixas,
          momento: instrucoesDoMomento(new Date(), lead),
          historico,
          respostaDeEnsaio,
          cacheComoProducao: true,
          ...(novo ? { prepararTurnos: marcarCacheDoHistorico } : {}),
        });
        total.entrada += r.uso.entrada;
        total.saida += r.uso.saida;
        total.cacheLeitura += r.uso.cacheLeitura;
        total.cacheEscrita += r.uso.cacheEscrita;
        total.cacheEscrita1h! += r.uso.cacheEscrita1h ?? 0;
        rodadas += r.rodadas;
        exemplo = r.resposta;
      }
      return {
        custoUsd: Math.round(custoEstimadoUsd(cfg!.modelo, total) * 10000) / 10000,
        respostas: passos.length,
        rodadas,
        uso: total,
        exemplo,
      };
    } catch (e) {
      return {
        custoUsd: Math.round(custoEstimadoUsd(cfg!.modelo, total) * 10000) / 10000,
        respostas: passos.length,
        rodadas,
        uso: total,
        exemplo,
        erro: e instanceof Error ? e.message.slice(0, 300) : String(e),
      };
    }
  }

  const cenarios = await Promise.all(
    CENARIOS.map(async (c): Promise<ResultadoCusto> => {
      const [antes, depois] = await Promise.all([lado(c, false), lado(c, true)]);
      return {
        id: c.id,
        titulo: c.titulo,
        ultimaDoCliente: c.historico[c.historico.length - 1]!.texto,
        antes,
        depois,
      };
    }),
  );
  const media = (f: (r: ResultadoCusto) => number) =>
    Math.round((cenarios.reduce((s, r) => s + f(r), 0) / cenarios.length) * 10000) / 10000;
  const resultado: EnsaioCusto = {
    ideia: 2,
    executadoEm: new Date().toISOString(),
    modelo: cfg.modelo,
    cenarios,
    mediaAntesUsd: media((r) => r.antes.custoUsd),
    mediaDepoisUsd: media((r) => r.depois.custoUsd),
  };
  await db.from("app_settings").upsert(
    {
      empresa_id: empresaId,
      key: "alice_ensaio_custo",
      value: resultado as never,
    },
    { onConflict: "empresa_id,key" },
  );
  return resultado;
}
