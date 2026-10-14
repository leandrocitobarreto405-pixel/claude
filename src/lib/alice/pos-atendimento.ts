/**
 * Depois do agendamento: confirmação na véspera, pós-venda no dia seguinte ao serviço e pedido de
 * avaliação. Regras sem banco (datas, textos e o que fazer com a resposta), para testar.
 */
import { janelaChegada } from "./agendamento";

export type TipoPos = "confirmacao" | "pos_venda";

/** Visitas que recebem a confirmação na véspera: a remarcada fica "Reagendado" e também conta. */
export const STATUS_CONFIRMACAO = ["Agendado", "Reagendado"];

/**
 * OS que pode receber mensagem: existe, não foi excluída nem cancelada e não é de teste
 * (uma OS de teste criada no endereço de teste lê o mesmo banco e mandaria mensagem de verdade).
 */
export function osElegivel(
  wo:
    | { deleted_at?: string | null; status?: string | null; eh_teste?: boolean | null }
    | null
    | undefined,
): boolean {
  if (!wo) return false;
  if (wo.deleted_at) return false;
  if (wo.eh_teste) return false;
  return !/cancel/i.test(wo.status ?? "");
}
export type RespostaPos = "confirmou" | "remarcar" | "elogio" | "problema" | "outro";

const DIAS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

function somarDias(data: string, n: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diaDaSemana = (data: string) => new Date(`${data}T12:00:00Z`).getUTCDay();
export const nomeDoDia = (data: string) => DIAS[diaDaSemana(data)]!;

/** Dia de serviço a confirmar hoje: sempre a véspera (todos os dias, inclusive domingo). */
export function datasConfirmacao(hoje: string): string[] {
  return [somarDias(hoje, 1)];
}

/** Dia de serviço concluído com pós-venda hoje: sempre o dia anterior (inclusive domingo). */
export function datasPosVenda(hoje: string): string[] {
  return [somarDias(hoje, -1)];
}

/** "Maria Clara Souza" → "Maria". */
export function primeiroNome(nome: string | null | undefined): string {
  const p = (nome ?? "").trim().split(/\s+/)[0] ?? "";
  if (!p) return "";
  return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
}

/** Janela de chegada para o modelo: "10:00" → "10h e 11h" (o modelo já diz "entre"). */
export function janelaModelo(hora: string): string {
  return janelaChegada(hora).replace(/^entre /, "");
}

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const TIPOS: Array<{ chave: string; um: string; varios: string; termos: string[] }> = [
  { chave: "colchao", um: "o seu colchão", varios: "os seus colchões", termos: ["colchao"] },
  { chave: "poltrona", um: "a sua poltrona", varios: "as suas poltronas", termos: ["poltrona"] },
  { chave: "cadeira", um: "a sua cadeira", varios: "as suas cadeiras", termos: ["cadeira"] },
  {
    chave: "puff",
    um: "o seu puff",
    varios: "os seus puffs",
    termos: ["puff", "pufe", "banqueta"],
  },
  {
    chave: "cabeceira",
    um: "a sua cabeceira",
    varios: "as suas cabeceiras",
    termos: ["cabeceira"],
  },
  { chave: "tapete", um: "o seu tapete", varios: "os seus tapetes", termos: ["tapete"] },
  { chave: "persiana", um: "a sua persiana", varios: "as suas persianas", termos: ["persiana"] },
  { chave: "sofa", um: "o seu sofá", varios: "os seus sofás", termos: ["sofa"] },
];

/**
 * O estofado com possessivo e só o tipo (sem modelo nem tamanho): "o seu sofá", "a sua poltrona";
 * mais de uma peça do mesmo tipo, no plural; mais de um tipo, "os seus estofados".
 */
export function estofadoPossessivo(
  itens: Array<{ descricao: string; quantidade: number }>,
): string {
  const achados = new Map<string, { um: string; varios: string; qtd: number }>();
  for (const i of itens) {
    const t = norm(i.descricao);
    const tipo = TIPOS.find((x) => x.termos.some((termo) => t.includes(termo)));
    const chave = tipo?.chave ?? "outro";
    const atual = achados.get(chave) ?? {
      um: tipo?.um ?? "o seu estofado",
      varios: tipo?.varios ?? "os seus estofados",
      qtd: 0,
    };
    atual.qtd += Math.max(1, Math.round(i.quantidade || 1));
    achados.set(chave, atual);
  }
  if (achados.size !== 1) return "os seus estofados";
  const [unico] = [...achados.values()];
  return unico!.qtd > 1 ? unico!.varios : unico!.um;
}

/** Corpo do modelo com as variáveis ({{1}}, {{2}}...) preenchidas. */
export function preencherCorpo(corpo: string, vars: string[]): string {
  return corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n: string) => vars[Number(n) - 1] ?? "");
}

/** Texto padrão (mesmo do modelo) quando a cliente escreveu nas últimas 24 h. */
export const TEXTO_PADRAO: Record<TipoPos, string> = {
  confirmacao:
    "Oi, {{1}}, tudo bem? Alice aqui 💙 Passando para confirmar o seu serviço de {{2}}, com o técnico chegando entre {{3}}. Está tudo certo para realizarmos o serviço?",
  pos_venda:
    "Bom dia, {{1}}, tudo bem? Alice aqui 💙 Separamos a pasta do seu serviço, com a OS e as fotos e vídeos de antes e depois: {{2}} Como foi o atendimento do {{3}}? Ficou tudo certo com {{4}} depois do serviço?",
};

