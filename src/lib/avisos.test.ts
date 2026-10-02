import { test } from "node:test";
import assert from "node:assert/strict";
import { montarAvisos, temAvisoImportante, type FontesDeAvisos } from "./avisos";

const fontes: FontesDeAvisos = {
  conversasEsperando: [
    {
      id: "c1",
      nome: "Fernanda",
      desde: "2026-10-02T10:00:00Z",
      motivo: "Negociação",
      posVenda: false,
    },
    {
      id: "c2",
      nome: "Roberto",
      desde: "2026-10-02T09:50:00Z",
      motivo: "Reclamação",
      posVenda: true,
    },
  ],
  marketing: [
    {
      id: "m1",
      tipo: "campanha",
      titulo: "Campanha pronta",
      mensagem: "Aprovar",
      criadoEm: "2026-10-02T08:00:00Z",
      lidoEm: null,
    },
    {
      id: "m2",
      tipo: "pausa_automatica",
      titulo: "Pausa",
      mensagem: "Muitas saídas",
      criadoEm: "2026-10-01T08:00:00Z",
      lidoEm: "2026-10-01T09:00:00Z",
    },
  ],
  atrasados: 2,
  semTecnico: 1,
  reagendados: [{ id: "v1", cliente: "Ana", data: "2026-10-03", hora: "14:00:00" }],
  pagamentosPendentes: 3,
};

test("escritório vê tudo, do mais urgente para o menos", () => {
  const a = montarAvisos(fontes, "admin");
  assert.equal(a.length, 8);
  assert.equal(a[0]!.id, "conversa-c2"); // pós-venda primeiro
  assert.equal(a[0]!.tom, "problema");
  assert.deepEqual(a[0]!.link, { to: "/conversas/$conversaId", params: { conversaId: "c2" } });
  // Avisos de atenção antes dos neutros.
  const tons = a.map((x) => x.tom);
  assert.ok(tons.lastIndexOf("atencao") < tons.indexOf("neutro"));
  assert.equal(a.find((x) => x.id === "atrasados")!.titulo, "2 serviços atrasados sem conclusão");
  assert.equal(a.find((x) => x.id === "sem-tecnico")!.titulo, "1 serviço sem técnico");
  assert.equal(
    a.find((x) => x.id === "reagendado-v1")!.texto,
    "Novo horário: 03/10/2026 às 14:00.",
  );
});

test("técnico só recebe avisos da operação", () => {
  const a = montarAvisos(fontes, "tecnico");
  assert.deepEqual(a.map((x) => x.id).sort(), ["atrasados", "reagendado-v1", "sem-tecnico"]);
  assert.ok(a.every((x) => !x.escritorio));
});

test("sem nada pendente, lista vazia e sem ponto na aba", () => {
  const vazio: FontesDeAvisos = {
    conversasEsperando: [],
    marketing: [],
    atrasados: 0,
    semTecnico: 0,
    reagendados: [],
    pagamentosPendentes: 0,
  };
  assert.deepEqual(montarAvisos(vazio, "admin"), []);
  assert.equal(temAvisoImportante([]), false);
  assert.equal(temAvisoImportante(montarAvisos(fontes, "admin")), true);
  // Só neutros já lidos: sem ponto.
  assert.equal(
    temAvisoImportante(montarAvisos({ ...vazio, pagamentosPendentes: 2 }, "admin")),
    false,
  );
});
