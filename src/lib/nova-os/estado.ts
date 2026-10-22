/**
 * Estado puro da Nova OS em janela: tipos, valores iniciais, cálculos, validação e a montagem
 * do que vai para o banco (`montarPayload`). Sem React e sem Supabase, para ser testável.
 *
 * A montagem é a mesma do formulário antigo (`/nova-os?classico=1`); o teste de equivalência
 * compara as duas (`estado.test.ts`).
 */
import type { CustomerInput, VisitInput, WorkOrderInput } from "@/lib/os";
import { visitTotal } from "@/lib/os";
import { defaultCollectionRule, type CollectionVisit } from "@/lib/collection";
import { normalizarQuantidade, rotuloServico, unidadeDaCategoria } from "@/lib/unidade";
import { onlyDigits, parseNumberBR, todayISO } from "@/lib/format";
import { erroDaOrigem, type OrigemDetectada } from "@/lib/origem-venda";

export type ItemForm = {
  id?: string | null;
  upholstery_type_id: string;
  description: string;
  quantity: string;
  unit_price: string;
  item_group_id: string;
  /** Valor da tabela (e o sugerido pelas regras) vindo do orçamento: base do selo "editado". */
  preco_tabela?: number | null;
  preco_referencia?: number | null;
  editado_por?: string | null;
  editado_em?: string | null;
  /** Incluído depois do fechamento (preço de adicional). */
  adicional?: boolean;
  /** "m2": quantidade em m² (tapete, aceita vírgula); padrão: peças. */
  unidade?: "un" | "m2";
};

export type VisitForm = {
  id?: string | null;
  service_type_id: string;
  scheduled_date: string;
  scheduled_time: string;
  technician_id: string;
  visit_notes: string;
  items: ItemForm[];
};

export type EstadoNovaOs = {
  osNumber: string;
  saleDate: string;
  origemId: string;
  /** Código da origem escolhida (metadata.codigo): "indicacao" pede quem indicou. */
  origemCodigo: string;
  indicacaoNome: string;
  /** Origem que o app detectou pela conversa/lead/telefone ("" = nada detectado). */
  origemDetectadaId: string;
  origemDetectadaComo: string;
  /** Taxa de deslocamento pela regra (null: sem regra/sem distância). A cobrada é a linha
   *  "Taxa de deslocamento" do 1º atendimento. */
  taxaRegra: number | null;
  /** A linha da taxa segue a regra (a equipe ainda não mexeu nela). */
  taxaAuto: boolean;
  /** Valor e quem alterou/tirou a taxa no orçamento de onde a OS veio. */
  taxaDoOrcamento: number | null;
  taxaEditadaPor: string | null;
  taxaEditadaEm: string | null;
  vendedoraId: string;
  nome: string;
  telefone: string;
  email: string;
  documento: string;
  cep: string;
  rua: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  referencia: string;
  clienteExistente: string | null;
  visitas: VisitForm[];
  valorNegociado: string;
  negociadoEditado: boolean;
  motivoAjuste: string;
  valorTexto: string;
  formaPagamento: string;
  parcelas: number;
  obsPagamento: string;
  obsGerais: string;
  /** OS de teste: fica fora de todos os números, da exportação para o Google Ads e da Agenda. */
  ehTeste: boolean;
  regraCobranca: string;
  visitaCobranca: number;
  instrucaoManual: string;
};

export const PASSOS = ["Cliente", "Serviço", "Venda"] as const;
export type Passo = 0 | 1 | 2;

export function novoId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function novoItem(groupId?: string): ItemForm {
  return {
    upholstery_type_id: "",
    description: "",
    quantity: "1",
    unit_price: "0,00",
    item_group_id: groupId ?? novoId(),
  };
}

export function novaVisita(tecnicoId = "", hoje = todayISO()): VisitForm {
  return {
    service_type_id: "",
    scheduled_date: hoje,
    scheduled_time: "09:00",
    technician_id: tecnicoId,
    visit_notes: "",
    items: [novoItem()],
  };
}

