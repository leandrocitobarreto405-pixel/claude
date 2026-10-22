import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmacaoPendente, pedidoDeSaida, soPedidoDeSaida, textoBusca } from "./descadastro";

// Os mesmos casos estão em supabase/tests/570_descadastro.sql (função do banco).
export const CASOS_SAIDA: Array<[string, boolean, boolean]> = [
  // [mensagem, recebeu campanha nos últimos 7 dias, é pedido de saída]
  ["Não quero mais ofertas", false, true],
  ["Pare de mandar mensagem", false, true],
  ["para de me mandar isso", false, true],
  ["Quero sair da lista", false, true],
  ["Me tira da lista por favor", false, true],
  ["Não me mande mais nada", false, true],
  ["Não me mandem mais promoções", false, true],
  ["quero me descadastrar", false, true],
  ["PARAR", false, true],
  ["Sair", false, true],
  ["não quero receber mensagens", false, true],
  ["Não quero mais", false, true],
  ["não quero mais, obrigada", false, true],
  ["Não quero mais, já fiz com outra empresa", true, true],
  ["Não quero mais o orçamento de terça", false, false],
  ["não quero receber o técnico sábado, pode ser domingo?", false, false],
  ["Me tira uma dúvida", false, false],
  ["almofadas removíveis", false, false],
  ["Para quando tem horário?", false, false],
  ["Pode parar o carro na garagem", false, false],
];

test("reconhece pedido de saída sem confundir com atendimento", () => {
  for (const [msg, recente, esperado] of CASOS_SAIDA) {
    assert.equal(pedidoDeSaida(msg, recente), esperado, msg);
  }
});

test("só o pedido x pedido com outro assunto", () => {
  assert.equal(soPedidoDeSaida("Não quero mais ofertas"), true);
  assert.equal(soPedidoDeSaida("Pare de mandar, obrigada!"), true);
  assert.equal(soPedidoDeSaida("PARAR"), true);
  assert.equal(
    soPedidoDeSaida("Não quero mais promoções, mas quero saber da garantia do sofá"),
    false,
  );
  assert.equal(soPedidoDeSaida("não me mande mais. Quando o técnico vem?"), false);
  assert.equal(soPedidoDeSaida(""), false);
});

test("texto de busca igual ao do banco", () => {
  assert.equal(textoBusca("Não quero MAIS ofertas!!"), " nao quero mais ofertas ");
  assert.equal(textoBusca(null), "  ");
});

test("confirmação: só pedido do cliente, uma vez, há pouco e com a resposta ligada", () => {
  const agora = new Date("2026-10-22T15:00:00Z");
  const c = {
    marketing_optout_em: "2026-10-22T14:59:00Z",
    marketing_optout_origem: "cliente",
    marketing_optout_confirmado_em: null,
  };
  assert.equal(confirmacaoPendente(c, true, agora), true);
  assert.equal(confirmacaoPendente(c, false, agora), false);
  assert.equal(
    confirmacaoPendente({ ...c, marketing_optout_origem: "marketing" }, true, agora),
    false,
  );
  assert.equal(
    confirmacaoPendente({ ...c, marketing_optout_origem: "equipe" }, true, agora),
    false,
  );
  assert.equal(
    confirmacaoPendente(
      { ...c, marketing_optout_confirmado_em: "2026-10-22T14:59:30Z" },
      true,
      agora,
    ),
    false,
  );
  assert.equal(
    confirmacaoPendente({ ...c, marketing_optout_em: "2026-10-22T11:00:00Z" }, true, agora),
    false,
  );
  assert.equal(confirmacaoPendente(null, true, agora), false);
});
