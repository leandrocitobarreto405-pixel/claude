// Dados fictícios: nenhum cliente, item ou valor real.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DESCRICAO,
  descricaoServicos,
  type ItemDescricao,
  type VisitaDescricao,
} from "./nota-fiscal-descricao";
import { montarMensagemNota, type DadosNota } from "./nota-fiscal";

let ordem = 0;
function item(
  description: string,
  subtotal: number,
  extra: Partial<ItemDescricao> = {},
): ItemDescricao {
  return {
    description,
    quantity: 1,
    unidade: "un",
    subtotal,
    item_group_id: null,
    display_order: ordem++,
    active: true,
    ...extra,
  };
}

function visita(
  tipo: string,
  itens: ItemDescricao[],
  extra: Partial<VisitaDescricao> = {},
): VisitaDescricao {
  return {
    status: "Concluído",
    completion_date: "2026-03-10",
    scheduled_date: "2026-03-10",
    visit_value: itens.reduce((s, i) => s + i.subtotal, 0),
    final_value: null,
    discount_amount: 0,
    item_quantity: null,
    upholstery_description: null,
    service_type: { name: tipo },
    service_items: itens,
    ...extra,
  };
}

const ok = (r: ReturnType<typeof descricaoServicos>) => {
  assert.equal(r.aviso, null);
  assert.ok(r.texto);
  return r.texto;
};

test("só higienização: linhas com 2 dígitos, serviço do nome e total", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 732,
      valorOs: 732,
      visitas: [
        visita("Higienização", [
          item("Sofá exemplo 3 lugares — Higienização", 286),
          item("Sofá exemplo de couro — Higienização e Hidratação", 290),
          item("Poltrona exemplo", 156),
        ]),
      ],
    }),
  );
  assert.equal(
    texto,
    [
      "Serviço de higienização de estofados realizado em 10/03/2026:",
      "- 01 Sofá exemplo 3 lugares - Higienização: R$ 286,00",
      "- 01 Sofá exemplo de couro - Higienização e Hidratação: R$ 290,00",
      "- 01 Poltrona exemplo - Higienização: R$ 156,00",
      "",
      "Valor total: R$ 732,00",
    ].join("\n"),
  );
  assert.doesNotMatch(texto, /[*_#]|\u00a0/);
});

test("quantidade e milhar no formato brasileiro", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 1139,
      valorOs: 1139,
      visitas: [visita("Higienização", [item("Cadeira exemplo", 1139, { quantity: 12 })])],
    }),
  );
  assert.match(texto, /^- 12 Cadeira exemplo - Higienização: R\$ 1\.139,00$/m);
});

test("com impermeabilização: o mesmo item nas duas visitas vira uma linha", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 600,
      valorOs: 600,
      visitas: [
        visita("Higienização", [item("Sofá exemplo — Higienização", 250, { item_group_id: "g1" })]),
        visita(
          "Impermeabilização",
          [item("Sofá exemplo — Impermeabilização", 350, { item_group_id: "g1" })],
          { completion_date: "2026-03-12", scheduled_date: "2026-03-12" },
        ),
      ],
    }),
  );
  assert.equal(
    texto.split("\n")[0],
    "Serviço de higienização e impermeabilização de estofados realizado em 10/03/2026 e 12/03/2026:",
  );
  assert.match(texto, /^- 01 Sofá exemplo - Higienização e Impermeabilização: R\$ 600,00$/m);
});

test("tapete com medidas no nome e área em m²", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 937.36,
      valorOs: 937.36,
      visitas: [
        visita("Higienização", [
          item("Tapete exemplo 5,06 x 3,90 — Higienização", 937.36, {
            quantity: 19.73,
            unidade: "m2",
          }),
        ]),
      ],
    }),
  );
  assert.equal(texto.split("\n")[0], "Serviço de higienização de tapete realizado em 10/03/2026:");
  assert.match(
    texto,
    /^- 01 Tapete exemplo 5,06 m x 3,90 m \(19,73 m²\) - Higienização: R\$ 937,36$/m,
  );
});

test("tapete sem medidas: só a área; Limpeza do app sai Higienização na nota", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 200,
      valorOs: 200,
      visitas: [
        visita("Higienização", [
          item("Tapete exemplo – limpeza (por m²) — Limpeza", 200, {
            quantity: 4,
            unidade: "m2",
          }),
        ]),
      ],
    }),
  );
  assert.equal(texto.split("\n")[0], "Serviço de higienização de tapete realizado em 10/03/2026:");
  assert.match(texto, /^- 01 Tapete exemplo \(4,00 m²\) - Higienização: R\$ 200,00$/m);
});

test("tipos misturados: primeira linha sem o objeto", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 500,
      valorOs: 500,
      visitas: [visita("Higienização", [item("Sofá exemplo", 300), item("Tapete exemplo", 200)])],
    }),
  );
  assert.equal(texto.split("\n")[0], "Serviço de higienização realizado em 10/03/2026:");
});