export function estadoInicial(opcoes: { hoje?: string; ehTeste?: boolean } = {}): EstadoNovaOs {
  const hoje = opcoes.hoje ?? todayISO();
  return {
    osNumber: "",
    saleDate: hoje,
    origemId: "",
    origemCodigo: "",
    indicacaoNome: "",
    origemDetectadaId: "",
    origemDetectadaComo: "",
    taxaRegra: null,
    taxaAuto: true,
    taxaDoOrcamento: null,
    taxaEditadaPor: null,
    taxaEditadaEm: null,
    vendedoraId: "",
    nome: "",
    telefone: "",
    email: "",
    documento: "",
    cep: "",
    rua: "",
    numero: "",
    complemento: "",
    bairro: "",
    cidade: "",
    uf: "",
    referencia: "",
    clienteExistente: null,
    visitas: [novaVisita("", hoje)],
    valorNegociado: "0,00",
    negociadoEditado: false,
    motivoAjuste: "",
    valorTexto: "",
    formaPagamento: "Pix",
    parcelas: 1,
    obsPagamento: "",
    obsGerais: "",
    ehTeste: opcoes.ehTeste ?? false,
    regraCobranca: "",
    visitaCobranca: -1,
    instrucaoManual: "",
  };
}

/** No endereço de teste (nexaos-teste) a OS já nasce marcada como teste. */
export function ehAmbienteDeTeste(hostname: string | null | undefined): boolean {
  return /(^|\.)nexaos-teste[.-]/.test(hostname ?? "") || /^nexaos-teste/.test(hostname ?? "");
}

// ---------------------------------------------------------------- cálculos
/** Quantidade digitada (m² aceita vírgula). */
export function qtdItem(i: ItemForm): number {
  return i.unidade === "m2" ? parseNumberBR(i.quantity) : Number(i.quantity) || 0;
}

/** Item com valor diferente do sugerido pela tabela/regras. */
export function itemEditado(it: ItemForm): boolean {
  const ref = it.preco_referencia ?? it.preco_tabela ?? null;
  if (ref === null || ref === undefined) return Boolean(it.editado_por || it.editado_em);
  return Math.abs(parseNumberBR(it.unit_price) - ref) > 0.004;
}

export function subtotalItem(i: ItemForm): number {
  return Math.max(0, qtdItem(i)) * Math.max(0, parseNumberBR(i.unit_price));
}

export function totalVisita(v: VisitForm): number {
  return Math.round(v.items.reduce((s, i) => s + subtotalItem(i), 0) * 100) / 100;
}

export function somaDasVisitas(visitas: VisitForm[]): number {
  return Math.round(visitas.reduce((s, v) => s + totalVisita(v), 0) * 100) / 100;
}

export function totalDaOs(e: EstadoNovaOs): number {
  return parseNumberBR(e.valorNegociado);
}

export function diferencaDoNegociado(e: EstadoNovaOs): number {
  return Math.round((totalDaOs(e) - somaDasVisitas(e.visitas)) * 100) / 100;
}

export function comissaoPrevista(total: number, pct: number): number {
  return Math.round(((total * pct) / 100) * 100) / 100;
}

export type Servico = { id: string; name: string };

/** Atendimentos no formato da regra de cobrança (nome do serviço e valor). */
export function visitasParaCobranca(e: EstadoNovaOs, servicos: Servico[]): CollectionVisit[] {
  return e.visitas.map((v, idx) => ({
    id: String(idx),
    scheduled_date: v.scheduled_date,
    scheduled_time: v.scheduled_time,
    status: "Agendado",
    service_name: servicos.find((s) => s.id === v.service_type_id)?.name ?? null,
    amount: visitTotal(
      v.items.map((it) => ({
        quantity: normalizarQuantidade(qtdItem(it), it.unidade ?? "un"),
        unit_price: parseNumberBR(it.unit_price),
      })),
    ),
  }));
}

export function regraSugerida(e: EstadoNovaOs, servicos: Servico[]): string {
  return defaultCollectionRule(visitasParaCobranca(e, servicos));
}

/** Soma dos itens acompanha o valor negociado enquanto ninguém mexeu nele. */
export function comNegociadoAtualizado(e: EstadoNovaOs): EstadoNovaOs {
  if (e.negociadoEditado) return e;
  const soma = somaDasVisitas(e.visitas).toFixed(2).replace(".", ",");
  return soma === e.valorNegociado ? e : { ...e, valorNegociado: soma };
}

