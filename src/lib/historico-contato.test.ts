import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  HISTORICO_VAZIO,
  textoHistorico,
  tituloHistorico,
  type HistoricoContato,
} from "./historico-contato";

const h: HistoricoContato = {
  primeiroContato: "2025-03-10",
  conversas: [
    {
      id: "c1",
      inicio: "2025-03-10T12:00:00Z",
      fim: "2025-03-12T12:00:00Z",
      status: "resolved",
      resumo: "encerrada",
    },
  ],
  orcamentos: [
    { numero: "88", data: "2025-03-10T13:00:00Z", total: 450, status: "convertido", fechou: true },
    { numero: "120", data: "2026-05-02T13:00:00Z", total: 520, status: "enviado", fechou: false },
  ],
  servicos: [
    {
      osNumero: "1234",
      data: "2025-03-15",
      servico: "Higienização",
      total: 450,
      status: "Concluída",
    },
  ],
  campanhas: [{ data: "2026-10-14T13:00:00Z", nome: "Promoção agenda", respondeu: false }],
  vazio: false,
};

describe("histórico do contato", () => {
  it("texto para a Alice e a Tatiana, uma frase por item, sem nomes", () => {
    assert.equal(
      textoHistorico(h),
      'primeiro contato em 10/03/2025. 1 serviço feito: 15/03/2025 higienização (OS 1234) R$ 450, concluída. 2 orçamentos anteriores: 10/03/2025 R$ 450 (virou OS); 02/05/2026 R$ 520 (enviado, sem fechar). 1 conversa anterior: 10/03/2025 (encerrada). campanhas recebidas: 14/10/2026 "Promoção agenda"',
    );
    assert.equal(textoHistorico(HISTORICO_VAZIO), null);
    assert.equal(textoHistorico(h, 60)?.length, 60);
  });
  it("título curto para a tela", () => {
    assert.equal(tituloHistorico(h), "Cliente antigo: 1 serviço, último em 15/03/2025");
    assert.equal(tituloHistorico({ ...h, servicos: [] }), "Já pediu orçamento 2 vezes, sem fechar");
    assert.equal(
      tituloHistorico({ ...h, servicos: [], orcamentos: [] }),
      "Já conversou 1 vez, sem orçamento",
    );
    assert.equal(tituloHistorico(HISTORICO_VAZIO), "Primeiro contato com a empresa");
  });
});
