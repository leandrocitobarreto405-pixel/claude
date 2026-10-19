/**
 * PDF da OS e do termo de garantia, no layout dos modelos da Turbine: cabeçalho da empresa,
 * "Ordem de serviço Nº", cliente, serviços, tabela (só as colunas usadas), valor, pagamento,
 * validade; com impermeabilização, benefícios e garantia; cancelamento e agradecimento.
 * Só higienização: nenhum texto de garantia.
 */
import { Documento } from "./layout";
import { substituir } from "./marcacao";
import {
  linhasCabecalho,
  variaveis,
  type ConfigDocumentos,
  type EmpresaDocumento,
} from "./textos-padrao";

export type LinhaOsPdf = { item: string; qtd: string; hig: string; imp: string };

export type DadosOsPdf = {
  numero: string;
  cliente: string;
  /** "nº 1234" (fim do telefone), como no documento do Drive. */
  clienteTexto: string;
  temHig: boolean;
  temImp: boolean;
  linhas: LinhaOsPdf[];
  valorTotal: string;
  formaPagamento: string;
  /** Presente no PDF do orçamento (sem OS): título, datas, desconto e linhas do pagamento. */
  orcamento?: DadosOrcamentoPdf;
};

export type DadosOrcamentoPdf = {
  /** "19/10/2026" */
  data: string;
  validoAte: string;
  validadeDias: number;
  desconto: { subtotal: string; rotulo: string; valor: string } | null;
  /** Como na mensagem do orçamento: total/parcelas no cartão e valor no Pix. */
  pagamento: string[];
};

export type DadosTermoPdf = {
  numero: string;
  cliente: string;
  dataServico: string;
  tecnico: string;
  estofados: string;
  proxima: string;
};