// ---------------------------------------------------------------- validação
/** Primeira mensagem de erro (mesmas regras e ordem do formulário antigo), ou null. */
export function validar(e: EstadoNovaOs, osDuplicada: boolean): string | null {
  if (!e.osNumber.trim()) return "Informe o número da OS.";
  if (osDuplicada) return "Este número de OS já existe. Use outro número.";
  const erroOrigem = erroDaOrigem(e);
  if (erroOrigem) return erroOrigem;
  if (!e.vendedoraId) return "Selecione a vendedora responsável.";
  if (e.nome.trim().length < 3) return "Informe o nome completo do cliente.";
  if (onlyDigits(e.telefone).length < 10) return "Informe um telefone válido com DDD.";
  if (!e.rua.trim() || !e.numero.trim() || !e.bairro.trim() || !e.cidade.trim() || !e.uf.trim())
    return "Preencha o endereço completo do cliente.";
  if (!e.visitas.length) return "Adicione pelo menos um serviço.";
  for (const [i, v] of e.visitas.entries()) {
    if (!v.service_type_id) return `Selecione o serviço do atendimento ${i + 1}.`;
    if (!v.scheduled_date || !v.scheduled_time)
      return `Informe data e horário do atendimento ${i + 1}.`;
    if (!v.items.length) return `Adicione pelo menos um item no atendimento ${i + 1}.`;
    for (const [j, it] of v.items.entries()) {
      if (!it.upholstery_type_id && !it.description.trim())
        return `Informe o item ${j + 1} do atendimento ${i + 1}.`;
      if (it.unidade === "m2" ? qtdItem(it) <= 0 : qtdItem(it) < 1)
        return `Quantidade inválida no item ${j + 1} do atendimento ${i + 1}.`;
      if (parseNumberBR(it.unit_price) <= 0)
        return `Informe o valor unitário do item ${j + 1} do atendimento ${i + 1}.`;
    }
  }
  const diferenca = diferencaDoNegociado(e);
  if (Math.abs(diferenca) >= 0.01 && e.motivoAjuste.trim().length < 3)
    return "Informe o motivo do ajuste comercial (valor negociado diferente da soma dos itens).";
  if (totalDaOs(e) <= 0) return "O valor negociado da OS deve ser maior que zero.";
  return null;
}

/** Validação por passo (Cliente / Serviço / Venda), para avançar na janela. */
export function validarPasso(e: EstadoNovaOs, passo: Passo): string | null {
  const tudo = validar(
    {
      ...e,
      osNumber: e.osNumber || "x",
      origemId: e.origemId || "x",
      origemCodigo: "",
      vendedoraId: e.vendedoraId || "x",
    },
    false,
  );
  const doCliente = [
    "Informe o nome completo do cliente.",
    "Informe um telefone válido com DDD.",
    "Preencha o endereço completo do cliente.",
  ];
  const doServico = /atendimento|serviço/i;
  if (passo === 0) return tudo && doCliente.includes(tudo) ? tudo : null;
  if (passo === 1) return tudo && !doCliente.includes(tudo) && doServico.test(tudo) ? tudo : null;
  return validar(e, false);
}

// ---------------------------------------------------------------- payload
export type PayloadNovaOs = {
  customer: CustomerInput;
  customerId: string | null;
  order: WorkOrderInput;
  visits: VisitInput[];
  commissionPercentage: number;
};

export type ContextoPayload = {
  userId: string | null;
  /** Instante do salvamento (ISO), para `editado_em` dos itens com preço alterado. */
  agora: string;
  comissaoPct: number;
  servicos: Servico[];
};

