import { test } from "node:test";
import assert from "node:assert/strict";
import {
  camposFaltando,
  dadosDaNota,
  formaPagamento,
  montarMensagemNota,
  type TarefaNota,
} from "./nota-fiscal";

function tarefa(
  extra: Partial<TarefaNota["work_order"]> = {},
  doc: string | null = null,
): TarefaNota {
  return {
    id: "t1",
    empresa_id: "e1",
    status: "Pendente",
    invoice_amount: 480,
    invoice_number: null,
    issue_date: null,
    service_date: "2026-09-15",
    document_number: doc,
    solicitada_em: null,
    arquivo_path: null,
    arquivo_nome: null,
    work_order: {
      id: "w1",
      os_number: "1234",
      total_gross_value: 480,
      negotiated_payment_method: "Crédito",
      negotiated_installments: 3,
      customer: {
        full_name: "João da Silva",
        document_number: "123.456.789-00",
        email: "joao@ex.com",
      },
      payments: [],
      ...extra,
    },
  };
}

test("mensagem com todos os dados", () => {
  const msg = montarMensagemNota(null, dadosDaNota(tarefa()));
  assert.match(msg, /^Nota fiscal — João da Silva$/m);
  assert.match(msg, /^CPF\/CNPJ: 123\.456\.789-00$/m);
  assert.match(msg, /^E-mail: joao@ex\.com$/m);
  assert.match(msg, /^Data do serviço: 15\/09\/2026$/m);
  assert.match(msg, /^Forma de pagamento: Crédito em 3x$/m);
  assert.match(msg, /^OS: 1234$/m);
});

test("forma de pagamento: vale a recebida, não a combinada", () => {
  const t = tarefa({
    payments: [
      {
        payment_type: "Pix",
        payment_channel: "Pix direto",
        installments: 1,
        payment_status: "Pago",
        is_active: true,
      },
      {
        payment_type: "Crédito",
        payment_channel: "Maquininha",
        installments: 2,
        payment_status: "Não pago",
        is_active: true,
      },
      {
        payment_type: "Débito",
        payment_channel: "Maquininha",
        installments: 1,
        payment_status: "Pago",
        is_active: false,
      },
    ],
  });
  assert.equal(formaPagamento(t), "Pix");
});

test("CPF/CNPJ da nota tem prioridade sobre o do cadastro", () => {
  assert.equal(dadosDaNota(tarefa({}, "11.222.333/0001-44")).cpf_cnpj, "11.222.333/0001-44");
});

test("campos em branco viram 'não informado' e são avisados", () => {
  const t = tarefa({ customer: { full_name: "Ana", document_number: null, email: "" } });
  const d = dadosDaNota(t);
  assert.deepEqual(camposFaltando(d), ["CPF/CNPJ", "e-mail"]);
  assert.match(montarMensagemNota(null, d), /CPF\/CNPJ: não informado/);
});

test("modelo personalizado e variável desconhecida preservada", () => {
  const msg = montarMensagemNota(
    "NF {{numero_os}} {{ nome_cliente }} {{xyz}}",
    dadosDaNota(tarefa()),
  );
  assert.equal(msg, "NF 1234 João da Silva {{xyz}}");
});
