/**
 * CÓPIA CONGELADA da montagem do formulário antigo (`src/routes/_authenticated/nova-os.tsx`,
 * commit da fase 3), usada só pelo teste de equivalência. As expressões foram copiadas tal
 * qual estavam no `salvar()` e nos efeitos de pré-preenchimento (lead, visita de orçamento e
 * orçamento). Não use em tela; não "melhore": se mudar, o teste deixa de provar equivalência.
 */
import { visitTotal } from "@/lib/os";
import { defaultCollectionRule } from "@/lib/collection";
import { normalizarQuantidade, rotuloServico, unidadeDaCategoria } from "@/lib/unidade";
import { onlyDigits, parseNumberBR } from "@/lib/format";
import type {
  DadosCotacao,
  DadosLead,
  DadosVisitaOrcamento,
  EstadoNovaOs,
  ItemCotacao,
  ItemForm,
  VisitForm,
} from "./estado";

function qtdItem(i: ItemForm): number {
  return i.unidade === "m2" ? parseNumberBR(i.quantity) : Number(i.quantity) || 0;
}
function itemEditado(it: ItemForm): boolean {
  const ref = it.preco_referencia ?? it.preco_tabela ?? null;
  if (ref === null || ref === undefined) return Boolean(it.editado_por || it.editado_em);
  return Math.abs(parseNumberBR(it.unit_price) - ref) > 0.004;
}
function subtotalItem(i: ItemForm) {
  return Math.max(0, qtdItem(i)) * Math.max(0, parseNumberBR(i.unit_price));
}
function totalVisita(v: VisitForm) {
  return Math.round(v.items.reduce((s, i) => s + subtotalItem(i), 0) * 100) / 100;
}

export function montagemAtual(
  e: EstadoNovaOs,
  ctx: {
    userId: string | null;
    agora: string;
    comissaoPct: number;
    servicos: { id: string; name: string }[];
  },
) {
  const {
    osNumber,
    saleDate,
    origemId,
    vendedoraId,
    nome,
    telefone,
    email,
    documento,
    cep,
    rua,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
    referencia,
    clienteExistente,
    visitas,
    valorNegociado,
    motivoAjuste,
    valorTexto,
    formaPagamento,
    parcelas,
    obsPagamento,
    obsGerais,
    ehTeste,
    regraCobranca,
    visitaCobranca,
    instrucaoManual,
  } = e;
  const user = ctx.userId ? { id: ctx.userId } : null;
  const servicos = ctx.servicos;
  const comissaoPct = ctx.comissaoPct;

  // ---- trecho copiado: cálculos
  const somaVisitas = Math.round(visitas.reduce((s, v) => s + totalVisita(v), 0) * 100) / 100;
  const totalOS = parseNumberBR(valorNegociado);
  const diferenca = Math.round((totalOS - somaVisitas) * 100) / 100;
  const visitasCobranca = visitas.map((v, idx) => ({
    id: String(idx),
    scheduled_date: v.scheduled_date,
    scheduled_time: v.scheduled_time,
    status: "Agendado",
    service_name: servicos?.find((s) => s.id === v.service_type_id)?.name ?? null,
    amount: visitTotal(
      v.items.map((it) => ({
        quantity: normalizarQuantidade(qtdItem(it), it.unidade ?? "un"),
        unit_price: parseNumberBR(it.unit_price),
      })),
    ),
  }));
  const regraSugerida = defaultCollectionRule(visitasCobranca);

  // ---- trecho copiado: salvar()
  const customer = {
    full_name: nome.trim(),
    phone: telefone.trim(),
    email: email.trim() || null,
    document_number: documento.trim() || null,
    postal_code: cep.trim() || null,
    street: rua.trim(),
    street_number: numero.trim(),
    complement: complemento.trim() || null,
    neighborhood: bairro.trim(),
    city: cidade.trim(),
    state: uf.trim().toUpperCase(),
    reference_point: referencia.trim() || null,
  };
  const order = {
    os_number: osNumber.trim(),
    sale_date: saleDate,
    sales_origin_id: origemId,
    salesperson_id: vendedoraId,
    total_gross_value: totalOS,
    os_value_text: valorTexto.trim() || null,
    adjustment_reason: Math.abs(diferenca) >= 0.01 ? motivoAjuste.trim() : null,
    manual_total_reason: Math.abs(diferenca) >= 0.01 ? motivoAjuste.trim() : null,
    negotiated_payment_method: formaPagamento,
    negotiated_installments: parcelas,
    general_notes: obsGerais.trim() || null,
    eh_teste: ehTeste,
    payment_notes: obsPagamento.trim() || null,
    collection_rule: regraCobranca || regraSugerida,
    collection_visit_index:
      (regraCobranca || regraSugerida) === "specific_visit" ? visitaCobranca : null,
    payment_instruction: instrucaoManual.trim() || null,
  };
  const visits = visitas.map((v) => ({
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
            editado_por: it.editado_por ?? user?.id ?? null,
            editado_em: it.editado_em ?? ctx.agora,
          }
        : { editado_por: null, editado_em: null }),
    })),
  }));
  return {
    customer,
    customerId: clienteExistente,
    order,
    visits,
    commissionPercentage: comissaoPct,
  };
}

