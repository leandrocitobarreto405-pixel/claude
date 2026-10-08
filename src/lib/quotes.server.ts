/** Regras de orçamento: recálculo de totais, custos e margem. Server-only. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildAddress, drivingRoute, geocodeParts, type Coords } from "./geo.server";
import {
  acrescimoDoItem,
  calcularTotais,
  regrasDaLinha,
  type Categoria,
  type Classe,
  type RegrasOrcamento,
} from "./orcamento-regras";

type DB = SupabaseClient<Database>;

export type TipoServico = "higienizacao" | "impermeabilizacao";

export type QuoteItemInput = {
  tabela_preco_item_id: string | null;
  nome_snapshot: string;
  tipo_servico: TipoServico;
  preco_tabela: number;
  preco_aplicado: number;
  motivo_desconto: string | null;
  quantidade: number;
  /** Regras de preço (opcionais; quem não usa, como a Alice, segue igual). */
  categoria?: Categoria | null;
  preco_sugerido?: number | null;
  desconto_regra_valor?: number;
  desconto_regra_texto?: string | null;
  item_principal?: boolean;
  /** Quem editou o valor antes (mantido ao salvar de novo); sem isso, quem salva agora. */
  editado_por?: string | null;
  editado_em?: string | null;
  /** Classe do estofado e acréscimos marcados (só valem se a empresa ligou). */
  classe?: Classe | null;
  almofadas_soltas?: boolean;
  muito_encardido?: boolean;
};

export type DescontoTipo = "campanha" | "indicacao" | "manual";

export type QuoteInput = {
  id?: string | null;
  cliente_nome: string;
  cliente_telefone: string | null;
  cliente_cep: string | null;
  cliente_endereco: string | null;
  customer_id: string | null;
  data_servico: string | null;
  observacoes: string | null;
  desconto: number;
  valor_a_vista: number | null;
  km_ida_volta: number;
  custo_produtos: number;
  custo_mao_obra: number;
  forma_pagamento: string | null;
  parcelas: number;
  taxa_percentual: number;
  preencher_agenda?: boolean;
  /** Lead do CRM. Omitido: mantém o vínculo atual (ou o automático pelo telefone). */
  crm_lead_id?: string | null;
  status: "rascunho" | "enviado" | "aprovado" | "recusado" | "convertido";
  items: QuoteItemInput[];
  /** Regras de preço da empresa (opcionais). */
  cliente_novo?: boolean | null;
  muito_sujo?: boolean;
  distancia_km?: number | null;
  distancia_base?: string | null;
  /** Valores finais da vitrine editados pela atendente (sem isso, os calculados). */
  valor_cartao_editado?: number | null;
  valor_pix_editado?: number | null;
  /** Desconto: campanha OU indicação (percentual das regras de marketing) ou valor manual. */
  desconto_tipo?: DescontoTipo | null;
  desconto_pct?: number | null;
};

export type MargemParams = {
  custoKm: number;
  impostoPct: number;
  custoFixoPorServico: number;
};

const round = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

/** Sem `empresaId`, vale o RLS da empresa ativa; com ele (chave de serviço), filtra pela empresa. */
function daEmpresa<Q extends { eq: (c: string, v: string) => Q }>(q: Q, empresaId?: string): Q {
  return empresaId ? q.eq("empresa_id", empresaId) : q;
}

