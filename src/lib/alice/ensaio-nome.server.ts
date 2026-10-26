/**
 * Ensaio da regra do nome: roda a Alice de verdade (mesmo modelo, instruções e ferramentas da
 * empresa) em 5 conversas inventadas, com a regra do nome e o roteiro novo só em memória.
 * Nada é enviado ao cliente nem gravado: as ferramentas devolvem respostas de ensaio.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ferramentasDisponiveis } from "./ferramentas.server";
import { contextoEmpresa, etapasAbertas, lerConfig } from "./motor.server";
import { rodarAliceEnsaio } from "./ensaio-rodar.server";
import { aplicarRoteiroNome } from "./nome-roteiro";
import type { SituacaoNome } from "./nome";
import { instrucoesDoMomento, instrucoesFixas, type ContextoLead } from "./prompt";

type Db = SupabaseClient<Database>;

export type Cenario = {
  id: string;
  titulo: string;
  esperado: string;
  perfil: string;
  nome: SituacaoNome;
  clienteExistente: boolean;
  historico: Array<{ de: "cliente" | "alice"; texto: string }>;
  /** O que se confere na resposta: perguntou o nome? usou qual nome? */
  deveP: boolean;
  nomeEsperado: string | null;
  nomeProibido: string | null;
};

const perguntaNome =
  /com quem (eu )?falo|como (voc[eê]|vc) se chama|qual (é )?(o )?seu nome|seu nome|te chamar/i;

export const CENARIOS: Cenario[] = [
  {
    id: "beatriz",
    titulo: 'Perfil "Beatriz" (usa direto)',
    esperado: "Chama de Beatriz, não pergunta o nome, registra o nome do perfil.",
    perfil: "Beatriz",
    nome: { confirmado: null, origem: null, perfil: "Beatriz", perguntas: 0 },
    clienteExistente: false,
    historico: [{ de: "cliente", texto: "Oi, boa tarde! Queria um orçamento pra limpar meu sofá" }],
    deveP: false,
    nomeEsperado: "Beatriz",
    nomeProibido: null,
  },
  {
    id: "jesus",
    titulo: 'Perfil "Sou mais Jesus" (pergunta)',
    esperado: "Responde a pergunta e pergunta o nome na mesma mensagem, sem usar o perfil.",
    perfil: "Sou mais Jesus",
    nome: { confirmado: null, origem: null, perfil: "Sou mais Jesus", perguntas: 0 },
    clienteExistente: false,
    historico: [{ de: "cliente", texto: "Olá, vocês limpam colchão também?" }],
    deveP: true,
    nomeEsperado: null,
    nomeProibido: "Jesus",
  },
  {
    id: "cacau",
    titulo: 'Perfil "Cacau" (pergunta)',
    esperado: "Se apresenta e pergunta o nome na mesma mensagem, sem chamar de Cacau.",
    perfil: "Cacau",
    nome: { confirmado: null, origem: null, perfil: "Cacau", perguntas: 0 },
    clienteExistente: false,
    historico: [{ de: "cliente", texto: "oi" }],
    deveP: true,
    nomeEsperado: null,
    nomeProibido: "Cacau",
  },
  {
    id: "ignora-1",
    titulo: "Cliente ignora a pergunta (1ª vez): pergunta de novo antes do orçamento",
    esperado: "Já perguntou uma vez; pergunta só mais uma, de forma natural, antes do orçamento.",
    perfil: "Bênção",
    nome: { confirmado: null, origem: null, perfil: "Bênção", perguntas: 1 },
    clienteExistente: false,
    historico: [
      { de: "cliente", texto: "Oi, quanto fica pra limpar um sofá de 3 lugares?" },
      {
        de: "alice",
        texto:
          "Oii, tudo bem? Seja muito bem-vindo(a) à Turbine Clean! 💙\nEu sou a Alice IA e vai ser um prazer enorme poder te ajudar com seus estofados hoje!\nCom quem eu falo?",
      },
      { de: "cliente", texto: "é retrátil, de suede, tá bem encardido. cep 04538-133" },
    ],
    deveP: true,
    nomeEsperado: null,
    nomeProibido: "Bênção",
  },
  {
    id: "ignora-2",
    titulo: "Cliente ignora a pergunta (2ª vez): segue sem nome",
    esperado: "Já perguntou duas vezes; não pergunta mais e segue sem nome.",
    perfil: "Bênção",
    nome: { confirmado: null, origem: null, perfil: "Bênção", perguntas: 2 },
    clienteExistente: false,
    historico: [
      { de: "cliente", texto: "Oi, quanto fica pra limpar um sofá de 3 lugares?" },
      {
        de: "alice",
        texto:
          "Oii, tudo bem? Seja muito bem-vindo(a) à Turbine Clean! 💙\nEu sou a Alice IA e vai ser um prazer enorme poder te ajudar com seus estofados hoje!\nCom quem eu falo?",
      },
      { de: "cliente", texto: "é retrátil, de suede, tá bem encardido. cep 04538-133" },
      {
        de: "alice",
        texto: "Obrigada pelas informações! Antes de eu montar seu orçamento, com quem eu falo? 😊",
      },
      { de: "cliente", texto: "pode mandar o valor logo por favor" },
    ],
    deveP: false,
    nomeEsperado: null,
    nomeProibido: "Bênção",
  },
  {
    id: "antigo",
    titulo: "Cliente antigo (nome do cadastro)",
    esperado: "Cumprimenta pelo nome do cadastro (Marcos) e não pergunta o nome.",
    perfil: "Família Abençoada 🙏",
    nome: {
      confirmado: "Marcos Pereira",
      origem: "cadastro",
      perfil: "Família Abençoada 🙏",
      perguntas: 0,
    },
    clienteExistente: true,
    historico: [{ de: "cliente", texto: "Oi, quero fazer de novo a limpeza do sofá" }],
    deveP: false,
    nomeEsperado: "Marcos",
    nomeProibido: "Família",
  },
];

