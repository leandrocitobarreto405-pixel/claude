// Documento da OS e termo de garantia: a pasta do cliente fica com um documento só; os anteriores
// vão para o "Controle interno". Banco e Google simulados.
import { mock, test } from "node:test";
import assert from "node:assert/strict";

let relogio = Date.parse("2026-10-07T12:00:00Z");
const agora = () => new Date((relogio += 1000)).toISOString();

type Arquivo = { id: string; name: string; parent: string; createdTime: string; trashed: boolean };
const drive = new Map<string, Arquivo>();
let falharPreenchimento = false;
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
        folderId: "raiz",
      },
    },
  ],
  empresas: [],
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
  upsert() {
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
    copyFile: async (_modelo: string, nome: string, pasta: string) => {
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
    replacePlaceholders: async () => {
      if (falharPreenchimento) throw new Error("Falha na comunicação com o Google (500).");
    },
    fillItemsTable: async () => undefined,
    stripRemainingPlaceholders: async () => undefined,
    writeBlocks: async () => undefined,
    docUrl: (id: string) => `https://docs/${id}`,
    getFile: async () => ({}),
    deleteFile: async () => undefined,
    extractGoogleId: (v: string) => v,
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