/** Os `setX((prev) => prev || ...)` do efeito do lead, aplicados na mesma ordem. */
export function leadAtual(e: EstadoNovaOs, data: DadosLead): EstadoNovaOs {
  const r = { ...e };
  const cliente = data.customer;
  r.nome = r.nome || cliente?.full_name || data.lead_name || "";
  r.telefone = r.telefone || onlyDigits(cliente?.phone ?? data.phone ?? "");
  if (data.sales_origin_id) r.origemId = r.origemId || data.sales_origin_id!;
  if (data.salesperson_id) r.vendedoraId = r.vendedoraId || data.salesperson_id!;
  if (cliente) {
    r.clienteExistente = cliente.id;
    r.email = r.email || cliente.email || "";
    r.documento = r.documento || cliente.document_number || "";
    r.cep = r.cep || onlyDigits(cliente.postal_code ?? "");
    r.rua = r.rua || cliente.street || "";
    r.numero = r.numero || cliente.street_number || "";
    r.complemento = r.complemento || cliente.complement || "";
    r.bairro = r.bairro || cliente.neighborhood || "";
    r.cidade = r.cidade || cliente.city || "";
    r.uf = r.uf || cliente.state || "";
    r.referencia = r.referencia || cliente.reference_point || "";
  }
  const resumo = [data.upholstery_description, data.summary].filter(Boolean).join(" — ");
  if (resumo) {
    r.obsGerais = r.obsGerais || `Origem: lead do WhatsApp. ${resumo}`.slice(0, 1000);
    r.visitas = r.visitas.map((v, idx) =>
      idx === 0
        ? {
            ...v,
            items: v.items.map((it, i) =>
              i === 0 && !it.description
                ? { ...it, description: (data.upholstery_description ?? "").slice(0, 200) }
                : it,
            ),
          }
        : v,
    );
  }
  return r;
}

/** Efeito da visita de orçamento, na mesma ordem. */
export function orcamentoAtual(e: EstadoNovaOs, data: DadosVisitaOrcamento): EstadoNovaOs {
  const r = { ...e };
  const cliente = data.customer;
  if (data.sales_origin_id) r.origemId = r.origemId || data.sales_origin_id!;
  if (cliente) {
    r.clienteExistente = cliente.id;
    r.nome = r.nome || cliente.full_name;
    r.telefone = r.telefone || onlyDigits(cliente.phone ?? "");
    r.email = r.email || cliente.email || "";
    r.documento = r.documento || cliente.document_number || "";
    r.cep = r.cep || onlyDigits(cliente.postal_code ?? "");
    r.rua = r.rua || cliente.street || "";
    r.numero = r.numero || cliente.street_number || "";
    r.complemento = r.complemento || cliente.complement || "";
    r.bairro = r.bairro || cliente.neighborhood || "";
    r.cidade = r.cidade || cliente.city || "";
    r.uf = r.uf || cliente.state || "";
    r.referencia = r.referencia || cliente.reference_point || "";
  }
  const resumo = [data.upholstery_description, data.result_notes, data.notes]
    .filter(Boolean)
    .join(" — ");
  if (resumo) {
    r.obsGerais = r.obsGerais || `Origem: visita de orçamento. ${resumo}`.slice(0, 1000);
  }
  if (data.upholstery_description) {
    r.visitas = r.visitas.map((v, idx) =>
      idx === 0
        ? {
            ...v,
            items: v.items.map((it, i) =>
              i === 0 && !it.description
                ? { ...it, description: (data.upholstery_description ?? "").slice(0, 200) }
                : it,
            ),
          }
        : v,
    );
  }
  if (data.technician_id) {
    r.visitas = r.visitas.map((v, idx) =>
      idx === 0 && !v.technician_id ? { ...v, technician_id: data.technician_id! } : v,
    );
  }
  return r;
}

/** Efeito do orçamento (cotação), na mesma ordem. */
export function cotacaoAtual(
  e: EstadoNovaOs,
  q: DadosCotacao,
  itens: ItemCotacao[],
  novoId: () => string,
): EstadoNovaOs {
  const r = { ...e };
  r.nome = r.nome || q.cliente_nome;
  r.telefone = r.telefone || onlyDigits(q.cliente_telefone ?? "");
  r.cep = r.cep || onlyDigits(q.cliente_cep ?? "");
  if (q.cliente_endereco) r.rua = r.rua || q.cliente_endereco!;
  if (q.observacoes) r.obsGerais = r.obsGerais || q.observacoes!.slice(0, 1000);

  const linhas = (itens ?? []).map((it) => {
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
      item_group_id: novoId(),
      preco_tabela: tabela,
      preco_referencia: it.preco_sugerido === null ? tabela : Number(it.preco_sugerido),
      editado_por: it.editado_por,
      editado_em: it.editado_em,
      adicional: Boolean(it.adicional_pos_fechamento),
    };
  });

  if (linhas.length) {
    r.visitas = r.visitas.map((v, idx) =>
      idx === 0
        ? {
            ...v,
            scheduled_date: q.data_servico || v.scheduled_date,
            items: linhas,
          }
        : v,
    );
  }
  return r;
}