function nomeArquivo(prefixo: string, numero: string, cliente: string) {
  const limpo = (s: string) =>
    s
      .replace(/[\\/:*?"<>|\n\r]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return `${prefixo} ${limpo(numero)} - ${limpo(cliente) || "cliente"}.pdf`;
}

export function nomeArquivoOs(numero: string, cliente: string) {
  return nomeArquivo("OS", numero, cliente);
}

export function nomeArquivoOrcamento(numero: string, cliente: string) {
  return nomeArquivo("Orçamento", numero, cliente);
}

export function servicosContratados(d: { temHig: boolean; temImp: boolean }) {
  if (d.temHig && d.temImp) return "HIGIENIZAÇÃO E IMPERMEABILIZAÇÃO";
  if (d.temImp) return "IMPERMEABILIZAÇÃO";
  return "HIGIENIZAÇÃO";
}

async function cabecalho(doc: Documento, empresa: EmpresaDocumento) {
  const logo = empresa.logo ? await doc.imagem(empresa.logo.bytes, empresa.logo.tipo) : null;
  doc.cabecalhoEmpresa(logo, empresa.nome, linhasCabecalho(empresa));
  doc.definirRodape(empresa.nome);
}

export async function pdfDaOs(
  d: DadosOsPdf,
  empresa: EmpresaDocumento,
  c: ConfigDocumentos,
): Promise<Uint8Array> {
  const vars = variaveis(empresa, c);
  const orc = d.orcamento ?? null;
  const titulo = orc ? `Orçamento Nº ${d.numero}` : `Ordem de serviço Nº ${d.numero}`;
  const doc = await Documento.criar(titulo, empresa.nome);
  await cabecalho(doc, empresa);

  doc.texto(titulo, { tamanho: 16, negrito: true, depois: 4 });
  doc.campo("Cliente:", [d.cliente, d.clienteTexto].filter(Boolean).join(" "), 11);
  if (orc) {
    doc.campo("Data do orçamento:", orc.data);
    doc.campo("Válido até:", orc.validoAte);
  }
  doc.separador();
  doc.campo("Serviços contratados:", servicosContratados(d), 11);
  doc.espaco(4);

  const colunas: Array<{
    titulo: string;
    fracao: number;
    alinhamento?: "esquerda" | "centro" | "direita";
  }> = [
    { titulo: "Estofado", fracao: 0 },
    { titulo: "Quantidade", fracao: 0.16, alinhamento: "centro" },
  ];
  if (d.temHig) colunas.push({ titulo: "Higienização", fracao: 0.2, alinhamento: "direita" });
  if (d.temImp) colunas.push({ titulo: "Impermeabilização", fracao: 0.22, alinhamento: "direita" });
  colunas[0]!.fracao = 1 - colunas.slice(1).reduce((s, x) => s + x.fracao, 0);
  doc.tabela(
    colunas,
    d.linhas.map((l) => [
      l.item,
      l.qtd,
      ...(d.temHig ? [l.hig] : []),
      ...(d.temImp ? [l.imp] : []),
    ]),
  );

  if (orc?.desconto) {
    doc.campo("Subtotal:", orc.desconto.subtotal);
    doc.campo(`${orc.desconto.rotulo}:`, `-${orc.desconto.valor}`);
  }
  doc.destaque([
    { texto: "Valor total: ", negrito: true },
    { texto: d.valorTotal, negrito: false },
  ]);
  for (const linha of orc?.pagamento ?? []) doc.texto(linha, { tamanho: 10.5, depois: 2 });
  doc.campo("Forma de pagamento:", d.formaPagamento);
  doc.campo(
    "Observação:",
    orc
      ? `Este orçamento é válido por ${orc.validadeDias} dia${orc.validadeDias === 1 ? "" : "s"}, até ${orc.validoAte}.`
      : substituir(c.validade, vars),
  );

  if (d.temImp) {
    doc.separador();
    doc.titulo(`Benefícios da impermeabilização ${empresa.nome}`);
    doc.marcado(substituir(c.beneficios, vars));
    doc.separador();
    doc.titulo(`Garantia ${empresa.nome}`);
    doc.marcado(substituir(c.garantia_os, vars));
  }

  doc.separador();
  doc.titulo("Observação importante", 11.5);
  doc.marcado(substituir(c.cancelamento, vars));
  doc.espaco(10);
  doc.texto(substituir(c.agradecimento, vars), {
    tamanho: 13,
    negrito: true,
    alinhamento: "centro",
  });
  return doc.salvar();
}

export async function pdfDoTermo(
  d: DadosTermoPdf,
  empresa: EmpresaDocumento,
  c: ConfigDocumentos,
): Promise<Uint8Array> {
  const vars = variaveis(empresa, c);
  const doc = await Documento.criar(`Termo de garantia ${d.numero}`, empresa.nome);
  await cabecalho(doc, empresa);
  doc.texto("TERMO DE GARANTIA · SERVIÇO DE IMPERMEABILIZAÇÃO", {
    tamanho: 14,
    negrito: true,
    depois: 4,
  });
  doc.texto(`Ordem de serviço Nº ${d.numero} · Cliente: ${d.cliente}`, {
    tamanho: 11,
    negrito: true,
    depois: 6,
  });
  doc.campo("Data do serviço:", d.dataServico);
  doc.campo("Técnico responsável:", d.tecnico || "—");
  doc.campo("Estofado(s) atendido(s):", d.estofados || "—");
  doc.campo("Próxima impermeabilização:", d.proxima);
  doc.separador();
  doc.marcado(substituir(c.termo, vars));
  doc.espaco(10);
  doc.texto(substituir(c.agradecimento, vars), {
    tamanho: 13,
    negrito: true,
    alinhamento: "centro",
  });
  return doc.salvar();
}

/** Dados fictícios do "Ver PDF de exemplo". */
export const EXEMPLO_OS: DadosOsPdf = {
  numero: "0001",
  cliente: "Cliente Exemplo",
  clienteTexto: "nº 0000",
  temHig: true,
  temImp: true,
  linhas: [
    { item: "Sofá 3 lugares", qtd: "1", hig: "R$ 280,00", imp: "R$ 560,00" },
    { item: "Cadeira de jantar", qtd: "6", hig: "R$ 40,00/cada", imp: "R$ 80,00/cada" },
    { item: "Tapete (por m²)", qtd: "3,6 m²", hig: "R$ 62,40/m²", imp: "—" },
  ],
  valorTotal: "R$ 1.784,64 em até 10x sem juros",
  formaPagamento: "Cartão de crédito",
};

export const EXEMPLO_TERMO: DadosTermoPdf = {
  numero: "0001",
  cliente: "Cliente Exemplo",
  dataServico: "01/01/2027",
  tecnico: "Técnico Exemplo",
  estofados: "Sofá 3 lugares, 6x Cadeira de jantar",
  proxima: "01/01/2028",
};