/** Quantas variáveis cada modelo precisa ter (confirmação: nome, dia, janela). */
export const VARIAVEIS_MODELO: Record<TipoPos, number> = { confirmacao: 3, pos_venda: 4 };

/**
 * Modelos antigos (texto com "amanhã"/"ontem" fixos, variáveis diferentes): nunca são usados.
 * Os nomes em uso são tc_confirmacao_servico_v2 e tc_pos_venda_v2.
 */
export const MODELOS_ANTIGOS = ["tc_confirmacao_servico", "tc_pos_venda"];

/** O texto do modelo serve para o código novo? (nada de "amanhã"/"ontem" fixos.) */
export function problemaNoModelo(tipo: TipoPos, nome: string, corpo: string): string | null {
  if (MODELOS_ANTIGOS.includes(nome))
    return `o modelo ${nome} é o antigo (com "amanhã"/"ontem" fixos) e não é usado; use ${nome}_v2`;
  const n = new Set([...corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => m[1])).size;
  if (n !== VARIAVEIS_MODELO[tipo])
    return `o modelo ${nome} tem ${n} variáveis e precisa de ${VARIAVEIS_MODELO[tipo]}`;
  const fixo = tipo === "confirmacao" ? /\bamanh[ãa]\b/i : /\bontem\b/i;
  if (fixo.test(corpo))
    return `o modelo ${nome} tem "${tipo === "confirmacao" ? "amanhã" : "ontem"}" fixo no texto`;
  return null;
}

/** Sem pasta ou sem fotos: o lugar do link explica que a equipe manda depois. */
export const SEM_LINK = "a equipe te manda o link em seguida.";

/**
 * Dia do serviço na confirmação: "amanhã" quando é o dia seguinte; senão, dia da semana e data
 * ("segunda-feira, 13/10"), para quando o serviço não for no dia seguinte.
 */
export function diaDoServico(hoje: string, dataServico: string): string {
  if (dataServico === somarDias(hoje, 1)) return "amanhã";
  const [, mm, dd] = dataServico.split("-");
  return `${nomeDoDia(dataServico)}, ${dd}/${mm}`;
}

/** Janela de 24 h do WhatsApp: texto livre só se a cliente escreveu nas últimas 24 h. */
export function dentroDe24h(ultimaDoCliente: Date | null, agora: Date): boolean {
  return Boolean(ultimaDoCliente && agora.getTime() - ultimaDoCliente.getTime() < 24 * 3600_000);
}

export type DecisaoResposta = {
  /** Transfere para a equipe com este motivo. */
  transferir: string | null;
  /** Manda o pedido de avaliação (texto livre). */
  avaliar: boolean;
  /** Confirmação: marca o atendimento como confirmado. */
  confirmar: boolean;
  /** Orientação para a Alice escrever a resposta. */
  orientacao: string;
};

/**
 * O que fazer com a resposta da cliente à mensagem da Alice. "restrito": OS que a equipe agendou
 * ou cliente antiga (a Alice só trata a resposta; o resto vai para a equipe).
 */
export function decidirResposta(r: {
  tipo: TipoPos;
  resposta: RespostaPos;
  restrito: boolean;
  osDaAlice: boolean;
  podeRemarcar: boolean;
  avaliacaoPossivel: boolean;
}): DecisaoResposta {
  const base = { transferir: null, avaliar: false, confirmar: false };
  switch (r.resposta) {
    case "confirmou":
      return {
        ...base,
        confirmar: r.tipo === "confirmacao",
        orientacao: "Registrado. Agradeça numa frase curta e calorosa.",
      };
    case "remarcar":
      if (r.osDaAlice && r.podeRemarcar)
        return {
          ...base,
          orientacao:
            "Pode remarcar: consulte a agenda (consultar_agenda), ofereça horários livres e use remarcar_horario com o ok do cliente.",
        };
      return {
        ...base,
        transferir: r.podeRemarcar ? "remarcação" : "remarcação de véspera",
        orientacao:
          "Diga com gentileza que vai pedir para a equipe ajustar o horário e já retorna. Não prometa horário.",
      };
    case "problema":
      return {
        ...base,
        transferir: "garantia",
        orientacao:
          "Acolha, peça desculpas pelo transtorno e diga que a equipe vai entrar em contato para agendar uma visita técnica gratuita. Não fale de valores nem do que a garantia cobre.",
      };
    case "elogio":
      return {
        ...base,
        avaliar: r.tipo === "pos_venda" && r.avaliacaoPossivel,
        orientacao:
          r.tipo === "pos_venda" && r.avaliacaoPossivel
            ? "O pedido de avaliação vai junto, já com o link: não escreva outra mensagem pedindo avaliação."
            : "Agradeça com carinho, sem pedir avaliação.",
      };
    default:
      return r.restrito
        ? {
            ...base,
            transferir: "outro assunto depois da confirmação/pós-venda",
            orientacao: "Diga que vai chamar a equipe para te ajudar com isso, numa frase curta.",
          }
        : { ...base, orientacao: "Siga o atendimento normalmente." };
  }
}

/** Texto do pedido de avaliação ({nome}, {empresa}, {link}). */
export function textoAvaliacao(
  modelo: string,
  nome: string,
  empresa: string,
  link: string,
): string {
  return modelo
    .replace(/\{nome\}/g, nome)
    .replace(/\{empresa\}/g, empresa)
    .replace(/\{link\}/g, link);
}