test("com desconto (Pix/cupom no valor da OS e saldo dispensado): linha antes do total", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 470,
      valorOs: 480,
      visitas: [
        visita("Higienização", [item("Sofá exemplo", 300), item("Poltrona exemplo", 200)], {
          discount_amount: 10,
        }),
      ],
    }),
  );
  assert.match(texto, /\n\nDesconto: -R\$ 30,00\nValor total: R\$ 470,00$/);
});

test("valor que não bate: aviso em vermelho, mas a descrição sai (dá para copiar)", () => {
  const r = descricaoServicos({
    valorNota: 900,
    valorOs: 500,
    visitas: [visita("Higienização", [item("Sofá exemplo", 500)])],
  });
  assert.match(r.aviso ?? "", /não bate.*nota R\$ 900,00/);
  assert.match(r.texto ?? "", /^- 01 Sofá exemplo - Higienização: R\$ 500,00$/m);
  assert.match(r.texto ?? "", /Valor total: R\$ 900,00$/);
});

test("OS sem itens: sem descrição, com aviso", () => {
  const r = descricaoServicos({ valorNota: 100, valorOs: 100, visitas: [] });
  assert.equal(r.texto, null);
  assert.match(r.aviso, /não tem itens/);
});

test("sem visita concluída: data agendada da visita; visita cancelada não entra", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 100,
      valorOs: 100,
      visitas: [
        visita("Higienização", [item("Poltrona exemplo", 100)], {
          status: "Confirmado",
          completion_date: null,
          scheduled_date: "2026-04-02",
        }),
        visita("Higienização", [item("Sofá cancelado", 999)], {
          status: "Cancelado",
          scheduled_date: "2026-04-01",
        }),
      ],
    }),
  );
  assert.match(texto, /realizado em 02\/04\/2026:/);
  assert.doesNotMatch(texto, /cancelado|01\/04/);
});

test("uma concluída e outra só agendada: data da conclusão e data agendada", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 300,
      valorOs: 300,
      visitas: [
        visita("Higienização", [item("Sofá exemplo", 200)], {
          completion_date: "2026-04-03",
          scheduled_date: "2026-04-02",
        }),
        visita("Impermeabilização", [item("Poltrona exemplo", 100)], {
          status: "Agendado",
          completion_date: null,
          scheduled_date: "2026-04-10",
        }),
      ],
    }),
  );
  assert.match(texto, /realizado em 03\/04\/2026 e 10\/04\/2026:/);
});

test("colchão conta como estofado (sozinho ou com sofá)", () => {
  const so = ok(
    descricaoServicos({
      valorNota: 200,
      valorOs: 200,
      visitas: [visita("Higienização", [item("Colchão exemplo — Higienização", 200)])],
    }),
  );
  assert.equal(so.split("\n")[0], "Serviço de higienização de estofados realizado em 10/03/2026:");
  const junto = ok(
    descricaoServicos({
      valorNota: 500,
      valorOs: 500,
      visitas: [visita("Higienização", [item("Sofá exemplo", 300), item("Colchão exemplo", 200)])],
    }),
  );
  assert.equal(
    junto.split("\n")[0],
    "Serviço de higienização de estofados realizado em 10/03/2026:",
  );
});

test("persiana: sai como higienização na nota", () => {
  const texto = ok(
    descricaoServicos({
      valorNota: 150,
      valorOs: 150,
      visitas: [visita("Higienização", [item("Persiana exemplo — Limpeza", 150)])],
    }),
  );
  assert.equal(
    texto.split("\n")[0],
    "Serviço de higienização de persiana realizado em 10/03/2026:",
  );
  assert.match(texto, /^- 01 Persiana exemplo - Higienização: R\$ 150,00$/m);
});

test("mais de 2.000 caracteres: agrupa itens iguais e avisa", () => {
  const itens = Array.from({ length: 60 }, () =>
    item("Cadeira de jantar exemplo com encosto alto — Higienização", 50),
  );
  const r = descricaoServicos({
    valorNota: 3000,
    valorOs: 3000,
    visitas: [visita("Higienização", itens)],
  });
  assert.equal(r.aviso, null);
  assert.equal(r.agrupado, true);
  assert.ok((r.texto ?? "").length <= MAX_DESCRICAO);
  assert.match(
    r.texto ?? "",
    /^- 60 Cadeira de jantar exemplo com encosto alto - Higienização: R\$ 3\.000,00$/m,
  );
});

test("mensagem: descrição no fim, ou no lugar de {{descricao_servicos}}", () => {
  const d: DadosNota = {
    nome_cliente: "Cliente Fictício",
    cpf_cnpj: "000.000.000-00",
    email: "ficticio@exemplo.com",
    data_servico: "10/03/2026",
    forma_pagamento: "Pix",
    valor: "R$ 100,00",
    numero_os: "0001",
  };
  const desc = "Serviço de higienização de estofados realizado em 10/03/2026:";
  assert.equal(
    montarMensagemNota("Nota — {{nome_cliente}}", d, desc),
    `Nota — Cliente Fictício\n\n${desc}`,
  );
  assert.equal(
    montarMensagemNota("{{descricao_servicos}}\nOS {{numero_os}}", d, desc),
    `${desc}\nOS 0001`,
  );
  assert.equal(montarMensagemNota("Nota — {{nome_cliente}}", d), "Nota — Cliente Fictício");
});
