/** Regras de orçamento: recálculo de totais, custos e margem. Server-only. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildAddress, geocodeParts, type Coords } from "./geo.server";

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
};

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
  status: "rascunho" | "enviado" | "aprovado" | "recusado" | "convertido";
  items: QuoteItemInput[];
};

export type MargemParams = {
  custoKm: number;
  impostoPct: number;
  custoFixoPorServico: number;
};

const round = (v: number) => Math.round((Number.isFinite(v) ? v : 0) * 100) / 100;

async function settingNumber(db: DB, key: string, fallback: number): Promise<number> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
  const raw = (data?.value ?? null) as unknown;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function costPerKm(db: DB): Promise<number> {
  const n = await settingNumber(db, "cost_per_km", 0.57);
  return n > 0 ? n : 0.57;
}

async function settingText(db: DB, key: string, fallback: string): Promise<string> {
  const { data } = await db.from("app_settings").select("value").eq("key", key).maybeSingle();
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
export async function fixedCostPerService(db: DB): Promise<{
  valor: number;
  fixasMes: number;
  mediaServicos: number;
  mesesCompletos: number;
  mediaHistorico: number;
  fonte: "automatico" | "estimativa" | "manual";
}> {
  const [override, estimativa, origem] = await Promise.all([
    settingNumber(db, "fixed_cost_per_service_override", 0),
    settingNumber(db, "services_per_month_estimate", 34),
    settingText(db, "services_avg_source", "manual"),
  ]);
  const agora = new Date();
  const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;

  const { data: templates } = await db.from("recurring_expenses").select("*");
  const { planRecurringMonth } = await import("./recurring-core");
  const previstas = planRecurringMonth((templates ?? []) as never, mes);
  const fixasMes = round(previstas.reduce((s, p) => s + Number(p.amount ?? 0), 0));

  const inicio = new Date(Date.UTC(agora.getFullYear(), agora.getMonth() - 12, 1))
    .toISOString()
    .slice(0, 10);
  const { data: concluidas } = await db
    .from("visits")
    .select("scheduled_date")
    .eq("status", "Concluído")
    .gte("scheduled_date", inicio);

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
export function computeQuote(input: QuoteInput, params: MargemParams) {
  const { custoKm, impostoPct, custoFixoPorServico } = params;
  const items = input.items.map((it, idx) => {
    const qtd = Math.max(1, Math.round(Number(it.quantidade) || 1));
    const preco = round(Number(it.preco_aplicado) || 0);
    return {
      tabela_preco_item_id: it.tabela_preco_item_id,
      nome_snapshot: it.nome_snapshot,
      tipo_servico: it.tipo_servico,
      preco_tabela: round(Number(it.preco_tabela) || 0),
      preco_aplicado: preco,
      motivo_desconto: it.motivo_desconto?.trim() || null,
      quantidade: qtd,
      subtotal: round(preco * qtd),
      display_order: idx,
    };
  });

  const subtotal = round(items.reduce((s, it) => s + it.subtotal, 0));
  const desconto = Math.min(Math.max(round(Number(input.desconto) || 0), 0), subtotal);
  const total = round(subtotal - desconto);
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

export async function saveQuote(db: DB, input: QuoteInput, userId: string | null) {
  if (!input.cliente_nome.trim()) throw new Error("Informe o nome do cliente.");
  if (!input.items.length) throw new Error("Inclua pelo menos um item no orçamento.");

  const [custoKm, impostoPct, fixo] = await Promise.all([
    costPerKm(db),
    settingNumber(db, "tax_percent", 6),
    fixedCostPerService(db),
  ]);
  const calc = computeQuote(input, { custoKm, impostoPct, custoFixoPorServico: fixo.valor });
  const empresaId = await empresaDoUsuario(db);

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
      input.valor_a_vista && input.valor_a_vista > 0 ? round(input.valor_a_vista) : null,
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
      status: "rascunho",
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
  base: string | null;
  aviso: string | null;
};

/** Estima o km de ida e volta entre a base do técnico e o CEP do cliente. */
export async function estimateKmByCep(db: DB, cepRaw: string): Promise<CepEstimate> {
  const cep = cepRaw.replace(/\D/g, "");
  if (cep.length !== 8) {
    return { cep, endereco: null, km: null, base: null, aviso: "Informe um CEP com 8 dígitos." };
  }

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

  const { data: tecnicos } = await db
    .from("technicians")
    .select("name, base_address, base_latitude, base_longitude")
    .eq("active", true)
    .order("display_order")
    .limit(5);

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
    if (base) {
      return {
        cep,
        endereco,
        km: Math.round(haversine(base, destino) * 2 * 10) / 10,
        base: t.name,
        aviso: null,
      };
    }
  }

  return {
    cep,
    endereco,
    km: null,
    base: null,
    aviso: "Cadastre o endereço-base do técnico para estimar o deslocamento.",
  };
}
