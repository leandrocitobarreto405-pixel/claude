/**
 * Importação da base de contatos (planilha): as colunas que a importação reconhece pelo título e
 * os modelos prontos para baixar. Sem banco nem rede, para poder testar.
 */
import type { LinhaImportacao } from "@/lib/marketing.functions";

export type CampoImportacao = keyof Omit<LinhaImportacao, "tipo">;

export const semAcento = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Colunas reconhecidas pelo título. */
export const CAMPOS: Array<{ chave: CampoImportacao; nomes: string[]; label: string }> = [
  {
    chave: "telefone",
    nomes: ["telefone", "celular", "whatsapp", "fone", "phone"],
    label: "Telefone",
  },
  { chave: "nome", nomes: ["nome", "cliente", "name"], label: "Nome" },
  {
    chave: "servico_em",
    nomes: ["data do servico", "data servico", "ultimo servico", "data da os", "data"],
    label: "Data do último serviço",
  },
  { chave: "servico_tipo", nomes: ["tipo do servico", "servico", "tipo"], label: "Serviço feito" },
  {
    chave: "entrada_em",
    nomes: ["data de entrada", "entrada", "primeiro contato", "data do orcamento"],
    label: "Data de entrada (lead)",
  },
  {
    chave: "interesse",
    nomes: ["interesse", "servico de interesse"],
    label: "Serviço de interesse",
  },
  {
    chave: "pediu_orcamento",
    nomes: ["pediu orcamento", "pediu o orcamento", "orcamento"],
    label: "Pediu orçamento (Sim/Não)",
  },
];

/** Nomes curtos que só valem quando nenhum nome mais específico achou a coluna. */
const GENERICOS = new Set(["data", "tipo", "servico", "orcamento"]);

/**
 * Qual coluna da planilha vai para cada campo. Primeiro o título igual, depois o título que
 * contém o nome, e só no fim os nomes genéricos ("data", "tipo"…), para "Data de entrada" não
 * virar data do serviço. Cada coluna vai para um campo só.
 */
export function mapearColunas(colunas: string[]): Partial<Record<CampoImportacao, string>> {
  const mapa: Partial<Record<CampoImportacao, string>> = {};
  const usada = (col: string) => Object.values(mapa).includes(col);
  const limpas = colunas.map((c) => ({ col: c, t: semAcento(c).trim() }));
  const passes: Array<(nome: string, t: string) => boolean> = [
    (nome, t) => t === nome,
    (nome, t) => !GENERICOS.has(nome) && t.includes(nome),
    (nome, t) => t.includes(nome),
  ];
  for (const casa of passes) {
    for (const c of CAMPOS) {
      if (mapa[c.chave]) continue;
      for (const nome of c.nomes) {
        const achada = limpas.find((x) => !usada(x.col) && casa(nome, x.t));
        if (achada) {
          mapa[c.chave] = achada.col;
          break;
        }
      }
    }
  }
  return mapa;
}

export type TipoModelo = "comprador" | "nao_comprador";

/** Modelos prontos: títulos que a importação reconhece e 2 linhas de exemplo. */
export const MODELOS: Record<
  TipoModelo,
  { rotulo: string; arquivo: string; colunas: string[]; exemplos: string[][] }
> = {
  comprador: {
    rotulo: "Modelo de compradores",
    arquivo: "modelo-compradores.xlsx",
    colunas: ["Telefone", "Nome", "Data do serviço", "Tipo do serviço"],
    exemplos: [
      ["(11) 99999-0001", "Maria Exemplo", "15/03/2026", "Higienização"],
      ["(11) 99999-0002", "João Exemplo", "20/09/2025", "Impermeabilização"],
    ],
  },
  nao_comprador: {
    rotulo: "Modelo de não compradores",
    arquivo: "modelo-nao-compradores.xlsx",
    colunas: ["Telefone", "Nome", "Data de entrada", "Pediu orçamento", "Interesse"],
    exemplos: [
      ["(11) 99999-0003", "Ana Exemplo", "10/08/2026", "Sim", "Sofá"],
      ["(11) 99999-0004", "Carlos Exemplo", "05/05/2026", "Não", "Colchão"],
    ],
  },
};

/** Para onde cada pessoa vai (o mesmo texto na aba Base e no checklist da empresa). */
export const COMO_FUNCIONA = [
  "Compradores vão para Clientes pela data do último serviço. O tipo do serviço define os lembretes: higienização recebe o de 6 meses e impermeabilização o do 13º mês.",
  'Não compradores com "Pediu orçamento = Sim" vão para Orçamento sem agendamento; os outros vão para Conversou e não pediu orçamento.',
  "Preencha a data: sem ela a pessoa não cai na faixa certa e fica fora das listas.",
] as const;

/** Instruções que vão na segunda aba do arquivo (a importação só lê a primeira). */
export function instrucoesDoModelo(tipo: TipoModelo): string[] {
  return [
    "Como preencher",
    "",
    "Uma pessoa por linha, na primeira aba. Não mude os títulos da primeira linha.",
    "Apague as 2 linhas de exemplo antes de importar.",
    "Datas no formato dd/mm/aaaa.",
    tipo === "comprador"
      ? "Tipo do serviço: Higienização ou Impermeabilização (outro texto fica sem lembrete)."
      : 'Pediu orçamento: "Sim" ou "Não".',
    "",
    ...COMO_FUNCIONA,
  ];
}
