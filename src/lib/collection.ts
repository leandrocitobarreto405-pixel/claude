import { brl, dateBR } from "@/lib/format";

/** Regras de "Momento da cobrança" de uma OS. */
export const COLLECTION_RULES = [
  { value: "cleaning_visit", label: "Cobrar na higienização" },
  { value: "waterproofing_visit", label: "Cobrar na impermeabilização" },
  { value: "split_by_service", label: "Cobrar separadamente em cada serviço" },
  { value: "specific_visit", label: "Cobrar em uma visita específica" },
  { value: "prepaid", label: "Pagamento antecipado" },
  { value: "no_on_site_collection", label: "Não cobrar no local" },
] as const;

export type CollectionRule = (typeof COLLECTION_RULES)[number]["value"];

export function collectionRuleLabel(rule: string | null | undefined) {
  return COLLECTION_RULES.find((r) => r.value === rule)?.label ?? "Regra automática";
}

/** Visita "ativa" para fins de cobrança (cancelada não conta). */
export const INACTIVE_COLLECTION_STATUSES = ["Cancelado", "Cancelada"];

export type CollectionVisit = {
  id: string;
  scheduled_date: string;
  scheduled_time: string;
  status: string;
  service_name: string | null;
  amount: number;
};

export type CollectionSetup = {
  rule: string | null;
  collectionVisitId: string | null;
  customInstruction: string | null;
  negotiatedTotal: number;
  paymentMethod: string | null;
  installments: number | null;
};

export function isCleaningService(name: string | null | undefined) {
  return /higien/i.test(name ?? "");
}

export function isWaterproofService(name: string | null | undefined) {
  return /impermeab/i.test(name ?? "");
}