/** Respostas de ensaio das ferramentas (nada é executado de verdade). */
function respostaDeEnsaio(c: Cenario, nome: string): string {
  switch (nome) {
    case "consultar_cliente":
      return c.clienteExistente
        ? "IA desligada: não; sem pós-venda: não. Já é cliente: Marcos Pereira, Pinheiros (São Paulo). Serviços anteriores: OS 1234 em 2026-03-10 (Concluída, R$ 389,90)."
        : "IA desligada: não; sem pós-venda: não. Cliente novo, sem serviços anteriores.";
    case "consultar_cep":
      return "CEP 04538-133: Itaim Bibi, São Paulo/SP. Dentro da área atendida, 9 km da base.";
    case "criar_orcamento":
      return "Orçamento criado (ensaio): Sofá retrátil 3 lugares — higienização R$ 389,90. Total R$ 389,90; cartão 10x de R$ 38,99; Pix R$ 370,41; válido por 7 dias.";
    case "transferir_para_humano":
      // Mesmo texto da ferramenta de verdade: a Alice ainda escreve a última mensagem.
      return "Transferência registrada: a equipe assume depois desta resposta. Se as instruções pedirem, avise o cliente numa frase curta; senão, não escreva nada.";
    default:
      return "Ok (ensaio).";
  }
}

export type ResultadoCenario = {
  id: string;
  titulo: string;
  esperado: string;
  conversa: Array<{ de: "cliente" | "alice"; texto: string }>;
  resposta: string[];
  /** Ferramentas chamadas, com a entrada em JSON. */
  ferramentas: Array<{ nome: string; entrada: string }>;
  perguntouNome: boolean;
  passou: boolean;
  motivo: string;
  erro?: string;
};

function conferir(
  c: Cenario,
  texto: string,
  ferramentas: Array<{ nome: string; entrada: unknown }>,
) {
  const perguntou = perguntaNome.test(texto);
  const problemas: string[] = [];
  if (c.deveP && !perguntou) problemas.push("não perguntou o nome");
  if (!c.deveP && perguntou) problemas.push("perguntou o nome sem precisar");
  if (c.nomeEsperado && !texto.includes(c.nomeEsperado))
    problemas.push(`não chamou de ${c.nomeEsperado}`);
  if (c.nomeProibido && texto.toLowerCase().includes(c.nomeProibido.toLowerCase()))
    problemas.push(`usou "${c.nomeProibido}" do perfil`);
  if (c.id === "beatriz" && !ferramentas.some((f) => f.nome === "registrar_nome_cliente"))
    problemas.push("não registrou o nome do perfil");
  return { perguntou, passou: !problemas.length, motivo: problemas.join("; ") || "ok" };
}

export async function rodarEnsaioNome(db: Db, empresaId: string): Promise<ResultadoCenario[]> {
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
  // Roteiro novo só em memória (a Turbine tem os trechos; outra empresa usa o roteiro como está).
  let instrucoes = empresa.instrucoes;
  try {
    instrucoes = aplicarRoteiroNome(empresa.instrucoes);
  } catch {
    /* roteiro sem os trechos da Turbine: fica como está */
  }
  const fixas = instrucoesFixas({ ...empresa, instrucoes, regraNome: true });
  const cliente = new Anthropic();

  return Promise.all(
    CENARIOS.map(async (c): Promise<ResultadoCenario> => {
      const base = { id: c.id, titulo: c.titulo, esperado: c.esperado, conversa: c.historico };
      try {
        const lead: ContextoLead = {
          nome: c.perfil,
          telefone: null,
          origem: "Instagram",
          campanha: null,
          servicoInteresse: null,
          descricaoEstofados: null,
          resumo: null,
          etapa: null,
          clienteExistente: c.clienteExistente,
          semPosVenda: false,
          nomeCliente: c.nome,
        };
        const { resposta, ferramentas: usadas } = await rodarAliceEnsaio({
          cliente,
          modelo: cfg.modelo,
          esforco: cfg.esforco,
          ferramentas,
          fixas,
          momento: instrucoesDoMomento(new Date(), lead),
          historico: c.historico,
          respostaDeEnsaio: (nome) => respostaDeEnsaio(c, nome),
        });
        const texto = resposta.join("\n\n");
        return {
          ...base,
          resposta,
          ferramentas: usadas.map((u) => ({ nome: u.nome, entrada: JSON.stringify(u.entrada) })),
          ...conferir(c, texto, usadas),
          perguntouNome: perguntaNome.test(texto),
        };
      } catch (e) {
        return {
          ...base,
          resposta: [],
          ferramentas: [],
          perguntouNome: false,
          passou: false,
          motivo: "erro",
          erro: e instanceof Error ? e.message.slice(0, 300) : String(e),
        };
      }
    }),
  );
}
