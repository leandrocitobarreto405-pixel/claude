import { test } from "node:test";
import assert from "node:assert/strict";
import { esperaDeVerdade, mensagemDeEncerramento } from "./conversas-espera";

test("encerramento: combinado, ok, obrigado, emoji, até lá", () => {
  for (const t of [
    "Combinado",
    "ok",
    "Okkk obrigada",
    "Obrigada!",
    "muito obrigado pela atenção",
    "👍",
    "🙏🏽❤️",
    "Beleza, até lá",
    "Perfeito",
    "tá bom",
    "Ta bom obrigada",
    "Ótimo, obrigado!",
    "valeu",
    "Certo, aguardo",
    "Obg, bom dia",
  ])
    assert.equal(mensagemDeEncerramento(t), true, t);
});

test("não é encerramento: pergunta, conteúdo novo, áudio/foto", () => {
  for (const t of [
    "ok, mas que horas chega?",
    "Combinado. Pode ser às 14h em vez das 10h",
    "Quanto fica o sofá de 3 lugares",
    "obrigada, e o tapete vocês fazem",
    "oi",
    "?",
  ])
    assert.equal(mensagemDeEncerramento(t), false, t);
  assert.equal(mensagemDeEncerramento("", "Áudio"), false);
  assert.equal(mensagemDeEncerramento(null, "Imagem"), false);
});

test("espera de verdade: só quando o que veio depois da resposta pede resposta", () => {
  const equipe = { direction: "Enviada", text_content: "Confirmado para amanhã às 9h!" };
  // Da mais nova para a mais antiga.
  assert.equal(
    esperaDeVerdade([{ direction: "Recebida", text_content: "Combinado, obrigada" }, equipe]),
    false,
  );
  assert.equal(
    esperaDeVerdade([
      { direction: "Recebida", text_content: "👍" },
      { direction: "Recebida", text_content: "e o tapete, fazem?" },
      equipe,
    ]),
    true,
  );
  assert.equal(esperaDeVerdade([equipe]), false);
  assert.equal(esperaDeVerdade([{ direction: "Recebida", text_content: "ok" }]), true);
  assert.equal(
    esperaDeVerdade([{ direction: "Recebida", text_content: null, message_type: "Áudio" }, equipe]),
    true,
  );
});
