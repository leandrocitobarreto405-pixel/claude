import { test } from "node:test";
import assert from "node:assert/strict";
import { precoLiberado, temPreco } from "./preco-depois";
import type { MensagemHistorico } from "./prompt";

const msg = (direcao: "Recebida" | "Enviada", texto: string, remetente = "agent_bot") =>
  ({ direcao, texto, tipo: "Texto", remetente, imagens: [] }) as MensagemHistorico;

test("preço travado na primeira resposta, mesmo com o cliente pedindo tudo de uma vez", () => {
  assert.equal(
    precoLiberado([msg("Recebida", "Quanto fica um colchão queen? CEP 01234-000, cupom TESTE50")]),
    false,
  );
});

test("preço travado se a Alice não perguntou nada ou o cliente ainda não respondeu", () => {
  assert.equal(
    precoLiberado([msg("Recebida", "Oi"), msg("Enviada", "Oi! Aqui é a Alice 💙")]),
    false,
  );
  assert.equal(
    precoLiberado([msg("Recebida", "Oi"), msg("Enviada", "Oi! O que te incomoda no colchão?")]),
    false,
  );
});

test("preço liberado depois que o cliente responde uma pergunta (da Alice ou da equipe)", () => {
  assert.equal(
    precoLiberado([
      msg("Recebida", "Oi, quanto custa?"),
      msg("Enviada", "Oi! Aqui é a Alice 💙\nO que te incomoda no colchão?"),
      msg("Recebida", "manchas"),
    ]),
    true,
  );
  assert.equal(
    precoLiberado([
      msg("Recebida", "Oi"),
      msg("Enviada", "Você usa os dois lados do colchão?", "user"),
      msg("Recebida", "só um"),
    ]),
    true,
  );
});

test("conversa longa (histórico cortado) não trava", () => {
  assert.equal(precoLiberado([msg("Recebida", "e o horário?")], true), true);
});

test("texto com preço", () => {
  assert.equal(temPreco("• Colchão queen — R$ 289,90"), true);
  assert.equal(temPreco("Total: R$289,90"), true);
  assert.equal(temPreco("O valor depende do tamanho, me manda uma foto?"), false);
});
