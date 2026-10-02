import { test } from "node:test";
import assert from "node:assert/strict";
import { grupoDaConversa, haQuanto, iniciais, textoDaMensagem, ultimaPassagem } from "./conversas";

test("grupoDaConversa pelo status do Chatwoot", () => {
  assert.equal(grupoDaConversa("pending", null), "alice");
  assert.equal(grupoDaConversa("open", "2026-10-02T10:00:00Z"), "precisam");
  assert.equal(grupoDaConversa("open", null), "equipe");
  assert.equal(grupoDaConversa("snoozed", null), "equipe");
  assert.equal(grupoDaConversa("resolved", "2026-10-02T10:00:00Z"), "finalizadas");
});

test("haQuanto", () => {
  const agora = new Date("2026-10-02T15:00:00Z");
  assert.equal(haQuanto("2026-10-02T14:59:40Z", agora), "agora");
  assert.equal(haQuanto("2026-10-02T14:56:00Z", agora), "há 4 min");
  assert.equal(haQuanto("2026-10-02T12:30:00Z", agora), "há 2 h");
  assert.equal(haQuanto("2026-10-01T12:00:00Z", agora), "ontem");
  assert.equal(haQuanto("2026-09-12T12:00:00Z", agora), "12/09");
  assert.equal(haQuanto(null, agora), "");
});

test("iniciais", () => {
  assert.equal(iniciais("Fernanda Lima"), "FL");
  assert.equal(iniciais("Roberto de Souza"), "RS");
  assert.equal(iniciais("Ana"), "AN");
  assert.equal(iniciais("+55 11 99999-0000"), "");
  assert.equal(iniciais("Érica  Ávila"), "ÉÁ");
});

test("textoDaMensagem", () => {
  assert.equal(textoDaMensagem("  Oi! ", "Texto"), "Oi!");
  assert.equal(textoDaMensagem(null, "Imagem"), "(foto)");
  assert.equal(textoDaMensagem("", "Áudio"), "(áudio)");
  assert.equal(textoDaMensagem(null, null), "(mídia)");
});

test("ultimaPassagem pega a mais nova com transferência", () => {
  const p = ultimaPassagem([
    { ferramentas: [{ nome: "consultar_cliente", entrada: {} }] },
    {
      ferramentas: [
        {
          nome: "transferir_para_humano",
          entrada: { motivo: "Reclamação", resumo: "Mancha no colchão", problema_pos_venda: true },
        },
      ],
    },
    { ferramentas: [{ nome: "transferir_para_humano", entrada: { motivo: "Antiga" } }] },
  ]);
  assert.deepEqual(p, { motivo: "Reclamação", resumo: "Mancha no colchão", posVenda: true });
  assert.equal(ultimaPassagem([{ ferramentas: "x" }, { ferramentas: [] }]), null);
  assert.equal(
    ultimaPassagem([{ ferramentas: [{ nome: "passar_para_atendente" }] }])?.motivo,
    "Passada pela Alice",
  );
});
