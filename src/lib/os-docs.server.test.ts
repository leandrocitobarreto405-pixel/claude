// Documento da OS e termo de garantia: a pasta do cliente fica com um documento só; os anteriores
// vão para o "Controle interno". Banco e Google simulados.
import { mock, test } from "node:test";
import assert from "node:assert/strict";

let relogio = Date.parse("2026-10-07T12:00:00Z");
const agora = () => new Date((relogio += 1000)).toISOString();

type Arquivo = { id: string; name: string; parent: string; createdTime: string; trashed: boolean };
const drive = new Map<string, Arquivo>();
let falharPreenchimento = false;
const copiasDe: string[] = [];
const preenchidos: Array<Record<string, string>> = [];
let seq = 0;
const novoArquivo = (name: string, parent: string) => {
  const id = `doc-${++seq}`;
  drive.set(id, { id, name, parent, createdTime: agora(), trashed: false });
  return id;
};

type Linha = Record<string, unknown>;
const tabelas: Record<string, Linha[]> = {
  app_settings: [
    {
      empresa_id: "emp-1",
      key: "os_document_settings",
      value: {
        enabled: true,
        templateHigienizacao: "modelo-hig",
        templateImpermeabilizacao: "modelo-imp",
        templateCombinado: "modelo-comb",
        templateGarantia: "modelo-garantia",
        folderId: "raiz",
      },
    },
  ],
  empresas: [],
  quotes: [
    {
      id: "orc-1",
      cliente_nome: "Diego Fictício",
      cliente_telefone: "5511900001682",
      total: 6959,
      valor_a_vista: 6611.05,
      valor_pix: null,
      forma_pagamento: "Maquininha",
      parcelas: 10,
      status: "rascunho",
      updated_at: "2026-10-16T12:00:00Z",
      proposta_documento_id: null,
      generated_work_order_id: null,
    },
  ],
  quote_items: [
    {
      quote_id: "orc-1",
      nome_snapshot: "Sofá 3 lugares",
      tipo_servico: "higienizacao",
      categoria: "sofa",
      quantidade: 1,
      preco_aplicado: 400,
      subtotal: 400,
      display_order: 1,
      tabela_preco_item_id: "t-sofa",
    },
    {
      quote_id: "orc-1",
      nome_snapshot: "Sofá 3 lugares",
      tipo_servico: "impermeabilizacao",
      categoria: "sofa",
      quantidade: 1,
      preco_aplicado: 800,
      subtotal: 800,
      display_order: 2,
      tabela_preco_item_id: "t-sofa",
    },
    {
      quote_id: "orc-1",
      nome_snapshot: "Tapete comum (por m²)",
      tipo_servico: "higienizacao",
      categoria: "tapete",
      quantidade: 3.6,
      preco_aplicado: 62.4,
      subtotal: 224.64,
      display_order: 3,
      tabela_preco_item_id: "t-tapete",
    },
  ],
  work_order_documents: [],
  work_orders: [
    {
      id: "os-1",
      os_number: "1628",
      updated_at: "2026-10-07T11:00:00Z",
      total_gross_value: 360,
      os_value_text: null,
      negotiated_payment_method: "Pix",
      negotiated_installments: 1,
      customer: { full_name: "Giulia Ramilo Assunção", phone: "5511988887777" },
      visits: [
        {
          status: "Concluído",
          scheduled_date: "2026-10-07",
          completion_date: "2026-10-07",
          visit_value: 360,
          final_value: 360,
          item_quantity: 1,
          upholstery_description: "Sofá",
          service_type: { name: "Higienização e impermeabilização" },
          upholstery_type: null,
          technician: { name: "Josué" },
          service_items: [],
        },
      ],
    },
  ],
};

