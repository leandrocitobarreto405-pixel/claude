import { test } from "node:test";
import assert from "node:assert/strict";
import { resumirAlice, taxa, valorOsVendida } from "./alice-metricas";

const ex = (lead: string, conversa: string, custo: number, msgs: number) => ({
  crm_lead_id: lead,
  conversa_id: conversa,
  custo_usd: custo,
  mensagens_enviadas: Array.from({ length: msgs }, (_, i) => `m${i}`),
});

test("métricas da Alice: atendidos só com mensagem enviada, custo de todas as execuções", () => {
  const m = resumirAlice(
    [
      ex("L1", "C1", 0.1, 2),
      ex("L1", "C1", 0.05, 0),
      ex("L2", "C2", 0.2, 1),
      ex("L3", "C3", 0.05, 0),
    ],
    [
      { id: "L1", orcamento_em: "2026-10-01", os_criada_em: "2026-10-02", valor_os: 500 },
      { id: "L2", orcamento_em: "2026-10-03", os_criada_em: null, valor_os: null },
      // L3 não recebeu mensagem: não entra mesmo com OS.
      { id: "L3", orcamento_em: "2026-10-03", os_criada_em: "2026-10-04", valor_os: 900 },
    ],
  );
  assert.equal(m.execucoes, 4);
  assert.equal(m.conversas, 3);
  assert.equal(m.mensagens, 3);
  assert.equal(m.leadsAtendidos, 2);
  assert.equal(m.chegaramOrcamento, 2);
  assert.equal(m.vendidos, 1);
  assert.equal(m.valorVendido, 500);
  assert.equal(m.custoUsd, 0.4);
  assert.equal(m.custoPorConversaUsd, 0.1333);
  assert.equal(m.custoPorMensagemUsd, 0.1333);
});

test("métricas da Alice: OS de teste, cancelada ou excluída não conta como venda", () => {
  const base = { total_gross_value: 300, eh_teste: false, cancelled_at: null, deleted_at: null };
  assert.equal(valorOsVendida(base), 300);
  assert.equal(valorOsVendida({ ...base, eh_teste: true }), null);
  assert.equal(valorOsVendida({ ...base, cancelled_at: "2026-10-01" }), null);
  assert.equal(valorOsVendida({ ...base, deleted_at: "2026-10-01" }), null);
  assert.equal(valorOsVendida(null), null);
  assert.equal(valorOsVendida({ ...base, visits: [{ repasse_parceiro: 120 }] }), 180);
  const m = resumirAlice(
    [ex("L1", "C1", 0.1, 1)],
    [{ id: "L1", orcamento_em: null, os_criada_em: "2026-10-02", valor_os: null }],
  );
  assert.equal(m.vendidos, 0);
});

test("métricas da Alice: sem execuções não divide por zero", () => {
  const m = resumirAlice([], []);
  assert.equal(m.custoPorConversaUsd, 0);
  assert.equal(m.custoPorMensagemUsd, 0);
  assert.equal(taxa(1, 0), "—");
  assert.equal(taxa(1, 3), "33%");
});