export function montarPayload(e: EstadoNovaOs, ctx: ContextoPayload): PayloadNovaOs {
  const totalOS = totalDaOs(e);
  const diferenca = diferencaDoNegociado(e);
  const regra = e.regraCobranca || regraSugerida(e, ctx.servicos);
  const customer: CustomerInput = {
    full_name: e.nome.trim(),
    phone: e.telefone.trim(),
    email: e.email.trim() || null,
    document_number: e.documento.trim() || null,
    postal_code: e.cep.trim() || null,
    street: e.rua.trim(),
    street_number: e.numero.trim(),
    complement: e.complemento.trim() || null,
    neighborhood: e.bairro.trim(),
    city: e.cidade.trim(),
    state: e.uf.trim().toUpperCase(),
    reference_point: e.referencia.trim() || null,
  };
  const order: WorkOrderInput = {
    os_number: e.osNumber.trim(),
    sale_date: e.saleDate,
    sales_origin_id: e.origemId,
    origem_detectada_id: e.origemDetectadaId || null,
    origem_detectada_como: e.origemDetectadaComo || null,
    indicacao_nome: e.origemCodigo === "indicacao" ? e.indicacaoNome.trim() || null : null,
    ...taxaDaOs(e, ctx),
    salesperson_id: e.vendedoraId,
    total_gross_value: totalOS,
    os_value_text: e.valorTexto.trim() || null,
    adjustment_reason: Math.abs(diferenca) >= 0.01 ? e.motivoAjuste.trim() : null,
    manual_total_reason: Math.abs(diferenca) >= 0.01 ? e.motivoAjuste.trim() : null,
    negotiated_payment_method: e.formaPagamento,
    negotiated_installments: e.parcelas,
    general_notes: e.obsGerais.trim() || null,
    eh_teste: e.ehTeste,
    payment_notes: e.obsPagamento.trim() || null,
    collection_rule: regra,
    collection_visit_index: regra === "specific_visit" ? e.visitaCobranca : null,
    payment_instruction: e.instrucaoManual.trim() || null,
  };
  const visits: VisitInput[] = e.visitas.map((v) => ({
    id: v.id ?? null,
    service_type_id: v.service_type_id,
    scheduled_date: v.scheduled_date,
    scheduled_time: v.scheduled_time,
    technician_id: v.technician_id || null,
    visit_notes: v.visit_notes.trim() || null,
    items: v.items.map((it, idx) => ({
      id: it.id ?? null,
      upholstery_type_id: it.upholstery_type_id || null,
      description: it.description.trim() || null,
      quantity: normalizarQuantidade(qtdItem(it), it.unidade ?? "un"),
      unidade: it.unidade ?? "un",
      unit_price: parseNumberBR(it.unit_price),
      item_group_id: it.item_group_id,
      display_order: idx,
      preco_tabela: it.preco_tabela ?? null,
      adicional_pos_fechamento: Boolean(it.adicional),
      ...(itemEditado(it)
        ? {
            editado_por: it.editado_por ?? ctx.userId ?? null,
            editado_em: it.editado_em ?? ctx.agora,
          }
        : { editado_por: null, editado_em: null }),
    })),
  }));
  return {
    customer,
    customerId: e.clienteExistente,
    order,
    visits,
    commissionPercentage: ctx.comissaoPct,
  };
}

// ---------------------------------------------------------------- pré-preenchimento
export type ClienteCadastro = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  document_number: string | null;
  postal_code: string | null;
  street: string | null;
  street_number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  reference_point: string | null;
};

const ou = (atual: string, novo: string | null | undefined) => atual || novo || "";

function comCliente(e: EstadoNovaOs, c: ClienteCadastro): EstadoNovaOs {
  return {
    ...e,
    clienteExistente: c.id,
    email: ou(e.email, c.email),
    documento: ou(e.documento, c.document_number),
    cep: e.cep || onlyDigits(c.postal_code ?? ""),
    rua: ou(e.rua, c.street),
    numero: ou(e.numero, c.street_number),
    complemento: ou(e.complemento, c.complement),
    bairro: ou(e.bairro, c.neighborhood),
    cidade: ou(e.cidade, c.city),
    uf: ou(e.uf, c.state),
    referencia: ou(e.referencia, c.reference_point),
  };
}

