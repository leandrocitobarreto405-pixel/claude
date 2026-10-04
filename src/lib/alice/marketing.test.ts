import { test } from "node:test";
import assert from "node:assert/strict";
import { textoMarketing, type Marketing } from "./marketing.server";

const envio = (gatilho: string | null, botao: string | null): Marketing => ({
  contato: null,
  envio: {
    grupo: gatilho === "C3" ? "C3" : "C4",
    template_nome: "tc_imper_13meses",
    enviado_em: "2026-10-04T13:00:00Z",
    botao_clicado: botao,
    campanha: {
      nome: gatilho ? `Gatilho ${gatilho}` : "Primavera",
      tema: null,
      tipo: gatilho ? "gatilho" : "calendario",
      gatilho,
      condicao_texto: null,
      condicao_pct: null,
      datas_disparo: [],
    },
  },
  condicaoValidaAte: null,
  indicadoPor: null,
  linkAvaliacao: null,
});

test("lembrete do 13º mês: a Alice sabe o que é e vê o botão clicado", () => {
  const t = textoMarketing(envio("C3", "quero renovar")).join("\n");
  assert.match(t, /lembrete do 13º mês da impermeabilização/);
  assert.match(t, /regra do 13º mês/);
  assert.match(t, /botão clicado: "quero renovar"/);
  assert.doesNotMatch(t, /mensagem automática C3\b/);
  assert.match(t, /sem condição cadastrada: siga as suas instruções/);
  assert.doesNotMatch(t, /Campanha sem condição especial/);
});

test("lembrete de 6 meses e campanha sem condição", () => {
  assert.match(textoMarketing(envio("C2", null)).join("\n"), /lembrete de 6 meses da higienização/);
  const camp = textoMarketing(envio(null, "quero aproveitar")).join("\n");
  assert.match(camp, /campanha "Primavera"/);
  assert.match(camp, /Campanha sem condição especial/);
});
