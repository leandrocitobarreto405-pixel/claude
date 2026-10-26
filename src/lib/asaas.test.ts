import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ambienteAsaas,
  baseUrlAsaas,
  competenciaDoMes,
  descricaoFatura,
  lerAvisoAsaas,
  motivoSemFatura,
} from "./asaas";

test("sandbox é o padrão", () => {
  assert.equal(ambienteAsaas(undefined), "sandbox");
  assert.equal(ambienteAsaas("qualquer"), "sandbox");
  assert.equal(ambienteAsaas(" Producao "), "producao");
  assert.equal(baseUrlAsaas("sandbox"), "https://api-sandbox.asaas.com/v3");
  assert.equal(baseUrlAsaas("producao"), "https://api.asaas.com/v3");
});

test("aviso do Asaas: id do evento, tipo e cobrança", () => {
  assert.deepEqual(
    lerAvisoAsaas({ id: "evt_1", event: "PAYMENT_RECEIVED", payment: { id: "pay_1" } }),
    { eventoId: "evt_1", evento: "PAYMENT_RECEIVED", cobrancaId: "pay_1" },
  );
  // Sem id do evento: a mesma combinação gera o mesmo id (aviso repetido conta uma vez).
  const sem = {
    event: "PAYMENT_OVERDUE",
    dateCreated: "2026-11-11",
    payment: { id: "pay_2", status: "OVERDUE" },
  };
  assert.equal(lerAvisoAsaas(sem)?.eventoId, "PAYMENT_OVERDUE:pay_2:OVERDUE:2026-11-11");
  assert.equal(lerAvisoAsaas(sem)?.eventoId, lerAvisoAsaas({ ...sem })?.eventoId);
  assert.equal(lerAvisoAsaas({ event: "INVOICE_CREATED", payment: { id: "x" } }), null);
  assert.equal(lerAvisoAsaas({ event: "PAYMENT_RECEIVED" }), null);
  assert.equal(lerAvisoAsaas("lixo"), null);
});

test("competência e descrição da fatura", () => {
  assert.equal(competenciaDoMes("2026-11"), "2026-11-01");
  assert.equal(competenciaDoMes("2026-13"), null);
  assert.equal(competenciaDoMes("11/2026"), null);
  assert.equal(descricaoFatura("Básico", "2026-11-01"), "Nexa OS · Básico · 11/2026");
});

test("sem mensalidade não gera fatura", () => {
  assert.match(motivoSemFatura(null, "trial")!, /não gera fatura/);
  assert.match(motivoSemFatura(0, "ativa")!, /não gera fatura/);
  assert.match(motivoSemFatura(247, "ativa", true)!, /isenta de cobrança/);
  assert.equal(motivoSemFatura(247, "ativa", false), null);
  assert.equal(motivoSemFatura(297, "cancelada"), "Assinatura cancelada.");
  assert.equal(motivoSemFatura(50, null), "Empresa sem assinatura.");
  assert.equal(motivoSemFatura(50, "ativa"), null);
});