class Consulta {
  private filtros: Array<(l: Linha) => boolean> = [];
  private mudanca: Linha | null = null;
  private nova: Linha | null = null;
  private ordem: Array<[string, boolean]> = [];
  private limite = Infinity;
  constructor(private tabela: string) {}
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtros.push((l) => l[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filtros.push((l) => l[c] !== v);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.filtros.push((l) => v.includes(l[c]));
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.ordem.push([c, o?.ascending !== false]);
    return this;
  }
  limit(n: number) {
    this.limite = n;
    return this;
  }
  insert(l: Linha) {
    this.nova = { id: `reg-${++seq}`, created_at: agora(), google_document_id: null, ...l };
    return this;
  }
  update(m: Linha) {
    this.mudanca = m;
    return this;
  }
  upsert(m: Linha) {
    // Configurações da empresa: troca o valor da chave (empresa emp-1).
    const t = (tabelas[this.tabela] ??= []);
    const atual = t.find((l) => l["key"] === m["key"] && l["empresa_id"] === "emp-1");
    if (atual) Object.assign(atual, m);
    else t.push({ empresa_id: "emp-1", ...m });
    return this;
  }
  private executar(): Linha[] {
    const t = (tabelas[this.tabela] ??= []);
    if (this.nova) {
      t.push(this.nova);
      return [this.nova];
    }
    let linhas = t.filter((l) => this.filtros.every((f) => f(l)));
    if (this.mudanca) {
      for (const l of linhas) Object.assign(l, this.mudanca);
      return linhas;
    }
    for (const [c, asc] of [...this.ordem].reverse())
      linhas = [...linhas].sort((a, b) =>
        String(a[c]) < String(b[c])
          ? asc
            ? -1
            : 1
          : String(a[c]) > String(b[c])
            ? asc
              ? 1
              : -1
            : 0,
      );
    return linhas.slice(0, this.limite);
  }
  single() {
    return Promise.resolve({ data: this.executar()[0] ?? null, error: null });
  }
  maybeSingle() {
    return this.single();
  }
  then<A, B>(
    ok?: ((v: { data: unknown; error: null }) => A) | null,
    erro?: ((e: unknown) => B) | null,
  ) {
    return Promise.resolve({ data: this.executar(), error: null as null }).then(ok, erro);
  }
}

mock.module("@/lib/request-db.server", {
  namedExports: {
    bancoDaEmpresa: async () => ({ from: (t: string) => new Consulta(t) }),
    contextoEmpresa: () => ({ empresaId: "emp-1" }),
  },
});
mock.module("@/lib/os-media.server", {
  namedExports: {
    ensureMaterialsFolders: async () => ({ materials_folder_id: "pasta-cliente" }),
    ensureInternalFolder: async () => "pasta-interna",
  },
});
mock.module("@/lib/google-docs.server", {
  namedExports: {
    copyFile: async (modelo: string, nome: string, pasta: string) => {
      copiasDe.push(modelo);
      const id = novoArquivo(nome, pasta);
      return { id, webViewLink: `https://docs/${id}` };
    },
    createDocument: async (nome: string) => ({ documentId: novoArquivo(nome, "meu-drive") }),
    moveFile: async (id: string, pasta: string) => {
      const a = drive.get(id);
      if (!a) throw new Error("Modelo ou pasta não encontrado no Google.");
      a.parent = pasta;
    },
    renameFile: async (id: string, nome: string) => {
      drive.get(id)!.name = nome;
    },
    enviarParaLixeira: async (id: string) => {
      drive.get(id)!.trashed = true;
    },
    listarDocumentosDaPasta: async (pasta: string) =>
      [...drive.values()]
        .filter((a) => a.parent === pasta && !a.trashed)
        .map((a) => ({ ...a, mimeType: "application/vnd.google-apps.document" })),
    replacePlaceholders: async (_id: string, campos: Record<string, string>) => {
      preenchidos.push(campos);
      if (falharPreenchimento) throw new Error("Falha na comunicação com o Google (500).");
    },
    fillItemsTable: async () => undefined,
    stripRemainingPlaceholders: async () => undefined,
    writeBlocks: async () => undefined,
    docUrl: (id: string) => `https://docs/${id}`,
    getFile: async () => ({ mimeType: "application/vnd.google-apps.document" }),
    deleteFile: async () => undefined,
    extractGoogleId: (v: string) => v,
    findOrCreateFolder: async (nome: string, pai: string) => `${pai}/${nome}`,
    exportarPdf: async () => new Blob(["%PDF-1.4 teste"], { type: "application/pdf" }),
  },
});

const docs = await import("./os-docs.server");
type RegistroTeste = {
  template_type: string;
  generation_status: string;
  is_active: boolean;
  google_document_id: string | null;
};
const registros = () => tabelas["work_order_documents"] as RegistroTeste[];
const naPasta = (pasta: string) =>
  [...drive.values()]
    .filter((a) => a.parent === pasta && !a.trashed)
    .map((a) => a.name)
    .sort();
const base = "OS 1628 - Giulia Ramilo Assunção";

test("gerar de novo deixa um documento só na pasta do cliente", async () => {
  // Sobra de antes da correção: um documento sem registro na pasta do cliente.
  drive.set("perdido", {
    id: "perdido",
    name: base,
    parent: "pasta-cliente",
    createdTime: "2026-10-07T09:05:45Z",
    trashed: false,
  });
  const r1 = await docs.generateDocument("os-1", "novo", "u1");
  const r2 = await docs.generateDocument("os-1", "atualizar", "u1");
  assert.notEqual(r1.url, r2.url);
  assert.deepEqual(naPasta("pasta-cliente"), [base]);
  const internos = naPasta("pasta-interna");
  assert.equal(internos.length, 2);
  assert.ok(
    internos.every((n) => n.startsWith(`${base} (substituído em `)),
    internos.join(" | "),
  );
  const atual = await docs.loadDocument("os-1");
  assert.equal(atual?.url, r2.url);
  const regs = registros().filter((l) => l.template_type !== "Termo de garantia");
  assert.deepEqual(
    regs.map((l) => `${l.generation_status}|${l.is_active}`),
    ["Substituído|false", "Gerado|true"],
  );

  // Nova versão: troca e numera; a V1 também vai para o controle interno.
  const r3 = await docs.generateDocument("os-1", "versao", "u1");
  assert.equal(r3.name, `${base} - V2`);
  assert.deepEqual(naPasta("pasta-cliente"), [`${base} - V2`]);
  assert.equal(naPasta("pasta-interna").length, 3);
});

test("falha no meio: a cópia vai para a lixeira e o documento atual continua", async () => {
  const antes = naPasta("pasta-cliente");
  falharPreenchimento = true;
  await assert.rejects(docs.generateDocument("os-1", "atualizar", "u1"), /Google \(500\)/);
  falharPreenchimento = false;
  assert.deepEqual(naPasta("pasta-cliente"), antes);
  const erro = registros().at(-1)!;
  assert.equal(erro.generation_status, "Erro");
  assert.equal(erro.google_document_id, null);
  assert.equal((await docs.loadDocument("os-1"))?.status, "Gerado");
});

test("termo de garantia: um só na pasta do cliente", async () => {
  await docs.generateWarranty("os-1", "u1");
  await docs.generateWarranty("os-1", "u1");
  const termos = naPasta("pasta-cliente").filter((n) => n.startsWith("Termo"));
  assert.deepEqual(termos, [`Termo de garantia — ${base} - V2`]);
  assert.ok(
    naPasta("pasta-interna").some((n) => n.startsWith(`Termo de garantia — ${base} (substituído`)),
  );
  assert.equal(naPasta("pasta-cliente").filter((n) => n.startsWith("OS ")).length, 1);
});

test("termo de garantia sai da cópia do modelo da empresa, com os campos trocados", async () => {
  copiasDe.length = 0;
  preenchidos.length = 0;
  await docs.generateWarranty("os-1", "u1");
  assert.deepEqual(copiasDe, ["modelo-garantia"]);
  assert.deepEqual(preenchidos.at(-1), {
    NUMERO_OS: "1628",
    NOME_CLIENTE: "Giulia Ramilo Assunção",
    DATA_SERVICO: "07/10/2026",
    TECNICO: "Josué",
    ESTOFADOS: "Sofá",
    DATA_PROXIMA: "07/10/2027",
  });
});

test("salvar com campos em branco mantém os modelos já salvos", async () => {
  await docs.saveSettings({
    enabled: true,
    autoGenerate: true,
    nameTemplate: "",
    higienizacao: "",
    impermeabilizacao: "",
    combinado: "",
    garantia: "",
    pasta: "",
  });
  const s = await docs.readSettings();
  assert.equal(s.templateHigienizacao, "modelo-hig");
  assert.equal(s.templateGarantia, "modelo-garantia");
  assert.equal(s.folderId, "raiz");
});

test("empresa sem modelo do termo: avisa e não gera com texto de outra empresa", async () => {
  const cfg = tabelas["app_settings"]![0]!;
  const valor = cfg["value"] as Record<string, unknown>;
  cfg["value"] = { ...valor, templateGarantia: "" };
  const antes = registros().length;
  copiasDe.length = 0;
  await assert.rejects(
    docs.generateWarranty("os-1", "u1"),
    /Configure o modelo do termo de garantia/,
  );
  assert.equal(registros().length, antes);
  assert.equal(copiasDe.length, 0);
  const r = await docs.ensureOsDocuments("os-1", "u1");
  assert.equal(r.warranty, false);
  assert.ok(r.errors.some((e) => e.startsWith("Configure o modelo do termo de garantia")));
  cfg["value"] = valor;
});

test("proposta: documento da OS a partir do orçamento, sem OS, rascunho vira enviado", async () => {
  const antes = copiasDe.length;
  const r = await docs.generateProposal("orc-1");
  // Higienização e impermeabilização: modelo combinado, na pasta "Propostas".
  assert.equal(copiasDe.at(-1), "modelo-comb");
  assert.equal(copiasDe.length, antes + 1);
  assert.equal(r.tipo, "Higienização e Impermeabilização");
  assert.ok(r.nome.startsWith("Proposta - Diego Fictício - "), r.nome);
  const doc = [...drive.values()].find((a) => a.name === r.nome)!;
  assert.equal(doc.parent, "raiz/Propostas");
  const campos = preenchidos.at(-1)!;
  assert.equal(campos["NUMERO_OS"], "Proposta");
  assert.equal(campos["NOME_CLIENTE"], "Diego Fictício");
  assert.equal(campos["NUMERO_CLIENTE_TEXTO"], "nº 1682");
  assert.match(
    campos["RESUMO_VALOR"] ?? "",
    /^R\$\s?6\.959,00 em até 10x sem juros ou R\$\s?6\.611,05 à vista no Pix$/,
  );
  assert.ok(Buffer.from(r.pdfBase64, "base64").toString().startsWith("%PDF"));
  const q = tabelas["quotes"]![0]!;
  assert.equal(q["status"], "enviado");
  assert.equal(q["proposta_documento_id"], doc.id);
  assert.equal(q["generated_work_order_id"], null);
  assert.equal(registros().filter((l) => l.google_document_id === doc.id).length, 0);

  // Gerar de novo: a anterior vai para a lixeira; situação já "aprovado" não muda.
  q["status"] = "aprovado";
  const r2 = await docs.generateProposal("orc-1");
  assert.equal(drive.get(doc.id)!.trashed, true);
  assert.notEqual(r2.url, r.url);
  assert.equal(q["status"], "aprovado");
});

test("proposta: itens no formato da OS (mesmo item nos dois serviços numa linha; tapete em m²)", () => {
  const q = tabelas["quotes"]![0]! as unknown as Parameters<typeof docs.propostaComoOs>[0];
  const itens = tabelas["quote_items"] as unknown as Parameters<typeof docs.propostaComoOs>[1];
  const wo = docs.propostaComoOs(q, itens);
  assert.deepEqual(
    wo.visits.map((v) => v.service_type?.name),
    ["Higienização", "Impermeabilização"],
  );
  assert.equal(docs.templateTypeFor(wo.visits), "Higienização e Impermeabilização");
  const linhas = docs.buildItems(wo, true);
  assert.equal(linhas.length, 2);
  assert.equal(linhas[0]!.item, "Sofá 3 lugares");
  assert.match(linhas[0]!.valueHig, /400,00/);
  assert.match(linhas[0]!.valueImp, /800,00/);
  assert.equal(linhas[1]!.qty, "3,6 m²");
  assert.equal(linhas[1]!.valueImp, "—");
  // Só higienização: R$ cheio sem parcelas.
  assert.match(
    docs.resumoProposta({ ...q, parcelas: 1, valor_a_vista: null, valor_pix: null, total: 300 }),
    /^R\$\s?300,00$/,
  );
});

// ---------- PDF direto no app (dados fictícios) ----------

/** O real formatado usa espaço inseparável depois do "R$". */
const semNbsp = <T>(v: T): T => JSON.parse(JSON.stringify(v).replace(/\u00a0/g, " ")) as T;

const visitaPdf = (
  servico: string,
  status: string,
  itens: Array<[string, number, number, string]>,
) => ({
  status,
  scheduled_date: "2026-08-31",
  completion_date: status === "Concluído" ? "2026-08-31" : null,
  visit_value: 0,
  final_value: null,
  item_quantity: 1,
  upholstery_description: null,
  service_type: { name: servico },
  upholstery_type: null,
  technician: { name: "Técnico Fictício" },
  service_items: itens.map(([nome, qtd, preco, grupo], i) => ({
    description: nome,
    quantity: qtd,
    unidade: null,
    unit_price: preco,
    subtotal: qtd * preco,
    item_group_id: grupo,
    display_order: i,
    active: true,
    upholstery_type: null,
  })),
});

tabelas["work_orders"]!.push(
  {
    id: "os-pdf-comb",
    os_number: "9001",
    updated_at: "2026-08-30T12:00:00Z",
    total_gross_value: 1040,
    os_value_text: null,
    negotiated_payment_method: "Cartão de crédito",
    negotiated_installments: 10,
    customer: { full_name: "Cliente Fictício PDF", phone: "5511900009001" },
    visits: [
      visitaPdf("Higienização", "Agendado", [
        ["Sofá 3 lugares", 1, 280, "g1"],
        ["Cadeira", 4, 40, "g2"],
      ]),
      visitaPdf("Impermeabilização", "Agendado", [["Sofá 3 lugares", 1, 560, "g1"]]),
    ],
  },
  {
    id: "os-pdf-hig",
    os_number: "9002",
    updated_at: "2026-08-30T12:00:00Z",
    total_gross_value: 280,
    os_value_text: null,
    negotiated_payment_method: "Pix",
    negotiated_installments: 1,
    customer: { full_name: "Outro Fictício", phone: null },
    visits: [visitaPdf("Higienização", "Concluído", [["Sofá 3 lugares", 1, 280, "g1"]])],
  },
);

test("PDF no app: OS combinada com as duas colunas, valor e pagamento do documento do Drive", async () => {
  const d = await docs.dadosOsPdf("os-pdf-comb");
  assert.equal(d.numero, "9001");
  assert.equal(d.clienteTexto, "nº 9001");
  assert.equal(d.temHig, true);
  assert.equal(d.temImp, true);
  assert.deepEqual(semNbsp(d.linhas), [
    { item: "Sofá 3 lugares", qtd: "1", hig: "R$ 280,00", imp: "R$ 560,00" },
    { item: "Cadeira", qtd: "4", hig: "R$ 40,00/cada", imp: "—" },
  ]);
  assert.match(d.valorTotal, /R\$\s1\.040,00 em até 10x sem juros/);
  assert.equal(d.formaPagamento, "Cartão de crédito");
});

test("PDF no app: só higienização não tem coluna nem garantia", async () => {
  const d = await docs.dadosOsPdf("os-pdf-hig");
  assert.equal(d.temImp, false);
  assert.equal(d.clienteTexto, "");
  assert.deepEqual(semNbsp(d.linhas), [
    { item: "Sofá 3 lugares", qtd: "1", hig: "R$ 280,00", imp: "—" },
  ]);
  assert.equal(await docs.dadosTermoPdf("os-pdf-hig", 12), null);
});

test("PDF no app: termo só depois da impermeabilização concluída, próxima pelos meses", async () => {
  assert.equal(await docs.dadosTermoPdf("os-pdf-comb", 12), null, "visita ainda agendada");
  const os = tabelas["work_orders"]!.find((o) => o["id"] === "os-pdf-comb")!;
  const imp = (os["visits"] as Array<Record<string, unknown>>)[1]!;
  imp["status"] = "Concluído";
  imp["completion_date"] = "2026-08-31";
  const t = await docs.dadosTermoPdf("os-pdf-comb", 6);
  assert.deepEqual(t, {
    numero: "9001",
    cliente: "Cliente Fictício PDF",
    dataServico: "31/08/2026",
    tecnico: "Técnico Fictício",
    estofados: "Sofá 3 lugares",
    proxima: "28/02/2027",
  });
  assert.equal(docs.somarMeses("2026-10-07", 12), "07/10/2027");
  assert.equal(docs.somarMeses("2027-12-15", 1), "15/01/2028");
});

// ---------- modo dos documentos decidido no servidor (botão "Gerar documento") ----------

test("modo PDF: o pedido de documento pelo Drive é recusado sem chamar o Google", async () => {
  const configs = tabelas["app_settings"]!;
  configs.push({ empresa_id: "emp-1", key: "documentos", value: { modo: "pdf" } });
  copiasDe.length = 0;
  try {
    assert.equal((await docs.situacaoDocumentos()).decisao, "pdf");
    await assert.rejects(docs.garantirDocumentoPeloDrive(), /PDF direto no app/);
    assert.equal(copiasDe.length, 0, "nenhuma cópia de modelo no Drive");
  } finally {
    configs.splice(
      configs.findIndex((c) => c["key"] === "documentos"),
      1,
    );
  }
});

test("modo Drive com a integração desligada: aviso (sem gerar); ligada: libera", async () => {
  const drive = tabelas["app_settings"]!.find((c) => c["key"] === "os_document_settings")!;
  const valor = drive["value"] as Record<string, unknown>;
  valor["enabled"] = false;
  try {
    const sit = await docs.situacaoDocumentos();
    assert.equal(sit.modo, "drive");
    assert.equal(sit.decisao, "drive_desligado");
    await assert.rejects(docs.garantirDocumentoPeloDrive(), /Drive desligados/);
  } finally {
    valor["enabled"] = true;
  }
  assert.equal((await docs.garantirDocumentoPeloDrive()).decisao, "drive");
});
