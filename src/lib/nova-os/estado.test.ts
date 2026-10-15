import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarCotacao,
  aplicarLead,
  aplicarOrcamento,
  comNegociadoAtualizado,
  destinoDaNovaOs,
  ehAmbienteDeTeste,
  estadoInicial,
  montarPayload,
  validar,
  validarPasso,
  vendedoraInicial,
  type DadosCotacao,
  type DadosLead,
  type DadosVisitaOrcamento,
  type EstadoNovaOs,
  type ItemCotacao,
} from "./estado";
import { cotacaoAtual, leadAtual, montagemAtual, orcamentoAtual } from "./congelado";

// Dados fictícios (nada de clientes reais).
const HOJE = "2026-10-14";
const AGORA = "2026-10-14T15:00:00.000Z";
const SERVICOS = [
  { id: "s-hig", name: "Higienização" },
  { id: "s-imp", name: "Impermeabilização" },
];
const CTX = { userId: "u-1", agora: AGORA, comissaoPct: 5, servicos: SERVICOS };
const CLIENTE = {
  id: "c-1",
  full_name: "Cliente Fictício",
  phone: "(11) 90000-0001",
  email: "ficticio@example.com",
  document_number: null,
  postal_code: "01001-000",
  street: "Rua Exemplo",
  street_number: "10",
  complement: null,
  neighborhood: "Centro",
  city: "São Paulo",
  state: "SP",
  reference_point: null,
};

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

/** Estado preenchido à mão (caso manual), com um item editado e um em m². */
function manual(): EstadoNovaOs {
  const e = estadoInicial({ hoje: HOJE });
  return comNegociadoAtualizado({
    ...e,
    osNumber: " 1234 ",
    origemId: "o-google",
    vendedoraId: "v-1",
    nome: "Cliente Fictício",
    telefone: "11900000001",
    rua: "Rua Exemplo",
    numero: "10",
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "sp",
    visitas: [
      {
        ...e.visitas[0]!,
        service_type_id: "s-hig",
        technician_id: "t-1",
        visit_notes: " levar escada ",
        items: [
          {
            upholstery_type_id: "e-sofa",
            description: "Sofá 3 lugares",
            quantity: "2",
            unit_price: "150,00",
            item_group_id: "g-1",
            preco_tabela: 180,
          },
          {
            upholstery_type_id: "",
            description: "Tapete",
            quantity: "2,5",
            unit_price: "40,00",
            item_group_id: "g-2",
            unidade: "m2",
          },
        ],
      },
      {
        ...e.visitas[0]!,
        service_type_id: "s-imp",
        scheduled_date: "2026-10-20",
        scheduled_time: "14:00",
        technician_id: "",
        items: [
          {
            upholstery_type_id: "e-sofa",
            description: "",
            quantity: "1",
            unit_price: "300,00",
            item_group_id: "g-1",
          },
        ],
      },
    ],
  });
}

test("manual: montarPayload == montagem congelada do formulário antigo", () => {
  const e = manual();
  assert.deepEqual(montarPayload(e, CTX), montagemAtual(e, CTX));
  const p = montarPayload(e, CTX);
  assert.equal(p.order.os_number, "1234");
  assert.equal(p.order.total_gross_value, 700);
  assert.equal(p.order.collection_rule, "waterproofing_visit");
  assert.equal(p.customer.state, "SP");
  assert.deepEqual(
    p.visits[0]!.items.map((i) => [i.quantity, i.editado_por, i.editado_em]),
    [
      [2, "u-1", AGORA],
      [2.5, null, null],
    ],
  );
});

test("manual com valor negociado diferente e cobrança em visita específica", () => {
  const e: EstadoNovaOs = {
    ...manual(),
    negociadoEditado: true,
    valorNegociado: "650,00",
    motivoAjuste: "desconto de pacote",
    regraCobranca: "specific_visit",
    visitaCobranca: 1,
    ehTeste: true,
  };
  assert.deepEqual(montarPayload(e, CTX), montagemAtual(e, CTX));
  const p = montarPayload(e, CTX);
  assert.equal(p.order.adjustment_reason, "desconto de pacote");
  assert.equal(p.order.collection_visit_index, 1);
  assert.equal(p.order.eh_teste, true);
});

const LEAD: DadosLead = {
  lead_name: "Lead Fictício",
  phone: "(11) 90000-0002",
  upholstery_description: "Sofá retrátil 3 lugares",
  summary: "quer higienização",
  salesperson_id: "v-lead",
  sales_origin_id: "o-google",
  customer: null,
};