async function settingNumber(
  db: DB,
  key: string,
  fallback: number,
  empresaId?: string,
): Promise<number> {
  const { data } = await daEmpresa(
    db.from("app_settings").select("value").eq("key", key),
    empresaId,
  ).maybeSingle();
  const raw = (data?.value ?? null) as unknown;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Regras de orçamento da empresa (desligadas quando não há linha). */
export async function regrasOrcamento(db: DB, empresaId?: string): Promise<RegrasOrcamento> {
  const { data } = await daEmpresa(
    db.from("orcamento_configuracoes").select("*"),
    empresaId,
  ).maybeSingle();
  return regrasDaLinha(data as Record<string, unknown> | null);
}

async function costPerKm(db: DB, empresaId?: string): Promise<number> {
  const n = await settingNumber(db, "cost_per_km", 0.57, empresaId);
  return n > 0 ? n : 0.57;
}

async function settingText(
  db: DB,
  key: string,
  fallback: string,
  empresaId?: string,
): Promise<string> {
  const { data } = await daEmpresa(
    db.from("app_settings").select("value").eq("key", key),
    empresaId,
  ).maybeSingle();
  const raw = (data?.value ?? null) as unknown;
  return typeof raw === "string" && raw ? raw : fallback;
}

/**
 * Custo fixo alocado por serviço: despesas fixas previstas do mês ÷ média de serviços por mês.
 * A média usada segue a configuração `services_avg_source`:
 * - "manual" (padrão): usa a média informada em `services_per_month_estimate`.
 * - "automatico": usa a média dos meses CHEIOS com serviços concluídos (o mês corrente,
 *   ainda em andamento, fica fora da conta para não derrubar a média).
 * Override manual do custo fixo tem prioridade sobre tudo.
 */
export async function fixedCostPerService(
  db: DB,
  empresaId?: string,
): Promise<{
  valor: number;
  fixasMes: number;
  mediaServicos: number;
  mesesCompletos: number;
  mediaHistorico: number;
  fonte: "automatico" | "estimativa" | "manual";
}> {
  const [override, estimativa, origem] = await Promise.all([
    settingNumber(db, "fixed_cost_per_service_override", 0, empresaId),
    settingNumber(db, "services_per_month_estimate", 34, empresaId),
    settingText(db, "services_avg_source", "manual", empresaId),
  ]);
  const agora = new Date();
  const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;

  const { data: templates } = await daEmpresa(db.from("recurring_expenses").select("*"), empresaId);
  const { planRecurringMonth } = await import("./recurring-core");
  const previstas = planRecurringMonth((templates ?? []) as never, mes);
  const fixasMes = round(previstas.reduce((s, p) => s + Number(p.amount ?? 0), 0));

  const inicio = new Date(Date.UTC(agora.getFullYear(), agora.getMonth() - 12, 1))
    .toISOString()
    .slice(0, 10);
  const { data: concluidas } = await daEmpresa(
    db.from("visits").select("scheduled_date").eq("status", "Concluído"),
    empresaId,
  ).gte("scheduled_date", inicio);

  const porMes = new Map<string, number>();
  for (const raw of concluidas ?? []) {
    const d = (raw as unknown as { scheduled_date: string | null }).scheduled_date;
    if (!d) continue;
    const k = d.slice(0, 7);
    if (k >= mes) continue; // mês corrente ainda incompleto
    porMes.set(k, (porMes.get(k) ?? 0) + 1);
  }
  const mesesCompletos = porMes.size;
  const mediaHistorico = mesesCompletos
    ? Math.round([...porMes.values()].reduce((s, n) => s + n, 0) / mesesCompletos)
    : 0;

  const usaHistorico = origem === "automatico" && mediaHistorico > 0;
  const mediaServicos = usaHistorico ? mediaHistorico : Math.max(Math.round(estimativa), 0);
  const fonte: "automatico" | "estimativa" | "manual" =
    override > 0 ? "manual" : usaHistorico ? "automatico" : "estimativa";

  if (override > 0) {
    return {
      valor: round(override),
      fixasMes,
      mediaServicos,
      mesesCompletos,
      mediaHistorico,
      fonte,
    };
  }
  return {
    valor: mediaServicos > 0 ? round(fixasMes / mediaServicos) : 0,
    fixasMes,
    mediaServicos,
    mesesCompletos,
    mediaHistorico,
    fonte,
  };
}

async function empresaDoUsuario(db: DB): Promise<string | null> {
  const { data } = await db.rpc("minha_empresa" as never);
  return (data as unknown as string) ?? null;
}

/** Calcula subtotais, total, custos, lucro e margem a partir da entrada crua. */
export function computeQuote(
  input: QuoteInput,
  params: MargemParams & { regras?: RegrasOrcamento; userId?: string | null; agora?: string },
) {
  const { custoKm, impostoPct, custoFixoPorServico } = params;
  const agora = params.agora ?? new Date().toISOString();
  const items = input.items.map((it, idx) => {
    const qtd = Math.max(1, Math.round(Number(it.quantidade) || 1));
    const preco = round(Number(it.preco_aplicado) || 0);
    const tabela = round(Number(it.preco_tabela) || 0);
    const sugerido =
      it.preco_sugerido === null || it.preco_sugerido === undefined
        ? null
        : round(Number(it.preco_sugerido));
    // Editado: o valor final é diferente do sugerido pelas regras (ou da tabela, sem regra).
    const referencia = sugerido ?? (tabela > 0 ? tabela : null);
    const editado = referencia !== null && Math.abs(preco - referencia) > 0.004;
    // Classe e acréscimos: o percentual é refeito aqui pelas regras da empresa (não vem da tela).
    const regrasItem = params.regras;
    const classe = regrasItem?.classe.ligada ? (it.classe ?? "B") : null;
    const almofadas_soltas = Boolean(regrasItem?.acrescimos.ligado && it.almofadas_soltas);
    const muito_encardido = Boolean(regrasItem?.acrescimos.ligado && it.muito_encardido);
    const acrescimo_pct = regrasItem
      ? acrescimoDoItem(regrasItem, {
          classe,
          almofadasSoltas: almofadas_soltas,
          muitoEncardido: muito_encardido,
        })
      : 0;
    return {
      tabela_preco_item_id: it.tabela_preco_item_id,
      nome_snapshot: it.nome_snapshot,
      tipo_servico: it.tipo_servico,
      preco_tabela: tabela,
      preco_aplicado: preco,
      motivo_desconto: it.motivo_desconto?.trim() || null,
      quantidade: qtd,
      subtotal: round(preco * qtd),
      display_order: idx,
      categoria: it.categoria ?? null,
      preco_sugerido: sugerido,
      desconto_regra_valor: round(Number(it.desconto_regra_valor) || 0),
      desconto_regra_texto: it.desconto_regra_texto?.trim() || null,
      item_principal: Boolean(it.item_principal),
      editado_por: editado ? (it.editado_por ?? params.userId ?? null) : null,
      editado_em: editado ? (it.editado_em ?? agora) : null,
      classe,
      almofadas_soltas,
      muito_encardido,
      acrescimo_pct,
    };
  });

  const subtotal = round(items.reduce((s, it) => s + it.subtotal, 0));
  const regras = params.regras;
  // Campanha ou indicação: o valor sai do percentual (nunca os dois); manual: o valor digitado.
  const descontoTipo =
    input.desconto_tipo === "campanha" ||
    input.desconto_tipo === "indicacao" ||
    input.desconto_tipo === "manual"
      ? input.desconto_tipo
      : null;
  const descontoPct =
    descontoTipo && descontoTipo !== "manual" && Number(input.desconto_pct) > 0
      ? round(Number(input.desconto_pct))
      : null;
  const totais = regras
    ? calcularTotais({
        linhas: items.map((it) => ({
          categoria: (it.categoria ?? "outro") as Categoria,
          precoAplicado: it.preco_aplicado,
          quantidade: it.quantidade,
        })),
        regras,
        muitoSujo: Boolean(input.muito_sujo),
        distanciaKm:
          input.distancia_km === null || input.distancia_km === undefined
            ? null
            : Number(input.distancia_km),
        desconto: Number(input.desconto) || 0,
        descontoPct: descontoPct,
        clienteNovo: input.cliente_novo !== false,
      })
    : null;
  const desconto = totais
    ? totais.desconto
    : Math.min(
        Math.max(
          descontoPct !== null
            ? round((subtotal * descontoPct) / 100)
            : round(Number(input.desconto) || 0),
          0,
        ),
        subtotal,
      );
  const vitrine = totais?.vitrine ?? null;
  const cartaoEditado =
    vitrine && input.valor_cartao_editado && input.valor_cartao_editado > 0
      ? round(input.valor_cartao_editado)
      : null;
  const pixEditado =
    vitrine && input.valor_pix_editado && input.valor_pix_editado > 0
      ? round(input.valor_pix_editado)
      : null;
  const valor_cartao = vitrine ? (cartaoEditado ?? vitrine.cartao) : null;
  const valor_pix = vitrine ? (pixEditado ?? vitrine.pix) : null;
  // Com vitrine, o total do orçamento é o valor no cartão e o à vista é o Pix.
  const total = vitrine
    ? round(valor_cartao ?? 0)
    : round(totais ? totais.base : subtotal - desconto);
  const km = Math.max(round(Number(input.km_ida_volta) || 0), 0);
  const custo_deslocamento = round(km * custoKm);
  const custo_produtos = Math.max(round(Number(input.custo_produtos) || 0), 0);
  const custo_mao_obra = Math.max(round(Number(input.custo_mao_obra) || 0), 0);
  const parcelas = Math.min(Math.max(Math.round(Number(input.parcelas) || 1), 1), 5);
  const forma_pagamento = input.forma_pagamento?.trim() || (parcelas > 1 ? "Maquininha" : null);
  const taxa_percentual =
    forma_pagamento === "Maquininha" ? Math.max(round(Number(input.taxa_percentual) || 0), 0) : 0;
  const custo_taxa = round((total * taxa_percentual) / 100);
  const custo_imposto = round((total * Math.max(impostoPct, 0)) / 100);
  const custo_fixo_alocado = round(Math.max(custoFixoPorServico, 0));
  const custo_total = round(
    custo_deslocamento +
      custo_produtos +
      custo_mao_obra +
      custo_taxa +
      custo_imposto +
      custo_fixo_alocado,
  );
  const margem_valor = round(total - custo_total);
  const margem_percentual = total > 0 ? round((margem_valor / total) * 100) : 0;
  const contribuicao_valor = round(
    total - (custo_deslocamento + custo_produtos + custo_mao_obra + custo_taxa + custo_imposto),
  );
  const contribuicao_percentual = total > 0 ? round((contribuicao_valor / total) * 100) : 0;

  return {
    regrasAplicadas: {
      desconto_tipo: desconto > 0 ? descontoTipo : null,
      desconto_pct: desconto > 0 ? descontoPct : null,
      cliente_novo: input.cliente_novo ?? null,
      muito_sujo: Boolean(input.muito_sujo && totais && totais.acrescimoSujidade > 0),
      acrescimo_sujidade: totais?.acrescimoSujidade ?? 0,
      distancia_km:
        input.distancia_km === null || input.distancia_km === undefined
          ? null
          : round(Number(input.distancia_km)),
      distancia_base: input.distancia_base?.trim() || null,
      acrescimo_distancia: totais?.acrescimoDistancia ?? 0,
      fora_da_area: totais?.foraDaArea ?? false,
      minimo_aplicado: totais?.minimoAplicado ?? 0,
      valor_vitrine: vitrine?.vitrine ?? null,
      valor_cartao,
      valor_pix,
      valores_editados_por:
        cartaoEditado !== null || pixEditado !== null ? (params.userId ?? null) : null,
    },
    preencher_agenda: Boolean(input.preencher_agenda),
    contribuicao_valor,
    contribuicao_percentual,
    items,
    subtotal,
    desconto,
    total,
    km_ida_volta: km,
    custo_deslocamento,
    custo_produtos,
    custo_mao_obra,
    forma_pagamento,
    parcelas,
    taxa_percentual,
    custo_taxa,
    custo_imposto,
    custo_fixo_alocado,
    custo_total,
    margem_valor,
    margem_percentual,
    lucro_valor: margem_valor,
    lucro_percentual: margem_percentual,
  };
}

/** `empresaId`: só para quem usa a chave de serviço (a Alice); telas usam o RLS da empresa ativa. */
export async function saveQuote(
  db: DB,
  input: QuoteInput,
  userId: string | null,
  empresaId?: string,
) {
  if (!input.cliente_nome.trim()) throw new Error("Informe o nome do cliente.");
  if (!input.items.length) throw new Error("Inclua pelo menos um item no orçamento.");

  const [custoKm, impostoPct, fixo, regras] = await Promise.all([
    costPerKm(db, empresaId),
    settingNumber(db, "tax_percent", 6, empresaId),
    fixedCostPerService(db, empresaId),
    regrasOrcamento(db, empresaId),
  ]);
  const calc = computeQuote(input, {
    custoKm,
    impostoPct,
    custoFixoPorServico: fixo.valor,
    regras,
    userId,
  });
  empresaId ??= (await empresaDoUsuario(db)) ?? undefined;

  const row = {
    cliente_nome: input.cliente_nome.trim(),
    cliente_telefone: input.cliente_telefone?.replace(/\D/g, "") || null,
    cliente_cep: input.cliente_cep?.replace(/\D/g, "") || null,
    cliente_endereco: input.cliente_endereco?.trim() || null,
    customer_id: input.customer_id,
    data_servico: input.data_servico || null,
    observacoes: input.observacoes?.trim() || null,
    subtotal: calc.subtotal,
    desconto: calc.desconto,
    total: calc.total,
    valor_a_vista:
      calc.regrasAplicadas.valor_pix !== null
        ? calc.regrasAplicadas.valor_pix
        : input.valor_a_vista && input.valor_a_vista > 0
          ? round(input.valor_a_vista)
          : null,
    ...calc.regrasAplicadas,
    km_ida_volta: calc.km_ida_volta,
    custo_deslocamento: calc.custo_deslocamento,
    custo_produtos: calc.custo_produtos,
    custo_mao_obra: calc.custo_mao_obra,
    custo_total: calc.custo_total,
    margem_valor: calc.margem_valor,
    margem_percentual: calc.margem_percentual,
    forma_pagamento: calc.forma_pagamento,
    parcelas: calc.parcelas,
    taxa_percentual: calc.taxa_percentual,
    custo_taxa: calc.custo_taxa,
    custo_imposto: calc.custo_imposto,
    custo_fixo_alocado: calc.custo_fixo_alocado,
    lucro_valor: calc.lucro_valor,
    lucro_percentual: calc.lucro_percentual,
    preencher_agenda: calc.preencher_agenda,
    contribuicao_valor: calc.contribuicao_valor,
    contribuicao_percentual: calc.contribuicao_percentual,
    status: input.status,
    ...(input.crm_lead_id !== undefined ? { crm_lead_id: input.crm_lead_id } : {}),
    ...(empresaId ? { empresa_id: empresaId } : {}),
  };

  let quoteId = input.id ?? null;
  if (quoteId) {
    const { error } = await db
      .from("quotes")
      .update(row as never)
      .eq("id", quoteId);
    if (error) throw error;
    const { error: delErr } = await db.from("quote_items").delete().eq("quote_id", quoteId);
    if (delErr) throw delErr;
  } else {
    const { data, error } = await db
      .from("quotes")
      .insert({ ...row, created_by: userId } as never)
      .select("id")
      .single();
    if (error) throw error;
    quoteId = (data as { id: string }).id;
  }

  const { error: itemsErr } = await db.from("quote_items").insert(
    calc.items.map((it) => ({
      ...it,
      quote_id: quoteId,
      ...(empresaId ? { empresa_id: empresaId } : {}),
    })) as never,
  );
  if (itemsErr) throw itemsErr;

  return { id: quoteId, ...calc };
}

export async function duplicateQuote(db: DB, id: string, userId: string | null) {
  const { data: q, error } = await db.from("quotes").select("*").eq("id", id).single();
  if (error) throw error;
  const { data: items, error: itemsErr } = await db
    .from("quote_items")
    .select("*")
    .eq("quote_id", id)
    .order("display_order");
  if (itemsErr) throw itemsErr;

  const orig = q as unknown as Record<string, unknown>;
  return saveQuote(
    db,
    {
      cliente_nome: `${String(orig["cliente_nome"] ?? "")} (cópia)`.slice(0, 120),
      cliente_telefone: (orig["cliente_telefone"] as string | null) ?? null,
      cliente_cep: (orig["cliente_cep"] as string | null) ?? null,
      cliente_endereco: (orig["cliente_endereco"] as string | null) ?? null,
      customer_id: (orig["customer_id"] as string | null) ?? null,
      data_servico: (orig["data_servico"] as string | null) ?? null,
      observacoes: (orig["observacoes"] as string | null) ?? null,
      desconto: Number(orig["desconto"] ?? 0),
      valor_a_vista: orig["valor_a_vista"] === null ? null : Number(orig["valor_a_vista"]),
      km_ida_volta: Number(orig["km_ida_volta"] ?? 0),
      custo_produtos: Number(orig["custo_produtos"] ?? 0),
      custo_mao_obra: Number(orig["custo_mao_obra"] ?? 0),
      forma_pagamento: (orig["forma_pagamento"] as string | null) ?? null,
      parcelas: Number(orig["parcelas"] ?? 1),
      taxa_percentual: Number(orig["taxa_percentual"] ?? 0),
      preencher_agenda: Boolean(orig["preencher_agenda"] ?? false),
      crm_lead_id: (orig["crm_lead_id"] as string | null) ?? null,
      status: "rascunho",
      cliente_novo: (orig["cliente_novo"] as boolean | null) ?? null,
      muito_sujo: Boolean(orig["muito_sujo"] ?? false),
      distancia_km: orig["distancia_km"] === null ? null : Number(orig["distancia_km"]),
      distancia_base: (orig["distancia_base"] as string | null) ?? null,
      desconto_tipo: (orig["desconto_tipo"] as DescontoTipo | null) ?? null,
      desconto_pct: orig["desconto_pct"] === null ? null : Number(orig["desconto_pct"]),
      items: (items ?? []).map((raw) => {
        const it = raw as unknown as Record<string, unknown>;
        return {
          tabela_preco_item_id: (it["tabela_preco_item_id"] as string | null) ?? null,
          nome_snapshot: String(it["nome_snapshot"] ?? ""),
          tipo_servico: it["tipo_servico"] as TipoServico,
          preco_tabela: Number(it["preco_tabela"] ?? 0),
          preco_aplicado: Number(it["preco_aplicado"] ?? 0),
          motivo_desconto: (it["motivo_desconto"] as string | null) ?? null,
          quantidade: Number(it["quantidade"] ?? 1),
          categoria: (it["categoria"] as Categoria | null) ?? null,
          preco_sugerido: it["preco_sugerido"] === null ? null : Number(it["preco_sugerido"]),
          desconto_regra_valor: Number(it["desconto_regra_valor"] ?? 0),
          desconto_regra_texto: (it["desconto_regra_texto"] as string | null) ?? null,
          item_principal: Boolean(it["item_principal"] ?? false),
          classe: (it["classe"] as Classe | null) ?? null,
          almofadas_soltas: Boolean(it["almofadas_soltas"] ?? false),
          muito_encardido: Boolean(it["muito_encardido"] ?? false),
        };
      }),
    },
    userId,
  );
}

function haversine(a: Coords, b: Coords) {
  const R = 6371;
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}

export type CepEstimate = {
  cep: string;
  endereco: string | null;
  km: number | null;
  /** Só a ida, da base do técnico mais próximo (para o acréscimo por distância). */
  kmIda?: number | null;
  base: string | null;
  aviso: string | null;
  /** "ruas": distância pelas ruas (ida e volta); "linha_reta": aproximação quando o roteador falha. */
  metodo?: "ruas" | "linha_reta";
};

/** Endereço do CEP (ViaCEP) e as partes para localizar no mapa. */
export async function enderecoDoCep(cep: string) {
  let parts: Parameters<typeof geocodeParts>[0] = { postal_code: cep };
  let endereco: string | null = null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (res.ok) {
      const via = (await res.json()) as {
        erro?: boolean | string;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (!via.erro) {
        parts = {
          street: via.logradouro ?? null,
          neighborhood: via.bairro ?? null,
          city: via.localidade ?? null,
          state: via.uf ?? null,
          postal_code: cep,
        };
        endereco = buildAddress(parts);
      }
    }
  } catch {
    /* segue com o CEP puro */
  }

  return { parts, endereco };
}

/** Coordenadas aproximadas de um CEP (para comparar distâncias); null se não achar. */
export async function coordenadasDoCep(cepRaw: string): Promise<Coords | null> {
  const cep = cepRaw.replace(/\D/g, "");
  if (cep.length !== 8) return null;
  const { parts } = await enderecoDoCep(cep);
  return geocodeParts(parts);
}

/** Estima o km de ida e volta entre a base do técnico e o CEP do cliente. */
export async function estimateKmByCep(
  db: DB,
  cepRaw: string,
  empresaId?: string,
): Promise<CepEstimate> {
  const cep = cepRaw.replace(/\D/g, "");
  if (cep.length !== 8) {
    return { cep, endereco: null, km: null, base: null, aviso: "Informe um CEP com 8 dígitos." };
  }

  const { parts, endereco } = await enderecoDoCep(cep);
  const destino = await geocodeParts(parts);
  if (!destino) {
    return {
      cep,
      endereco,
      km: null,
      base: null,
      aviso: "Não foi possível localizar esse CEP no mapa.",
    };
  }

  const { data: tecnicos } = await daEmpresa(
    db
      .from("technicians")
      .select("name, base_address, base_latitude, base_longitude")
      .eq("active", true),
    empresaId,
  )
    .order("display_order")
    .limit(10);

  // Base do técnico mais próximo do cliente (em linha reta); depois a rota pelas ruas.
  let maisPerto: { nome: string; coords: Coords; reta: number } | null = null;
  for (const raw of tecnicos ?? []) {
    const t = raw as unknown as {
      name: string;
      base_address: string | null;
      base_latitude: number | null;
      base_longitude: number | null;
    };
    let base: Coords | null =
      t.base_latitude !== null && t.base_longitude !== null
        ? { lat: Number(t.base_latitude), lon: Number(t.base_longitude) }
        : null;
    if (!base && t.base_address) base = await geocodeParts({ full_address: t.base_address });
    if (!base) continue;
    const reta = haversine(base, destino);
    if (!maisPerto || reta < maisPerto.reta) maisPerto = { nome: t.name, coords: base, reta };
  }
  if (maisPerto) {
    // Pelas ruas: base → cliente → base. Sem resposta do roteador, linha reta × 2.
    const rota = await drivingRoute([
      { label: maisPerto.nome, coords: maisPerto.coords },
      { label: "Cliente", coords: destino },
      { label: maisPerto.nome, coords: maisPerto.coords },
    ]);
    const pelasRuas = rota && rota.totalKm > 0;
    const km = pelasRuas ? rota.totalKm : Math.round(maisPerto.reta * 2 * 10) / 10;
    return {
      cep,
      endereco,
      km,
      kmIda: Math.round((km / 2) * 10) / 10,
      base: maisPerto.nome,
      aviso: null,
      metodo: pelasRuas ? "ruas" : "linha_reta",
    };
  }

  return {
    cep,
    endereco,
    km: null,
    base: null,
    aviso: "Cadastre o endereço-base do técnico para estimar o deslocamento.",
  };
}
