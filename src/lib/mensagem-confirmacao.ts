// Texto da confirmação do dia seguinte ("Confirmar amanhã" e agenda dos técnicos no WhatsApp).
// Sem acesso a banco: a tela e o servidor montam exatamente o mesmo texto.
import { brl, dateBR, timeBR, weekdayPT } from "@/lib/format";
import {
  collectionFields,
  type CollectionFields,
  type CollectionSetup,
  type CollectionVisit,
} from "@/lib/collection";
import type { VisitRow } from "@/lib/os";
import type { BudgetVisitRow } from "@/lib/budget-visits";

export const DEFAULT_MESSAGE_TEMPLATE = `{{dia_da_semana}}, {{data}}, às {{horario}}

OS {{numero_os}}
{{nome_cliente}}

{{descricao_estofado}}

Serviço: {{servico}}

Endereço:
{{endereco_completo}}

{{INSTRUCAO_PAGAMENTO}}`;

export type MessageContext = {
  weekday: string;
  date: string;
  time: string;
  osNumber: string;
  customer: string;
  phone: string;
  upholstery: string;
  service: string;
  address: string;
  value: number;
  technician: string;
  notes: string;
  collection?: CollectionFields | null;
};

/** Aceita string ou objeto ({ body }) vindo das configurações salvas em JSON. */
export function templateText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const body =
      (value as { body?: unknown; template?: unknown }).body ??
      (value as { template?: unknown }).template;
    if (typeof body === "string") return body;
  }
  return "";
}

/**
 * Modelos antigos terminavam com "Valor: {{valor_formatado}}", que imprime o valor daquele
 * atendimento — no dia da higienização isso parecia uma cobrança. Sem a variável de
 * pagamento, a linha de valor passa a ser a instrução de cobrança da OS.
 */
export function normalizeMessageTemplate(text: string): string {
  if (text.includes("{{INSTRUCAO_PAGAMENTO}}")) return text;
  if (!text.includes("{{valor_formatado}}")) return text;
  const linhas = text.split("\n");
  let trocou = false;
  const saida = linhas
    .map((linha) => {
      if (!linha.includes("{{valor_formatado}}")) return linha;
      if (trocou) return null;
      trocou = true;
      return "{{INSTRUCAO_PAGAMENTO}}";
    })
    .filter((l): l is string => l !== null);
  return saida.join("\n");
}

export function renderMessage(template: unknown, ctx: MessageContext): string {
  const raw = templateText(template);
  const base = normalizeMessageTemplate(raw.trim() ? raw : DEFAULT_MESSAGE_TEMPLATE);
  const c = ctx.collection ?? null;

  return base
    .replaceAll("{{dia_da_semana}}", ctx.weekday)
    .replaceAll("{{data}}", ctx.date)
    .replaceAll("{{horario}}", ctx.time)
    .replaceAll("{{numero_os}}", ctx.osNumber)
    .replaceAll("{{nome_cliente}}", ctx.customer)
    .replaceAll("{{telefone}}", ctx.phone)
    .replaceAll("{{descricao_estofado}}", ctx.upholstery)
    .replaceAll("{{servico}}", ctx.service)
    .replaceAll("{{endereco_completo}}", ctx.address)
    .replaceAll("{{valor_formatado}}", brl(ctx.value))
    .replaceAll("{{tecnico}}", ctx.technician)
    .replaceAll("{{observacao}}", ctx.notes)
    .replaceAll("{{INSTRUCAO_PAGAMENTO}}", c?.instrucaoPagamento ?? `Valor: ${brl(ctx.value)}`)
    .replaceAll("{{VALOR_A_COBRAR}}", c?.valorACobrar ?? brl(ctx.value))
    .replaceAll("{{VALOR_TOTAL_COMBINADO}}", c?.valorTotalCombinado ?? brl(ctx.value))
    .replaceAll("{{VALOR_DO_SERVICO}}", c?.valorDoServico ?? brl(ctx.value))
    .replaceAll("{{FORMA_PAGAMENTO_COMBINADA}}", c?.formaPagamentoCombinada ?? "")
    .replaceAll("{{DATA_VISITA_COBRANCA}}", c?.dataVisitaCobranca ?? "")
    .replaceAll("{{SERVICO_VISITA_COBRANCA}}", c?.servicoVisitaCobranca ?? "");
}

export function collectionSetupFromWorkOrder(wo: VisitRow["work_order"]): CollectionSetup {
  return {
    rule: wo?.collection_rule ?? null,
    collectionVisitId: wo?.collection_visit_id ?? null,
    customInstruction: wo?.payment_instruction ?? null,
    negotiatedTotal: Number(wo?.total_gross_value ?? 0),
    paymentMethod: wo?.negotiated_payment_method ?? null,
    installments: wo?.negotiated_installments ?? 1,
  };
}

export function visitMessageContext(
  v: VisitRow,
  template?: unknown,
  siblings?: CollectionVisit[],
): string {
  const setup = collectionSetupFromWorkOrder(v.work_order);
  const lista: CollectionVisit[] =
    siblings && siblings.length
      ? siblings
      : [
          {
            id: v.id,
            scheduled_date: v.scheduled_date,
            scheduled_time: v.scheduled_time,
            status: v.status,
            service_name: v.service_type?.name ?? null,
            amount: Number(v.final_value ?? v.visit_value ?? 0),
          },
        ];
  const collection = collectionFields(v.id, lista, setup);

  return renderMessage(template, {
    weekday: weekdayPT(v.scheduled_date),
    date: dateBR(v.scheduled_date),
    time: timeBR(v.scheduled_time),
    osNumber: v.work_order?.os_number ?? "",
    customer: v.work_order?.customer?.full_name ?? "",
    phone: v.work_order?.customer?.phone ?? "",
    upholstery: v.upholstery_description || v.upholstery_type?.name || "",
    service: v.service_type?.name ?? "",
    address: v.work_order?.customer?.full_address ?? "",
    value: Number(v.final_value ?? v.visit_value ?? 0),
    technician: v.technician?.name ?? "",
    notes: v.visit_notes ?? "",
    collection,
  });
}

export function budgetVisitMessageContext(v: BudgetVisitRow, template?: unknown): string {
  const fee = Number(v.visit_fee ?? 0);
  const valorTexto = fee > 0 ? brl(fee) : "sem custo";
  const instrucao =
    fee > 0
      ? `Cobrar a taxa de visita de ${brl(fee)} no atendimento.`
      : "Visita de orçamento sem cobrança.";

  return renderMessage(template, {
    weekday: weekdayPT(v.scheduled_date),
    date: dateBR(v.scheduled_date),
    time: timeBR(v.scheduled_time),
    osNumber: "",
    customer: v.customer?.full_name ?? "",
    phone: v.customer?.phone ?? "",
    upholstery: v.upholstery_description ?? "",
    service: "Visita de orçamento",
    address: v.customer?.full_address ?? "",
    value: fee,
    technician: v.technician?.name ?? "",
    notes: v.notes ?? "",
    collection: {
      instrucaoPagamento: instrucao,
      valorACobrar: valorTexto,
      valorTotalCombinado: valorTexto,
      valorDoServico: valorTexto,
      formaPagamentoCombinada: fee > 0 ? "A combinar" : "",
      dataVisitaCobranca: "",
      servicoVisitaCobranca: "",
      isCollectionVisit: fee > 0,
    },
  });
}
