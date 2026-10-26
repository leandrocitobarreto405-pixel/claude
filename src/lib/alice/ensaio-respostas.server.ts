/**
 * Ensaio das regras de 26/10 (não perguntar duas vezes; tecido não identificado): roda a Alice de
 * verdade em duas conversas reproduzidas da Turbine (finais 3615 e 7010), com nomes, endereço e
 * CEP trocados e as fotos como texto (a 7010 para no "Não sei" do tecido). Cada conversa roda ANTES (regras de hoje) e DEPOIS (regras
 * novas, roteiro do tecido trocado e tecido padrão B só em memória). Nada é enviado nem gravado.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ferramentasDisponiveis } from "./ferramentas.server";
import { contextoEmpresa, etapasAbertas, lerConfig } from "./motor.server";
import { rodarAliceEnsaio, type FalaEnsaio } from "./ensaio-rodar.server";
import { aplicarRoteiroTecido } from "./tecido-roteiro";
import { instrucoesDoMomento, instrucoesFixas, type ContextoLead } from "./prompt";

type Db = SupabaseClient<Database>;

const BOAS_VINDAS = (nome: string) =>
  `Oii, ${nome}, tudo bem? Seja muito bem-vindo(a)! 💙\nEu sou a Alice IA e vai ser um prazer enorme poder te ajudar com seus estofados hoje!\nPra eu analisar direitinho e te passar um orçamento, você consegue me mandar uma foto do seu estofado e o seu CEP?`;

export type CenarioRespostas = {
  id: string;
  titulo: string;
  esperado: string;
  nome: string;
  historico: FalaEnsaio[];
};

export const CENARIOS_RESPOSTAS: CenarioRespostas[] = [
  {
    id: "final-3615",
    titulo: "Final 3615: almofadas (cliente respondeu “Não”)",
    esperado:
      "Aceita a resposta (não são soltas = fixas) e segue, sem perguntar de novo das almofadas.",
    nome: "Rafael",
    historico: [
      {
        de: "cliente",
        texto: "Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.",
      },
      { de: "alice", texto: BOAS_VINDAS("Rafael") },
      { de: "cliente", texto: "Cep 06454-000" },
      { de: "cliente", texto: "[foto do sofá]" },
      {
        de: "alice",
        texto:
          "Obrigada pelas informações, Rafael! Quero entender direitinho pra te ajudar da melhor forma 💙\nPela foto, parece um sofá comum de 3 lugares, é isso?\nE o que mais te incomoda nele que fez você procurar a higienização?",
      },
      { de: "cliente", texto: "Sim 3 lugares, manhas , sofá de linho" },
      {
        de: "alice",
        texto:
          "Entendi, Rafael! Mancha em sofá de linho incomoda mesmo, ainda mais num tecido claro, que deixa tudo aparecer.\nVocê lembra o que causou essas manchas e há quanto tempo elas estão aí?",
      },
      { de: "cliente", texto: "Meus dogs" },
      {
        de: "alice",
        texto:
          "Entendi, Rafael! Cachorro que sobe no sofá deixa essas marcas mesmo, e no linho elas aparecem bastante. Isso é bem comum, a gente pega muito caso assim.\nVocê sabe me dizer se as almofadas do assento são soltas ou fixas?",
      },
      { de: "cliente", texto: "Nao" },
    ],
  },
  {
    id: "final-7010",
    titulo: "Final 7010: tecido desconhecido (cliente respondeu “Não sei”)",
    esperado:
      "Não pede foto de perto nem passa para a equipe: segue o orçamento com a classe B, sem falar de classe; pode dizer que o técnico confere o tecido no local.",
    nome: "Bruna",
    historico: [
      {
        de: "cliente",
        texto: "Olá, gostaria de um orçamento para higienização dos meus estofados, por favor.",
      },
      { de: "alice", texto: BOAS_VINDAS("Bruna") },
      { de: "cliente", texto: "[foto do sofá, de longe]" },
      {
        de: "alice",
        texto:
          "Recebi a foto, Bruna, obrigada! Já deu pra ver a marquinha no assento, e a gente cuida disso com todo o carinho ☺️\nQual é o seu CEP?",
      },
      { de: "cliente", texto: "Vila Mariana, São Paulo - SP, 04101-000" },
      {
        de: "alice",
        texto:
          "Obrigada, Bruna! Seu endereço está dentro da nossa área de atendimento 💙\nQuero entender direitinho pra te ajudar da melhor forma. O que mais te incomoda no seu estofado que fez você procurar a higienização?",
      },
      { de: "cliente", texto: "apenas a mancha" },
      {
        de: "alice",
        texto:
          "Entendi, Bruna, então o foco é tirar essa mancha do assento. Isso a gente faz bastante por aqui 💙\nVocê lembra o que causou a mancha?",
      },
      { de: "cliente", texto: "Foi sangue" },
      {
        de: "alice",
        texto:
          "Ah, sangue acontece mais do que a gente imagina, Bruna, e a gente pega bastante esse tipo de mancha por aqui. Quando é recente, as chances de sair são ainda maiores.\nHá quanto tempo foi isso?",
      },
      { de: "cliente", texto: "Ontem" },
      {
        de: "alice",
        texto:
          "Ontem é ótimo, Bruna! Mancha recente tem muito mais chance de sair por completo, mesmo que eu não possa prometer 100%.\nPela foto não consegui ver o estofado inteiro. É um sofá ou uma poltrona, e de quantos lugares?",
      },
      { de: "cliente", texto: "sofá de 3 lugares" },
      { de: "cliente", texto: "[outra foto do sofá, sem detalhe do tecido]" },
      {
        de: "alice",
        texto:
          "Anotado, Bruna, sofá de 3 lugares! 😊\nPela foto, parece um sofá comum, daqueles que não abrem nem estendem. É isso mesmo?",
      },
      { de: "cliente", texto: "isso" },
      {
        de: "alice",
        texto:
          "Obrigada por confirmar, Bruna! 💙\nOs assentos e as almofadas de encosto do seu sofá saem do lugar, são soltos?",
      },
      { de: "cliente", texto: "sim" },
      {
        de: "alice",
        texto:
          "Anotado, Bruna, almofadas soltas! 😊\nVocê sabe qual é o tecido do sofá? Por exemplo, se é linho, veludo, bouclé ou poliéster.",
      },
      { de: "cliente", texto: "Não sei" },
    ],
  },
];

function respostaDeEnsaio(nome: string): string {
  switch (nome) {
    case "consultar_cliente":
      return "IA desligada: não; sem pós-venda: não. Cliente novo, sem serviços anteriores.";
    case "consultar_cep":
      return "CEP dentro da área atendida (ensaio).";
    case "criar_orcamento":
      return "Orçamento criado (ensaio): Sofá 3 lugares — higienização conforme a tabela, com os acréscimos marcados. Total, cartão e Pix calculados; válido pelo prazo da empresa.";
    case "transferir_para_humano":
      return "Transferência registrada: a equipe assume depois desta resposta. Se as instruções pedirem, avise o cliente numa frase curta; senão, não escreva nada.";
    default:
      return "Ok (ensaio).";
  }
}

export type Versao = {
  resposta: string[];
  ferramentas: Array<{ nome: string; entrada: string }>;
  passou: boolean;
  motivo: string;
  erro?: string;
};

export type ResultadoRespostas = {
  id: string;
  titulo: string;
  esperado: string;
  conversa: FalaEnsaio[];
  antes: Versao;
  depois: Versao;
};

const perguntaAlmofada = /almofad[^?\n]*\?|(solt|fix|pres)[^?\n]*\?/i;

/** Confere o "depois" de cada conversa (o "antes" mostra o comportamento de hoje). */
export function conferirRespostas(
  id: string,
  texto: string,
  ferramentas: Array<{ nome: string; entrada: unknown }>,
): { passou: boolean; motivo: string } {
  const problemas: string[] = [];
  const transferiu = ferramentas.some((f) => f.nome === "transferir_para_humano");
  if (id === "final-3615") {
    if (perguntaAlmofada.test(texto)) problemas.push("perguntou das almofadas de novo");
    const orc = ferramentas.find((f) => f.nome === "criar_orcamento");
    if (orc && /almofadas_soltas"\s*:\s*true/.test(JSON.stringify(orc.entrada)))
      problemas.push("marcou almofadas soltas");
  }
  if (id === "final-7010") {
    if (transferiu) problemas.push("passou para a equipe");
    if (/foto[^.?\n]*(perto|tecido|trama)|(perto|trama)[^.?\n]*foto/i.test(texto))
      problemas.push("pediu foto do tecido");
    if (/\b(classe|categoria)\b/i.test(texto)) problemas.push("falou de classe/categoria");
  }
  return { passou: !problemas.length, motivo: problemas.join("; ") || "ok" };
}

export async function rodarEnsaioRespostas(
  db: Db,
  empresaId: string,
): Promise<ResultadoRespostas[]> {
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
  // Regras de hoje x regras novas (roteiro do tecido e tecido B só em memória).
  const fixasAntes = instrucoesFixas({ ...empresa, regraNome: true, regraRespostas: false });
  let instrucoesDepois = empresa.instrucoes;
  try {
    instrucoesDepois = aplicarRoteiroTecido(empresa.instrucoes);
  } catch {
    /* roteiro sem a linha do tecido: fica como está */
  }
  const fixasDepois = instrucoesFixas({
    ...empresa,
    instrucoes: instrucoesDepois,
    regraNome: true,
    regraRespostas: true,
    tecidoNaoIdentificado: "B",
  });
  const cliente = new Anthropic();

  async function versao(c: CenarioRespostas, fixas: string, conferir: boolean): Promise<Versao> {
    try {
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
        historico: c.historico,
        respostaDeEnsaio,
      });
      const ok = conferir
        ? conferirRespostas(c.id, r.resposta.join("\n\n"), r.ferramentas)
        : { passou: true, motivo: "como é hoje" };
      return {
        resposta: r.resposta,
        ferramentas: r.ferramentas.map((u) => ({
          nome: u.nome,
          entrada: JSON.stringify(u.entrada),
        })),
        ...ok,
      };
    } catch (e) {
      return {
        resposta: [],
        ferramentas: [],
        passou: false,
        motivo: "erro",
        erro: e instanceof Error ? e.message.slice(0, 300) : String(e),
      };
    }
  }

  return Promise.all(
    CENARIOS_RESPOSTAS.map(async (c) => {
      const [antes, depois] = await Promise.all([
        versao(c, fixasAntes, false),
        versao(c, fixasDepois, true),
      ]);
      return {
        id: c.id,
        titulo: c.titulo,
        esperado: c.esperado,
        conversa: c.historico,
        antes,
        depois,
      };
    }),
  );
}
