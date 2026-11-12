import { test } from "node:test";
import assert from "node:assert/strict";
import type { MensagemLead } from "./fatos";
import {
  blocoDaConversa,
  limparResumo,
  mensagensParaLer,
  modoDeLeitura,
  ultimaMensagemEm,
} from "./resumo-dia";

const agora = new Date("2026-11-12T23:30:00Z");
const m = (em: string, texto = "oi"): MensagemLead => ({
  direcao: "entrada",
  remetente: "contact",
  tipo: "Texto",
  texto,
  transcricao: null,
  em,
});

test("modo de leitura: completa na primeira vez e a cada 7 dias; senão incremental", () => {
  assert.equal(modoDeLeitura(null, agora), "completa");
  assert.equal(
    modoDeLeitura(
      {
        resumo_dia: " ",
        resumo_ate: "2026-11-11T12:00:00Z",
        leitura_completa_em: "2026-11-11T23:00:00Z",
      },
      agora,
    ),
    "completa",
  );
  assert.equal(
    modoDeLeitura(
      { resumo_dia: "Quer sofá.", resumo_ate: null, leitura_completa_em: "2026-11-11T23:00:00Z" },
      agora,
    ),
    "completa",
  );
  const ficha = (completa: string) => ({
    resumo_dia: "Quer sofá; achou caro.",
    resumo_ate: "2026-11-11T12:00:00Z",
    leitura_completa_em: completa,
  });
  assert.equal(modoDeLeitura(ficha("2026-11-11T23:30:00Z"), agora), "incremental");
  assert.equal(modoDeLeitura(ficha("2026-11-06T02:00:00Z"), agora), "incremental");
  // A noite não começa sempre no mesmo minuto: 7 dias menos até 2 horas já contam.
  assert.equal(modoDeLeitura(ficha("2026-11-06T00:00:00Z"), agora), "completa");
  assert.equal(modoDeLeitura(ficha("2026-11-05T23:30:00Z"), agora), "completa");
  assert.equal(modoDeLeitura(ficha("data ruim"), agora), "completa");
});

test("fim da conversa: tudo o que é novo e, no mínimo, as últimas 12 mensagens", () => {
  const msgs = Array.from({ length: 30 }, (_, i) =>
    m(`2026-11-${String(1 + Math.floor(i / 3)).padStart(2, "0")}T1${i % 3}:00:00Z`, `m${i}`),
  );
  // Resumo cobre até o dia 09 inteiro: novas são as do dia 10 (3 mensagens) → manda as últimas 12.
  const poucas = mensagensParaLer(msgs, "2026-11-09T23:00:00Z");
  assert.equal(poucas.length, 12);
  assert.equal(poucas.at(-1)!.texto, "m29");
  assert.equal(poucas[0]!.texto, "m18");
  // Resumo antigo (até o dia 03): 21 novas → manda todas as novas.
  const muitas = mensagensParaLer(msgs, "2026-11-03T23:00:00Z");
  assert.equal(muitas.length, 21);
  assert.equal(muitas[0]!.texto, "m9");
  // Conversa curta: manda o que tem.
  assert.equal(mensagensParaLer(msgs.slice(0, 5), "2026-11-09T23:00:00Z").length, 5);
  assert.equal(ultimaMensagemEm(msgs), "2026-11-10T12:00:00Z");
  assert.equal(ultimaMensagemEm([]), null);
});

test("bloco da conversa e limpeza do resumo", () => {
  assert.deepEqual(
    blocoDaConversa({
      modo: "completa",
      resumo: "x",
      resumoAte: "2026-11-10T00:00:00Z",
      conversa: "",
    }),
    ["CONVERSA:", "(sem mensagens)"],
  );
  const inc = blocoDaConversa({
    modo: "incremental",
    resumo: "Quer sofá; achou caro.",
    resumoAte: "2026-11-10T12:00:00Z",
    conversa: "Cliente: oi",
  });
  assert.equal(inc[0], "RESUMO DO QUE JÁ FOI LIDO (até 2026-11-10):");
  assert.equal(inc[1], "Quer sofá; achou caro.");
  assert.match(inc[3]!, /só o fim/);
  assert.equal(inc[4], "Cliente: oi");
  // Sem resumo guardado, mesmo pedindo incremental, vai a conversa inteira.
  assert.equal(
    blocoDaConversa({ modo: "incremental", resumo: null, resumoAte: null, conversa: "c" })[0],
    "CONVERSA:",
  );
  assert.equal(limparResumo("  a\r\n\n\n\nb  "), "a\n\nb");
  assert.equal(limparResumo(null), "");
  assert.equal(limparResumo("x".repeat(3000)).length, 1500);
});