/** Descrição do primeiro item do primeiro atendimento, se ainda estiver vazia. */
function comDescricaoNoPrimeiroItem(visitas: VisitForm[], descricao: string): VisitForm[] {
  return visitas.map((v, idx) =>
    idx === 0
      ? {
          ...v,
          items: v.items.map((it, i) =>
            i === 0 && !it.description ? { ...it, description: descricao.slice(0, 200) } : it,
          ),
        }
      : v,
  );
}

export type DadosLead = {
  lead_name: string | null;
  phone: string | null;
  upholstery_description: string | null;
  summary: string | null;
  salesperson_id: string | null;
  sales_origin_id: string | null;
  customer: ClienteCadastro | null;
};

/** Lead do CRM: cliente (do cadastro ligado ou do lead), origem, vendedora e resumo. */
export function aplicarLead(e: EstadoNovaOs, d: DadosLead): EstadoNovaOs {
  let r: EstadoNovaOs = {
    ...e,
    nome: e.nome || d.customer?.full_name || d.lead_name || "",
    telefone: e.telefone || onlyDigits(d.customer?.phone ?? d.phone ?? ""),
    origemId: d.sales_origin_id ? e.origemId || d.sales_origin_id : e.origemId,
    vendedoraId: d.salesperson_id ? e.vendedoraId || d.salesperson_id : e.vendedoraId,
  };
  if (d.customer) r = comCliente(r, d.customer);
  const resumo = [d.upholstery_description, d.summary].filter(Boolean).join(" — ");
  if (resumo) {
    r = {
      ...r,
      obsGerais: r.obsGerais || `Origem: lead do WhatsApp. ${resumo}`.slice(0, 1000),
      visitas: comDescricaoNoPrimeiroItem(r.visitas, d.upholstery_description ?? ""),
    };
  }
  return r;
}

export type DadosVisitaOrcamento = {
  upholstery_description: string | null;
  notes: string | null;
  result_notes: string | null;
  sales_origin_id: string | null;
  technician_id: string | null;
  customer: ClienteCadastro | null;
};

/** Visita de orçamento aprovada: cliente, origem, técnico e resumo. */
export function aplicarOrcamento(e: EstadoNovaOs, d: DadosVisitaOrcamento): EstadoNovaOs {
  let r: EstadoNovaOs = {
    ...e,
    origemId: d.sales_origin_id ? e.origemId || d.sales_origin_id : e.origemId,
  };
  if (d.customer) {
    r = comCliente(
      {
        ...r,
        nome: r.nome || d.customer.full_name,
        telefone: r.telefone || onlyDigits(d.customer.phone ?? ""),
      },
      d.customer,
    );
  }
  const resumo = [d.upholstery_description, d.result_notes, d.notes].filter(Boolean).join(" — ");
  if (resumo)
    r = { ...r, obsGerais: r.obsGerais || `Origem: visita de orçamento. ${resumo}`.slice(0, 1000) };
  if (d.upholstery_description)
    r = { ...r, visitas: comDescricaoNoPrimeiroItem(r.visitas, d.upholstery_description) };
  if (d.technician_id) {
    const tecnico = d.technician_id;
    r = {
      ...r,
      visitas: r.visitas.map((v, idx) =>
        idx === 0 && !v.technician_id ? { ...v, technician_id: tecnico } : v,
      ),
    };
  }
  return r;
}

export type DadosCotacao = {
  cliente_nome: string;
  acrescimo_distancia?: number | null;
  acrescimo_distancia_regra?: number | null;
  acrescimo_distancia_editado_por?: string | null;
  acrescimo_distancia_editado_em?: string | null;
  sales_origin_id?: string | null;
  origem_detectada_id?: string | null;
  origem_detectada_como?: string | null;
  indicacao_nome?: string | null;
  cliente_telefone: string | null;
  cliente_cep: string | null;
  cliente_endereco: string | null;
  data_servico: string | null;
  observacoes: string | null;
  total: number;
};

export type ItemCotacao = {
  nome_snapshot: string;
  tipo_servico: string;
  preco_aplicado: number;
  quantidade: number;
  preco_tabela: number | null;
  preco_sugerido: number | null;
  editado_por: string | null;
  editado_em: string | null;
  adicional_pos_fechamento: boolean;
  categoria: string | null;
};