test("lead: pré-preenchimento e payload iguais ao formulário antigo (sem e com cadastro)", () => {
  const base = estadoInicial({ hoje: HOJE });
  for (const d of [LEAD, { ...LEAD, customer: CLIENTE }]) {
    const novo = aplicarLead(base, d);
    assert.deepEqual(novo, leadAtual(base, d));
    const pronto = comNegociadoAtualizado({
      ...novo,
      osNumber: "2001",
      numero: novo.numero || "1",
      bairro: novo.bairro || "Bairro",
      cidade: novo.cidade || "Cidade",
      uf: novo.uf || "SP",
      rua: novo.rua || "Rua",
      visitas: novo.visitas.map((v) => ({
        ...v,
        service_type_id: "s-hig",
        items: v.items.map((it) => ({ ...it, unit_price: "200,00" })),
      })),
    });
    assert.deepEqual(montarPayload(pronto, CTX), montagemAtual(pronto, CTX));
  }
  const comCadastro = aplicarLead(base, { ...LEAD, customer: CLIENTE });
  assert.equal(comCadastro.clienteExistente, "c-1");
  assert.equal(comCadastro.telefone, "11900000001");
  assert.equal(comCadastro.vendedoraId, "v-lead");
  assert.equal(comCadastro.visitas[0]!.items[0]!.description, "Sofá retrátil 3 lugares");
  assert.match(comCadastro.obsGerais, /^Origem: lead do WhatsApp\./);
});

test("lead não sobrescreve o que já foi digitado", () => {
  const base = { ...estadoInicial({ hoje: HOJE }), nome: "Já digitado", vendedoraId: "v-9" };
  const novo = aplicarLead(base, LEAD);
  assert.deepEqual(novo, leadAtual(base, LEAD));
  assert.equal(novo.nome, "Já digitado");
  assert.equal(novo.vendedoraId, "v-9");
});

const ORCAMENTO: DadosVisitaOrcamento = {
  upholstery_description: "Cadeiras de jantar",
  notes: "portão azul",
  result_notes: "6 cadeiras",
  sales_origin_id: "o-indicacao",
  technician_id: "t-2",
  customer: CLIENTE,
};

test("visita de orçamento: pré-preenchimento e payload iguais ao formulário antigo", () => {
  const base = estadoInicial({ hoje: HOJE });
  const novo = aplicarOrcamento(base, ORCAMENTO);
  assert.deepEqual(novo, orcamentoAtual(base, ORCAMENTO));
  assert.equal(novo.visitas[0]!.technician_id, "t-2");
  assert.equal(
    novo.obsGerais,
    "Origem: visita de orçamento. Cadeiras de jantar — 6 cadeiras — portão azul",
  );
  const pronto = comNegociadoAtualizado({
    ...novo,
    osNumber: "2002",
    vendedoraId: "v-1",
    visitas: novo.visitas.map((v) => ({
      ...v,
      service_type_id: "s-hig",
      items: v.items.map((it) => ({ ...it, unit_price: "90,00" })),
    })),
  });
  assert.deepEqual(montarPayload(pronto, CTX), montagemAtual(pronto, CTX));
});

const COTACAO: DadosCotacao = {
  cliente_nome: "Cliente da Cotação",
  cliente_telefone: "(11) 90000-0003",
  cliente_cep: "01001-000",
  cliente_endereco: "Rua da Cotação, 5",
  data_servico: "2026-10-22",
  observacoes: "entrar pela garagem",
  total: 520,
};
const ITENS: ItemCotacao[] = [
  {
    nome_snapshot: "Sofá 3 lugares",
    tipo_servico: "higienizacao",
    preco_aplicado: 200,
    quantidade: 1,
    preco_tabela: 220,
    preco_sugerido: 200,
    editado_por: null,
    editado_em: null,
    adicional_pos_fechamento: false,
    categoria: "sofa",
  },
  {
    nome_snapshot: "Tapete",
    tipo_servico: "higienizacao",
    preco_aplicado: 40,
    quantidade: 3.5,
    preco_tabela: 40,
    preco_sugerido: null,
    editado_por: null,
    editado_em: null,
    adicional_pos_fechamento: false,
    categoria: "tapete",
  },
  {
    nome_snapshot: "Puff",
    tipo_servico: "impermeabilizacao",
    preco_aplicado: 180,
    quantidade: 1,
    preco_tabela: 150,
    preco_sugerido: 150,
    editado_por: "u-2",
    editado_em: "2026-10-10T10:00:00.000Z",
    adicional_pos_fechamento: true,
    categoria: null,
  },
];

