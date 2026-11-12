import { test } from "node:test";
import assert from "node:assert/strict";
import {
  causaForaDoAr,
  conversasSemResposta,
  referenciaDoAviso,
  textoForaDoAr,
} from "./fora-do-ar";

const agora = new Date("2026-11-12T17:30:00Z");
const t = (conversa_id: string, situacao: string, created_at: string, executar_apos?: string) => ({
  conversa_id,
  situacao,
  created_at,
  executar_apos: executar_apos ?? created_at,
});

test("sem resposta: última tarefa com erro ou parada na fila há mais de 10 minutos", () => {
  const r = conversasSemResposta(
    [
      t("erro", "erro", "2026-11-12T17:05:00Z"),
      t("fila", "pendente", "2026-11-12T17:12:00Z"),
      t("travada", "processando", "2026-11-12T17:00:00Z"),
      // Respondida depois de um erro: vale a última.
      t("ok", "erro", "2026-11-12T16:50:00Z"),
      t("ok", "concluida", "2026-11-12T16:55:00Z"),
      // Na fila há 4 minutos, ou com hora marcada para depois: normal.
      t("recente", "pendente", "2026-11-12T17:26:00Z"),
      t("agendada", "pendente", "2026-11-12T17:00:00Z", "2026-11-12T17:45:00Z"),
      // Erro de agora há pouco: ainda dentro da tolerância.
      t("erro-novo", "erro", "2026-11-12T17:25:00Z"),
      t("ignorada", "ignorada", "2026-11-12T17:00:00Z"),
    ],
    agora,
  );
  assert.deepEqual(r, [
    { conversaId: "travada", desde: "2026-11-12T17:00:00Z" },
    { conversaId: "erro", desde: "2026-11-12T17:05:00Z" },
    { conversaId: "fila", desde: "2026-11-12T17:12:00Z" },
  ]);
  assert.deepEqual(conversasSemResposta([], agora), []);
});

test("causa e texto do push", () => {
  assert.equal(causaForaDoAr({ parada: "credito", ligada: true }), "credito");
  assert.equal(causaForaDoAr({ parada: "autenticacao", ligada: false }), "autenticacao");
  assert.equal(causaForaDoAr({ parada: null, ligada: false }), "desligada");
  assert.equal(causaForaDoAr({ parada: null, ligada: true }), "fila");
  assert.deepEqual(textoForaDoAr({ causa: "credito", esperando: 2, minutos: 14, comAEquipe: 3 }), {
    titulo: "🔴 Alice fora do ar: 5 clientes esperando",
    corpo:
      "A conta da IA está sem crédito. 2 clientes estão sem resposta (o mais antigo há 14 min). 3 conversas foram para a equipe.",
  });
  assert.deepEqual(textoForaDoAr({ causa: "fila", esperando: 1, minutos: 11, comAEquipe: 0 }), {
    titulo: "🔴 Alice fora do ar: 1 cliente esperando",
    corpo:
      "A Alice não está respondendo (erro ou fila parada). 1 cliente está sem resposta (o mais antigo há 11 min).",
  });
  assert.match(
    textoForaDoAr({ causa: "desligada", esperando: 0, minutos: 0, comAEquipe: 1 }).corpo,
    /^A Alice está desligada nas Configurações\. 1 conversa foi para a equipe\.$/,
  );
});

test("referência: uma a cada 15 minutos de dia, uma por hora de noite", () => {
  // 14h31 em São Paulo.
  const a = referenciaDoAviso(new Date("2026-11-12T17:31:00Z"));
  assert.equal(a, referenciaDoAviso(new Date("2026-11-12T17:44:00Z")));
  assert.notEqual(a, referenciaDoAviso(new Date("2026-11-12T17:46:00Z")));
  // 2h05 em São Paulo.
  const n = referenciaDoAviso(new Date("2026-11-12T05:05:00Z"));
  assert.equal(n, referenciaDoAviso(new Date("2026-11-12T05:50:00Z")));
  assert.notEqual(n, referenciaDoAviso(new Date("2026-11-12T06:05:00Z")));
});