/** Orçamento (cotação) aprovado: cliente, data e os itens com preço aplicado e selo "editado". */
export function aplicarCotacao(
  e: EstadoNovaOs,
  q: DadosCotacao,
  itens: ItemCotacao[],
  gerarId: () => string = novoId,
): EstadoNovaOs {
  let r: EstadoNovaOs = {
    ...e,
    nome: e.nome || q.cliente_nome,
    telefone: e.telefone || onlyDigits(q.cliente_telefone ?? ""),
    cep: e.cep || onlyDigits(q.cliente_cep ?? ""),
    rua: q.cliente_endereco ? e.rua || q.cliente_endereco : e.rua,
    obsGerais: q.observacoes ? e.obsGerais || q.observacoes.slice(0, 1000) : e.obsGerais,
    // A origem escolhida no orçamento (e a detectada lá) vem junto.
    origemId: e.origemId || q.sales_origin_id || "",
    indicacaoNome: e.indicacaoNome || q.indicacao_nome || "",
    origemDetectadaId: e.origemDetectadaId || q.origem_detectada_id || "",
    origemDetectadaComo: e.origemDetectadaComo || q.origem_detectada_como || "",
  };
  const linhas: ItemForm[] = itens.map((it) => {
    const tabela = Number(it.preco_tabela ?? 0) > 0 ? Number(it.preco_tabela) : null;
    return {
      upholstery_type_id: "",
      description: `${it.nome_snapshot} — ${rotuloServico(it.tipo_servico, it.categoria)}${
        it.adicional_pos_fechamento ? " (adicional)" : ""
      }`.slice(0, 200),
      quantity: String(it.quantidade ?? 1).replace(".", ","),
      unidade: unidadeDaCategoria(it.categoria),
      unit_price: Number(it.preco_aplicado ?? 0)
        .toFixed(2)
        .replace(".", ","),
      item_group_id: gerarId(),
      preco_tabela: tabela,
      preco_referencia: it.preco_sugerido === null ? tabela : Number(it.preco_sugerido),
      editado_por: it.editado_por,
      editado_em: it.editado_em,
      adicional: Boolean(it.adicional_pos_fechamento),
    };
  });
  if (linhas.length) {
    r = {
      ...r,
      visitas: r.visitas.map((v, idx) =>
        idx === 0 ? { ...v, scheduled_date: q.data_servico || v.scheduled_date, items: linhas } : v,
      ),
    };
  }
  // Taxa de deslocamento do orçamento: linha própria, com o valor que o cliente aceitou.
  const taxa = Number(q.acrescimo_distancia ?? 0);
  const regra =
    q.acrescimo_distancia_regra === null || q.acrescimo_distancia_regra === undefined
      ? null
      : Number(q.acrescimo_distancia_regra);
  if (taxa > 0 || regra !== null) {
    r = {
      ...comTaxa(r, taxa),
      taxaRegra: regra ?? taxa,
      taxaAuto: false,
      taxaDoOrcamento: taxa,
      taxaEditadaPor: q.acrescimo_distancia_editado_por ?? null,
      taxaEditadaEm: q.acrescimo_distancia_editado_em ?? null,
    };
  }
  return r;
}

// ---------------------------------------------------------------- taxa de deslocamento
/** Grupo fixo da linha "Taxa de deslocamento" (identifica a linha nos itens). */
export const GRUPO_TAXA_DESLOCAMENTO = "0d15ca00-0000-4000-8000-000000000001";
export const ehTaxaDeslocamento = (it: Pick<ItemForm, "item_group_id">) =>
  it.item_group_id === GRUPO_TAXA_DESLOCAMENTO;

/** Valor cobrado de taxa de deslocamento (as linhas da taxa). */
export function valorDaTaxa(e: EstadoNovaOs): number {
  const centavos = e.visitas
    .flatMap((v) => v.items)
    .filter(ehTaxaDeslocamento)
    .reduce((s, it) => s + Math.round(parseNumberBR(it.unit_price) * qtdItem(it) * 100), 0);
  return centavos / 100;
}

