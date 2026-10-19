// PDF da OS e do termo: gera o arquivo de verdade e lê o texto de volta (pdf.js). Dados fictícios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  EXEMPLO_OS,
  EXEMPLO_TERMO,
  nomeArquivoOrcamento,
  nomeArquivoOs,
  pdfDaOs,
  pdfDoTermo,
  type DadosOsPdf,
} from "./os-pdf";
import { configDocumentos, linhasCabecalho, type EmpresaDocumento } from "./textos-padrao";
import { blocos, substituir } from "./marcacao";

async function lerPdf(bytes: Uint8Array) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const paginas: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    paginas.push(
      c.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
        .replace(/\s+/g, " "),
    );
  }
  return { paginas: pdf.numPages, texto: paginas.join(" \n ") };
}

/** PNG 2×2 vermelho, montado aqui (sem arquivo). */
function pngMinimo(): Uint8Array {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (tipo: string, dados: Buffer) => {
    const t = Buffer.from(tipo);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([len, t, dados, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const linhas = Buffer.from([0, 255, 0, 0, 255, 0, 0, 0, 255, 0, 0, 255, 0, 0]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(linhas)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const empresa: EmpresaDocumento = {
  nome: "Empresa Fictícia Higienização",
  cnpj: "00.000.000/0001-00",
  email: "contato@exemplo.invalid",
  telefone: "(11) 90000-0000",
  endereco: "Rua Exemplo, 100 - São Paulo - SP",
  instagram: "@exemplo",
  logo: { bytes: pngMinimo(), tipo: "png" },
};
const config = configDocumentos({ modo: "pdf" });

const soHig: DadosOsPdf = {
  ...EXEMPLO_OS,
  temImp: false,
  linhas: [{ item: "Sofá 3 lugares", qtd: "1", hig: "R$ 280,00", imp: "—" }],
  valorTotal: "R$ 280,00 no Pix",
  formaPagamento: "Pix",
};
const soImp: DadosOsPdf = {
  ...EXEMPLO_OS,
  temHig: false,
  linhas: [{ item: "Sofá 3 lugares", qtd: "1", hig: "—", imp: "R$ 560,00" }],
};

test("só higienização: sem nenhum texto de garantia nem coluna de impermeabilização", async () => {
  const { texto, paginas } = await lerPdf(await pdfDaOs(soHig, empresa, config));
  assert.equal(paginas, 1);
  assert.match(texto, /Ordem de serviço Nº 0001/);
  assert.match(texto, /Serviços contratados: HIGIENIZAÇÃO/);
  assert.match(texto, /Higienização/);
  assert.doesNotMatch(texto, /Impermeabilização/);
  assert.doesNotMatch(texto, /[Gg]arantia/);
  assert.doesNotMatch(texto, /Próximos passos/);
  assert.match(texto, /válido por 15 dias/);
  assert.match(texto, /24 horas de antecedência/);
  assert.match(texto, /Agradecemos por escolher e confiar na Empresa Fictícia Higienização!/);
});

test("com impermeabilização: benefícios e garantia (meses e fluidos corporais)", async () => {
  const { texto } = await lerPdf(await pdfDaOs(soImp, empresa, { ...config, garantia_meses: 6 }));
  assert.match(texto, /Serviços contratados: IMPERMEABILIZAÇÃO/);
  assert.doesNotMatch(texto, /Higienização R\$|Higienização Impermeabilização/);
  assert.match(texto, /Benefícios da impermeabilização/);
  assert.match(texto, /Período de garantia: 6 meses/);
  assert.match(texto, /fluidos corporais/);
});

test("combinado: as duas colunas, dados da empresa no cabeçalho e Turbine em lugar nenhum", async () => {
  const { texto } = await lerPdf(await pdfDaOs(EXEMPLO_OS, empresa, config));
  assert.match(texto, /HIGIENIZAÇÃO E IMPERMEABILIZAÇÃO/);
  assert.match(texto, /Estofado Quantidade Higienização Impermeabilização/);
  assert.match(texto, /CNPJ: 00\.000\.000\/0001-00/);
  assert.match(texto, /Instagram: @exemplo/);
  assert.match(texto, /R\$ 1\.784,64 em até 10x sem juros/);
  assert.doesNotMatch(texto, /Turbine/i);
});

test("empresa sem logo e com campos vazios: cabeçalho só com o que existe", async () => {
  const semNada: EmpresaDocumento = {
    nome: "Outra Fictícia",
    cnpj: null,
    email: null,
    telefone: "(11) 91111-1111",
    endereco: null,
    instagram: null,
    logo: null,
  };
  assert.deepEqual(linhasCabecalho(semNada), ["Contato: (11) 91111-1111"]);
  const { texto } = await lerPdf(await pdfDaOs(soHig, semNada, config));
  assert.match(texto, /Outra Fictícia/);
  assert.doesNotMatch(texto, /CNPJ|E-mail|Endereço|Instagram/);
});

test("nome longo e muitos itens: quebra de página com cabeçalho da tabela repetido", async () => {
  const muitos: DadosOsPdf = {
    ...EXEMPLO_OS,
    cliente: "Maria Aparecida dos Santos Oliveira Ferreira de Albuquerque Cavalcanti Fictícia",
    linhas: Array.from({ length: 45 }, (_, i) => ({
      item: `Item fictício número ${i + 1} com descrição comprida para quebrar a linha da célula`,
      qtd: String((i % 4) + 1),
      hig: "R$ 100,00",
      imp: "R$ 200,00",
    })),
  };
  const { texto, paginas } = await lerPdf(await pdfDaOs(muitos, empresa, config));
  assert.ok(paginas >= 3, `páginas: ${paginas}`);
  assert.match(texto, /Item fictício número 45/);
  assert.ok((texto.match(/Estofado Quantidade/g) ?? []).length >= 2, "cabeçalho repetido");
  assert.match(texto, new RegExp(`Página ${paginas} de ${paginas}`));
  assert.match(texto, /Cavalcanti Fictícia/);
});

test("termo de garantia: dados do serviço e textos com a empresa, sem Turbine", async () => {
  const { texto } = await lerPdf(await pdfDoTermo(EXEMPLO_TERMO, empresa, config));
  assert.match(texto, /TERMO DE GARANTIA/);
  assert.match(texto, /Data do serviço: 01\/01\/2027/);
  assert.match(texto, /Técnico responsável: Técnico Exemplo/);
  assert.match(texto, /Próxima impermeabilização: 01\/01\/2028/);
  assert.match(texto, /3 visitas técnicas gratuitas/);
  assert.match(texto, /30% do valor pago/);
  assert.match(texto, /R\$ 2,00 por quilômetro/);
  assert.match(texto, /WhatsApp da Empresa Fictícia Higienização: \(11\) 90000-0000/);
  assert.match(texto, /Rua Exemplo, 100/);
  assert.doesNotMatch(texto, /Turbine/i);
});

test("emoji e caracteres fora da fonte não quebram o PDF", async () => {
  const { texto } = await lerPdf(
    await pdfDaOs({ ...soHig, cliente: "Cliente 😀 Fictício ✨" }, empresa, config),
  );
  assert.match(texto, /Cliente\s+Fictício/);
});

test("marcação, variáveis, configuração e nome do arquivo", () => {
  assert.deepEqual(blocos("## Título\n\nLinha **forte** aqui\n- item\n1. passo"), [
    { tipo: "subtitulo", texto: "Título" },
    {
      tipo: "paragrafo",
      trechos: [
        { texto: "Linha ", negrito: false },
        { texto: "forte", negrito: true },
        { texto: " aqui", negrito: false },
      ],
    },
    { tipo: "item", marcador: "•", trechos: [{ texto: "item", negrito: false }] },
    { tipo: "item", marcador: "1.", trechos: [{ texto: "passo", negrito: false }] },
  ]);
  assert.equal(substituir("{empresa} {x}", { empresa: "A" }), "A ");
  const c = configDocumentos({ validade: "  ", garantia_meses: 999 });
  assert.equal(c.modo, "drive");
  assert.match(c.validade, /15 dias/);
  assert.equal(c.garantia_meses, 12);
  assert.equal(nomeArquivoOs("1690", "Ana / Fictícia"), "OS 1690 - Ana Fictícia.pdf");
});

// ---------- PDF do orçamento (sem OS, sem Drive) ----------

const orcamentoBase = {
  data: "19/10/2026",
  validoAte: "26/10/2026",
  validadeDias: 7,
  desconto: null,
  pagamento: [
    "Total: R$ 280,00 em até 5x de R$ 56,00 sem juros no cartão",
    "No Pix (5% de desconto): R$ 266,00",
  ],
};

test("orçamento só higienização: título, data, validade calculada e nada de garantia", async () => {
  const { texto } = await lerPdf(
    await pdfDaOs(
      { ...soHig, numero: "0153", valorTotal: "R$ 280,00", orcamento: orcamentoBase },
      empresa,
      config,
    ),
  );
  assert.match(texto, /Orçamento Nº 0153/);
  assert.doesNotMatch(texto, /Ordem de serviço/);
  assert.match(texto, /Data do orçamento: 19\/10\/2026/);
  assert.match(texto, /Válido até: 26\/10\/2026/);
  assert.match(texto, /válido por 7 dias, até 26\/10\/2026/);
  assert.doesNotMatch(texto, /15 dias/);
  assert.match(texto, /No Pix \(5% de desconto\): R\$ 266,00/);
  assert.doesNotMatch(texto, /[Gg]arantia/);
  assert.match(texto, /24 horas de antecedência/);
});

test("orçamento com impermeabilização: benefícios e garantia", async () => {
  const { texto } = await lerPdf(
    await pdfDaOs({ ...soImp, orcamento: orcamentoBase }, empresa, config),
  );
  assert.match(texto, /Orçamento Nº 0001/);
  assert.match(texto, /Benefícios da impermeabilização/);
  assert.match(texto, /Período de garantia: 12 meses/);
});

test("orçamento com cupom: subtotal, linha do cupom e Pix sobre o total com cupom", async () => {
  const { texto } = await lerPdf(
    await pdfDaOs(
      {
        ...soHig,
        valorTotal: "R$ 210,00",
        orcamento: {
          ...orcamentoBase,
          desconto: { subtotal: "R$ 260,00", rotulo: "Cupom BLOG50", valor: "R$ 50,00" },
          pagamento: [
            "Total: R$ 210,00 em até 5x de R$ 42,00 sem juros no cartão",
            "No Pix (5% de desconto): R$ 199,50",
          ],
        },
      },
      empresa,
      config,
    ),
  );
  assert.match(texto, /Subtotal: R\$ 260,00/);
  assert.match(texto, /Cupom BLOG50: [-−]R\$ 50,00/);
  assert.match(texto, /Valor total: R\$ 210,00/);
  assert.match(texto, /No Pix \(5% de desconto\): R\$ 199,50/);
});

test("orçamento sem logo e nome do arquivo", async () => {
  const semLogo: EmpresaDocumento = { ...empresa, logo: null, cnpj: null };
  const { texto } = await lerPdf(
    await pdfDaOs({ ...soHig, orcamento: orcamentoBase }, semLogo, config),
  );
  assert.match(texto, /Orçamento Nº/);
  assert.doesNotMatch(texto, /CNPJ/);
  assert.equal(nomeArquivoOrcamento("0153", "Ana / Fictícia"), "Orçamento 0153 - Ana Fictícia.pdf");
});
