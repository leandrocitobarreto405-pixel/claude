// Temperatura: o que a leitura de contexto grava no lead.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classeParaGravar } from "./temperatura.server";

test("classe aguardando não vai para o banco (a trava não aceita); as outras vão", () => {
  assert.deepEqual(classeParaGravar("aguardando"), {});
  assert.deepEqual(classeParaGravar("fechou_outra"), { contexto_classe: "fechou_outra" });
  assert.deepEqual(classeParaGravar("segue"), { contexto_classe: "segue" });
});