/** Soma dos itens sem a taxa (a base das faixas por valor). */
export function somaSemTaxa(e: EstadoNovaOs): number {
  const centavos = e.visitas
    .flatMap((v) => v.items)
    .filter((it) => !ehTaxaDeslocamento(it) && !it.adicional)
    .reduce((s, it) => s + Math.round(parseNumberBR(it.unit_price) * qtdItem(it) * 100), 0);
  return centavos / 100;
}

/** Põe (ou tira, com 0) a linha da taxa no 1º atendimento. */
export function comTaxa(e: EstadoNovaOs, valor: number): EstadoNovaOs {
  const semTaxa = e.visitas.map((v) => ({
    ...v,
    items: v.items.filter((it) => !ehTaxaDeslocamento(it)),
  }));
  const visitas =
    valor > 0 && semTaxa.length
      ? semTaxa.map((v, i) =>
          i === 0
            ? {
                ...v,
                items: [
                  ...v.items,
                  {
                    upholstery_type_id: "",
                    description: "Taxa de deslocamento",
                    quantity: "1",
                    unidade: "un" as const,
                    unit_price: valor.toFixed(2).replace(".", ","),
                    item_group_id: GRUPO_TAXA_DESLOCAMENTO,
                  },
                ],
              }
            : v,
        )
      : semTaxa;
  return comNegociadoAtualizado({ ...e, visitas });
}

/** Campos da taxa na OS: a cobrada, a da regra e quem alterou/tirou (quando difere da regra). */
export function taxaDaOs(e: EstadoNovaOs, ctx: { userId: string | null; agora: string }) {
  const taxa = valorDaTaxa(e);
  if (e.taxaRegra === null && taxa <= 0) return {};
  const regra = e.taxaRegra;
  const editada = regra === null ? taxa > 0 : Math.abs(taxa - regra) > 0.004;
  const doOrcamento =
    e.taxaDoOrcamento !== null && Math.abs(taxa - e.taxaDoOrcamento) <= 0.004 && e.taxaEditadaPor;
  return {
    taxa_deslocamento: taxa,
    taxa_deslocamento_regra: regra,
    taxa_deslocamento_editada_por: editada ? (doOrcamento ? e.taxaEditadaPor : ctx.userId) : null,
    taxa_deslocamento_editada_em: editada ? (doOrcamento ? e.taxaEditadaEm : ctx.agora) : null,
  };
}

/**
 * Vendedora inicial: a do lead/orçamento quando vier de lá (já aplicada no estado); senão a do
 * cadastro ligado ao login; senão vazio (obrigatório, como hoje).
 */
export function vendedoraInicial(
  atual: string,
  vendedoras: { id: string; user_id?: string | null }[],
  userId: string | null | undefined,
): string {
  if (atual) return atual;
  if (!userId) return "";
  return vendedoras.find((v) => v.user_id === userId)?.id ?? "";
}

/**
 * `/nova-os` sem `editar` nem `classico` abre a janela nova em `/oss?nova=1`, levando lead,
 * orçamento ou cotação. Devolve null quando o formulário antigo deve abrir.
 */
export function destinoDaNovaOs(
  search: Record<string, unknown>,
): { nova: 1; lead?: string; orcamento?: string; cotacao?: string } | null {
  // O roteador converte "?editar=3001" em número: qualquer valor preenchido vale.
  const editar = search["editar"];
  if ((editar !== undefined && editar !== null && editar !== "") || search["classico"]) return null;
  const r: { nova: 1; lead?: string; orcamento?: string; cotacao?: string } = { nova: 1 };
  for (const k of ["lead", "orcamento", "cotacao"] as const) {
    const v = search[k];
    if ((typeof v === "string" || typeof v === "number") && String(v)) r[k] = String(v);
  }
  return r;
}

/** Origem detectada: guarda a detecção e preenche o campo quando ele ainda está vazio. */
export function comDeteccao(
  e: EstadoNovaOs,
  det: OrigemDetectada | null,
  codigo: (id: string) => string,
): EstadoNovaOs {
  if (!det) return e;
  const r = { ...e, origemDetectadaId: det.origemId, origemDetectadaComo: det.como };
  return e.origemId ? r : { ...r, origemId: det.origemId, origemCodigo: codigo(det.origemId) };
}
