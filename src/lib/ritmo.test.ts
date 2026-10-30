import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { esperaPara, fatorAtual, registrarResposta, zerarRitmo } from "./ritmo";
import { recargaComFreio } from "./conversas-tempo-real";

test("ritmo: banco lento dobra a espera até 1 min; rápido volta ao normal", () => {
  zerarRitmo();
  assert.equal(esperaPara(30_000), 30_000);
  registrarResposta(5_000, false);
  assert.equal(esperaPara(30_000), 60_000);
  registrarResposta(200, true);
  registrarResposta(200, true);
  assert.equal(esperaPara(30_000), 60_000);
  assert.equal(esperaPara(3_000), 24_000);
  // Intervalo-base acima de 1 min fica como está.
  assert.equal(esperaPara(120_000), 120_000);
  // Respostas rápidas: volta aos poucos.
  for (let i = 0; i < 6; i++) registrarResposta(100, false);
  assert.equal(fatorAtual(), 1);
  assert.equal(esperaPara(3_000), 3_000);
  // Resposta média (entre 1 e 3 s) não mexe.
  registrarResposta(2_000, false);
  assert.equal(fatorAtual(), 1);
});

test("tempo real: rajada vira uma recarga; não repete com a anterior em andamento", () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  try {
    let recargas = 0;
    let ocupado = false;
    let visivel = true;
    const f = recargaComFreio({
      recarregar: () => recargas++,
      ocupado: () => ocupado,
      visivel: () => visivel,
      minimo: () => 3_000,
    });
    for (let i = 0; i < 20; i++) f.avisar();
    mock.timers.tick(300);
    assert.equal(recargas, 1);
    // Avisos logo depois: só uma recarga quando passarem 3 s.
    f.avisar();
    f.avisar();
    mock.timers.tick(1_500);
    assert.equal(recargas, 1);
    mock.timers.tick(2_000);
    assert.equal(recargas, 2);
    // Recarga anterior ainda em andamento: espera.
    ocupado = true;
    f.avisar();
    mock.timers.tick(10_000);
    assert.equal(recargas, 2);
    ocupado = false;
    mock.timers.tick(1_000);
    assert.equal(recargas, 3);
    // Aba escondida: nada; ao voltar, recarrega o pendente.
    visivel = false;
    f.avisar();
    mock.timers.tick(10_000);
    assert.equal(recargas, 3);
    visivel = true;
    f.voltou();
    mock.timers.tick(300);
    assert.equal(recargas, 4);
    f.parar();
  } finally {
    mock.timers.reset();
  }
});