test("orçamento (cotação): pré-preenchimento e payload iguais ao formulário antigo", () => {
  const base = estadoInicial({ hoje: HOJE });
  const novo = aplicarCotacao(base, COTACAO, ITENS, ids());
  assert.deepEqual(novo, cotacaoAtual(base, COTACAO, ITENS, ids()));
  assert.equal(novo.visitas[0]!.scheduled_date, "2026-10-22");
  assert.equal(novo.visitas[0]!.items.length, 3);
  assert.equal(novo.visitas[0]!.items[1]!.unidade, "m2");
  assert.equal(novo.visitas[0]!.items[1]!.quantity, "3,5");
  assert.match(novo.visitas[0]!.items[2]!.description, /\(adicional\)$/);
  const pronto = comNegociadoAtualizado({
    ...novo,
    osNumber: "2003",
    origemId: "o-site",
    vendedoraId: "v-1",
    numero: "5",
    bairro: "Centro",
    cidade: "São Paulo",
    uf: "SP",
    visitas: novo.visitas.map((v) => ({ ...v, service_type_id: "s-hig" })),
  });
  assert.deepEqual(montarPayload(pronto, CTX), montagemAtual(pronto, CTX));
  const p = montarPayload(pronto, CTX);
  // Preço editável: o item com preço diferente do sugerido leva quem editou e quando.
  assert.deepEqual(
    p.visits[0]!.items.map((i) => [i.editado_por, i.editado_em]),
    [
      [null, null],
      [null, null],
      ["u-2", "2026-10-10T10:00:00.000Z"],
    ],
  );
  assert.equal(p.order.total_gross_value, 520);
});

test("validação: mesmas mensagens e ordem do formulário antigo", () => {
  const e = manual();
  assert.equal(validar(e, false), null);
  assert.equal(validar({ ...e, osNumber: "" }, false), "Informe o número da OS.");
  assert.equal(validar(e, true), "Este número de OS já existe. Use outro número.");
  assert.equal(validar({ ...e, vendedoraId: "" }, false), "Selecione a vendedora responsável.");
  assert.equal(validar({ ...e, uf: "" }, false), "Preencha o endereço completo do cliente.");
  assert.equal(
    validar({ ...e, negociadoEditado: true, valorNegociado: "600,00" }, false),
    "Informe o motivo do ajuste comercial (valor negociado diferente da soma dos itens).",
  );
  assert.equal(
    validar({ ...e, visitas: [{ ...e.visitas[0]!, service_type_id: "" }] }, false),
    "Selecione o serviço do atendimento 1.",
  );
});

test("validação por passo: Cliente só vê erros do cliente; Serviço só dos atendimentos", () => {
  const e = manual();
  assert.equal(validarPasso({ ...e, nome: "" }, 0), "Informe o nome completo do cliente.");
  assert.equal(validarPasso({ ...e, vendedoraId: "" }, 0), null);
  assert.equal(validarPasso({ ...e, nome: "" }, 1), null);
  assert.equal(
    validarPasso({ ...e, visitas: [{ ...e.visitas[0]!, service_type_id: "" }] }, 1),
    "Selecione o serviço do atendimento 1.",
  );
  assert.equal(validarPasso({ ...e, origemId: "" }, 2), "Selecione a origem da venda.");
});

test("vendedora inicial: lead/orçamento, senão a do login, senão vazio", () => {
  const vs = [
    { id: "v-1", user_id: "u-1" },
    { id: "v-2", user_id: null },
  ];
  assert.equal(vendedoraInicial("v-lead", vs, "u-1"), "v-lead");
  assert.equal(vendedoraInicial("", vs, "u-1"), "v-1");
  assert.equal(vendedoraInicial("", vs, "u-9"), "");
  assert.equal(vendedoraInicial("", vs, null), "");
});

test("OS de teste já marcada só no endereço de teste", () => {
  assert.equal(ehAmbienteDeTeste("nexaos-teste-abc123-rj.a.run.app"), true);
  assert.equal(ehAmbienteDeTeste("app.nexaperformanceos.com.br"), false);
  assert.equal(ehAmbienteDeTeste("127.0.0.1"), false);
  assert.equal(estadoInicial({ ehTeste: true }).ehTeste, true);
  assert.equal(estadoInicial().ehTeste, false);
});

test("/nova-os vai para a janela, menos com editar ou classico", () => {
  assert.deepEqual(destinoDaNovaOs({}), { nova: 1 });
  assert.deepEqual(destinoDaNovaOs({ lead: "l-1" }), { nova: 1, lead: "l-1" });
  assert.deepEqual(destinoDaNovaOs({ cotacao: "q-1", orcamento: "b-1" }), {
    nova: 1,
    orcamento: "b-1",
    cotacao: "q-1",
  });
  assert.equal(destinoDaNovaOs({ editar: "1234" }), null);
  assert.equal(destinoDaNovaOs({ editar: 3001 }), null);
  assert.equal(destinoDaNovaOs({ editar: "TESTE-1" }), null);
  assert.deepEqual(destinoDaNovaOs({ editar: "" }), { nova: 1 });
  assert.equal(destinoDaNovaOs({ classico: "1" }), null);
  assert.equal(destinoDaNovaOs({ classico: true }), null);
});