export function activeCollectionVisits(visits: CollectionVisit[]) {
  return visits
    .filter((v) => !INACTIVE_COLLECTION_STATUSES.includes(v.status))
    .slice()
    .sort((a, b) =>
      `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(
        `${b.scheduled_date} ${b.scheduled_time}`,
      ),
    );
}

/** Padrão para OS nova: combinada (higienização + impermeabilização) cobra na impermeabilização. */
export function defaultCollectionRule(visits: CollectionVisit[]): CollectionRule {
  const ativas = activeCollectionVisits(visits);
  const temHig = ativas.some((v) => isCleaningService(v.service_name));
  const temImp = ativas.some((v) => isWaterproofService(v.service_name));
  return temHig && temImp ? "waterproofing_visit" : "split_by_service";
}

export function effectiveCollectionRule(
  setup: Pick<CollectionSetup, "rule">,
  visits: CollectionVisit[],
): CollectionRule {
  const rule = setup.rule as CollectionRule | null;
  if (rule && COLLECTION_RULES.some((r) => r.value === rule)) return rule;
  return defaultCollectionRule(visits);
}

/** Escolhe a visita responsável pela cobrança conforme a regra. */
export function resolveCollectionVisitId(
  rule: CollectionRule,
  visits: CollectionVisit[],
  explicitId: string | null,
): string | null {
  const ativas = activeCollectionVisits(visits);
  const explicita = explicitId && ativas.some((v) => v.id === explicitId) ? explicitId : null;
  if (rule === "specific_visit") return explicita ?? ativas[0]?.id ?? null;
  if (explicita) return explicita;
  if (rule === "waterproofing_visit") {
    const imp = ativas.filter((v) => isWaterproofService(v.service_name));
    return imp[imp.length - 1]?.id ?? ativas[ativas.length - 1]?.id ?? null;
  }
  if (rule === "cleaning_visit") {
    const hig = ativas.filter((v) => isCleaningService(v.service_name));
    return hig[0]?.id ?? ativas[0]?.id ?? null;
  }
  return null;
}

export type CollectionFields = {
  instrucaoPagamento: string;
  valorACobrar: string;
  valorTotalCombinado: string;
  valorDoServico: string;
  formaPagamentoCombinada: string;
  dataVisitaCobranca: string;
  servicoVisitaCobranca: string;
  isCollectionVisit: boolean;
};

function serviceLabel(v: CollectionVisit | undefined) {
  if (!v) return "";
  const hig = isCleaningService(v.service_name);
  const imp = isWaterproofService(v.service_name);
  if (hig && imp) return "Higienização e Impermeabilização";
  return v.service_name ?? "";
}

function formaTexto(setup: CollectionSetup) {
  const forma = setup.paymentMethod?.trim() || "A combinar";
  const parcelas = Number(setup.installments ?? 1);
  return parcelas > 1 ? `${forma} em ${parcelas}x` : forma;
}

/**
 * Gera os campos de cobrança da mensagem do técnico.
 * Somente a visita de cobrança exibe o valor total; as demais recebem a instrução de não cobrar.
 */
export function collectionFields(
  visitId: string,
  visits: CollectionVisit[],
  setup: CollectionSetup,
): CollectionFields {
  const ativas = activeCollectionVisits(visits);
  const atual = ativas.find((v) => v.id === visitId) ?? visits.find((v) => v.id === visitId);
  const rule = effectiveCollectionRule(setup, visits);
  const cobrancaId = resolveCollectionVisitId(rule, visits, setup.collectionVisitId);
  const visitaCobranca = ativas.find((v) => v.id === cobrancaId);
  const total = brl(setup.negotiatedTotal);
  const valorServico = brl(atual?.amount ?? 0);
  const forma = formaTexto(setup);
  const dataCobranca = visitaCobranca ? dateBR(visitaCobranca.scheduled_date) : "";
  const servicoCobranca = serviceLabel(visitaCobranca);
  const ehCobranca = Boolean(cobrancaId) && cobrancaId === visitId;

  let instrucao: string;
  let valorACobrar = "";

  if (rule === "prepaid") {
    instrucao =
      "Pagamento:\nCliente já realizou ou realizará o pagamento antecipadamente.\nNão cobrar no local.";
  } else if (rule === "no_on_site_collection") {
    instrucao = "Pagamento:\nNão realizar cobrança neste atendimento.";
  } else if (rule === "split_by_service") {
    instrucao = `Valor a cobrar neste atendimento: ${valorServico}\nForma de pagamento combinada: ${forma}`;
    valorACobrar = valorServico;
  } else if (ehCobranca) {
    instrucao = `Valor total a cobrar: ${total}\nForma de pagamento combinada: ${forma}`;
    valorACobrar = total;
  } else if (rule === "waterproofing_visit") {
    instrucao =
      "Pagamento:\nNão cobrar neste atendimento.\nPagamento previsto para o dia da impermeabilização.";
  } else if (rule === "cleaning_visit") {
    const higConcluida = ativas.some(
      (v) => isCleaningService(v.service_name) && v.status === "Concluído",
    );
    instrucao = higConcluida
      ? "Pagamento:\nPagamento realizado ou previsto no atendimento de higienização."
      : "Pagamento:\nNão cobrar neste atendimento.\nPagamento previsto para o dia da higienização.";
  } else {
    instrucao = dataCobranca
      ? `Pagamento:\nNão cobrar neste atendimento.\nPagamento previsto para ${dataCobranca}.`
      : "Pagamento:\nNão cobrar neste atendimento.";
  }

  const custom = setup.customInstruction?.trim();

  return {
    instrucaoPagamento: custom ? custom : instrucao,
    valorACobrar,
    valorTotalCombinado: total,
    valorDoServico: valorServico,
    formaPagamentoCombinada: forma,
    dataVisitaCobranca: dataCobranca,
    servicoVisitaCobranca: servicoCobranca,
    isCollectionVisit: ehCobranca,
  };
}

/** Instrução automática (sem instrução personalizada), usada nas telas de configuração. */
export function autoInstruction(
  visitId: string,
  visits: CollectionVisit[],
  setup: CollectionSetup,
) {
  return collectionFields(visitId, visits, { ...setup, customInstruction: null })
    .instrucaoPagamento;
}
