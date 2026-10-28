import { test } from "node:test";
import assert from "node:assert/strict";
import { clienteEsperando, instrucaoDemora, notaDevolucao, notaRetomada } from "./devolucao";

test("responde na hora só se a última mensagem (sem notas) é do cliente", () => {
  assert.equal(clienteEsperando({ direction: "Recebida" }), true);
  assert.equal(clienteEsperando({ direction: "Enviada" }), false);
  assert.equal(clienteEsperando(null), false);
});

test("notas da devolução", () => {
  assert.equal(
    notaDevolucao("Alice", true, "pelo Nexa OS"),
    "🤖 Conversa devolvida para a Alice pelo Nexa OS. Ela vai responder agora.",
  );
  assert.equal(
    notaDevolucao("Alice", false),
    "🤖 Conversa devolvida para a Alice. Ela responde a próxima mensagem do cliente.",
  );
  assert.match(notaRetomada("Alice"), /retomou esta conversa.*vai responder agora/);
});

test("desculpa pela demora só depois de 10 minutos, sem falar de erro técnico", () => {
  const agora = new Date("2026-10-28T13:30:00Z");
  assert.equal(instrucaoDemora("2026-10-28T13:25:00Z", agora), null);
  assert.equal(instrucaoDemora(null, agora), null);
  const t = instrucaoDemora("2026-10-28T10:11:00Z", agora)!;
  assert.match(t, /há 3 h 19 min/);
  assert.match(t, /desculpa curto e natural pela demora/);
  assert.match(t, /sem falar de erro, sistema, problema técnico ou pausa/);
  assert.match(instrucaoDemora("2026-10-28T13:15:00Z", agora)!, /há 15 min/);
});
