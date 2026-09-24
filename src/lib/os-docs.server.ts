import { brl } from "@/lib/format";
import {
  copyFile,
  deleteFile,
  docUrl,
  extractGoogleId,
  fillItemsTable,
  getFile,
  replacePlaceholders,
  stripRemainingPlaceholders,
  type DocItem,
} from "@/lib/google-docs.server";
import { ensureMaterialsFolders } from "@/lib/os-media.server";

const SETTINGS_KEY = "os_document_settings";
export const DEFAULT_NAME_TEMPLATE = "OS {{NUMERO_OS}} - {{NOME_CLIENTE}}";

export type OsDocSettings = {
  enabled: boolean;
  autoGenerate: boolean;
  nameTemplate: string;
  templateHigienizacao: string;
  templateImpermeabilizacao: string;
  templateCombinado: string;
  folderId: string;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function readSettings(): Promise<OsDocSettings> {
  const db = await admin();
  const { data } = await db.from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<OsDocSettings>;
  return {
    enabled: v.enabled ?? false,
    autoGenerate: v.autoGenerate ?? true,
    nameTemplate: v.nameTemplate || DEFAULT_NAME_TEMPLATE,
    templateHigienizacao: v.templateHigienizacao ?? "",
    templateImpermeabilizacao: v.templateImpermeabilizacao ?? "",
    templateCombinado: v.templateCombinado ?? "",
    folderId: v.folderId ?? "",
  };
}

export async function saveSettings(input: {
  enabled: boolean;
  autoGenerate: boolean;
  nameTemplate: string;
  higienizacao: string;
  impermeabilizacao: string;
  combinado: string;
  pasta: string;
}) {
  const current = await readSettings();
  type IdKey = "templateHigienizacao" | "templateImpermeabilizacao" | "templateCombinado" | "folderId";
  const campos: Array<[IdKey, string, string, "doc" | "pasta"]> = [
    ["templateHigienizacao", input.higienizacao, "modelo de higienização", "doc"],
    ["templateImpermeabilizacao", input.impermeabilizacao, "modelo de impermeabilização", "doc"],
    ["templateCombinado", input.combinado, "modelo combinado", "doc"],
    ["folderId", input.pasta, "pasta de destino", "pasta"],
  ];

  const next: OsDocSettings = {
    ...current,
    enabled: input.enabled,
    autoGenerate: input.autoGenerate,
    nameTemplate: input.nameTemplate.trim() || DEFAULT_NAME_TEMPLATE,
  };

  for (const [key, raw, rotulo, tipo] of campos) {
    const texto = (raw ?? "").trim();
    if (!texto) {
      next[key] = "";
      continue;
    }
    const id = extractGoogleId(texto);
    if (!id) throw new Error(`Link ou ID inválido para o ${rotulo}.`);
    const file = await getFile(id);
    if (tipo === "doc" && file.mimeType !== "application/vnd.google-apps.document")
      throw new Error(`O ${rotulo} precisa ser um documento do Google Docs.`);
    if (tipo === "pasta" && file.mimeType !== "application/vnd.google-apps.folder")
      throw new Error(`A ${rotulo} precisa ser uma pasta do Google Drive.`);
    next[key] = id;
  }


  const db = await admin();
  const { error } = await db
    .from("app_settings")
    .upsert({ key: SETTINGS_KEY, value: next as never, updated_at: new Date().toISOString() });
  if (error) throw new Error("Não foi possível salvar as configurações da integração.");
  return { ok: true };
}

export async function testIntegration() {
  const s = await readSettings();
  if (!s.templateHigienizacao || !s.templateImpermeabilizacao || !s.templateCombinado || !s.folderId)
    throw new Error("Integração não configurada. Informe os três modelos e a pasta de destino.");

  for (const [id, rotulo] of [
    [s.templateHigienizacao, "Higienização"],
    [s.templateImpermeabilizacao, "Impermeabilização"],
    [s.templateCombinado, "Higienização e Impermeabilização"],
  ] as const) {
    const file = await getFile(id);
    if (file.mimeType !== "application/vnd.google-apps.document")
      throw new Error(`O modelo de ${rotulo} não é um documento do Google Docs.`);
  }

  const copia = await copyFile(s.templateHigienizacao, "Teste de integração — Turbine Clean", s.folderId);
  await replacePlaceholders(copia.id, { NUMERO_OS: "TESTE" });
  await deleteFile(copia.id);
  return { ok: true };
}

// ---------- dados da OS ----------

type ItemData = {
  description: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
  item_group_id: string | null;
  display_order: number;
  active: boolean;
  upholstery_type: { name: string } | null;
};

type VisitData = {
  status: string;
  visit_value: number;
  final_value: number | null;
  item_quantity: number | null;
  upholstery_description: string | null;
  service_type: { name: string } | null;
  upholstery_type: { name: string } | null;
  service_items: ItemData[];
};

type WorkOrderData = {
  id: string;
  os_number: string;
  updated_at: string;
  total_gross_value: number;
  os_value_text: string | null;
  negotiated_payment_method: string | null;
  negotiated_installments: number | null;
  customer: { full_name: string; phone: string | null } | null;
  visits: VisitData[];
};

const SELECT = `
  id, os_number, updated_at, total_gross_value, os_value_text, negotiated_payment_method,
  negotiated_installments,
  customer:customer_id ( full_name, phone ),
  visits!visits_work_order_id_fkey ( status, visit_value, final_value, item_quantity, upholstery_description,
    service_type:service_type_id ( name ), upholstery_type:upholstery_type_id ( name ),
    service_items ( description, quantity, unit_price, subtotal, item_group_id, display_order, active,
      upholstery_type:upholstery_type_id ( name ) ) )
`;

async function loadWorkOrder(workOrderId: string): Promise<WorkOrderData> {
  const db = await admin();
  const { data, error } = await db.from("work_orders").select(SELECT).eq("id", workOrderId).single();
  if (error || !data) throw new Error("Ordem de serviço não encontrada.");
  return data as unknown as WorkOrderData;
}

function isHig(name: string) {
  return name.toLowerCase().includes("higien");
}
function isImp(name: string) {
  return name.toLowerCase().includes("impermeab");
}

export function templateTypeFor(visits: VisitData[]) {
  const ativos = visits.filter((v) => v.status !== "Cancelado");
  const hig = ativos.some((v) => isHig(v.service_type?.name ?? ""));
  const imp = ativos.some((v) => isImp(v.service_type?.name ?? ""));
  if (hig && imp) return "Higienização e Impermeabilização";
  if (imp) return "Impermeabilização";
  return "Higienização";
}

function itemLabel(v: VisitData) {
  return (v.upholstery_description || v.upholstery_type?.name || "Item").trim();
}

function itemsOf(v: VisitData): ItemData[] {
  return (v.service_items ?? [])
    .filter((i) => i.active !== false && Number(i.quantity) > 0)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
}

function nomeItem(i: ItemData) {
  return (i.description || i.upholstery_type?.name || "Item").trim();
}

function valorUnitario(i: ItemData) {
  const unit = brl(Number(i.unit_price ?? 0));
  return Number(i.quantity) > 1 ? `${unit}/cada` : unit;
}

function buildItems(wo: WorkOrderData, combinado: boolean): DocItem[] {
  const ativos = wo.visits.filter((v) => v.status !== "Cancelado");

  if (!combinado) {
    const linhas: DocItem[] = [];
    for (const v of ativos) {
      const itens = itemsOf(v);
      if (itens.length) {
        for (const i of itens) {
          linhas.push({
            item: nomeItem(i),
            qty: String(i.quantity),
            value: valorUnitario(i),
            valueHig: "",
            valueImp: "",
          });
        }
      } else {
        linhas.push({
          item: itemLabel(v),
          qty: String(v.item_quantity ?? 1),
          value: brl(Number(v.final_value ?? v.visit_value ?? 0)),
          valueHig: "",
          valueImp: "",
        });
      }
    }
    return linhas;
  }

  type Grupo = { item: string; qty: number; hig: number | null; imp: number | null };
  const grupos = new Map<string, Grupo>();
  let avulso = 0;

  for (const v of ativos) {
    const nomeServico = v.service_type?.name ?? "";
    const itens = itemsOf(v);
    const lista: Array<{ nome: string; qty: number; valor: number; grupo: string }> = itens.length
      ? itens.map((i, idx) => ({
          nome: nomeItem(i),
          qty: Number(i.quantity) || 1,
          valor: Number(i.unit_price ?? 0),
          grupo: i.item_group_id || `avulso-${avulso++}-${idx}`,
        }))
      : [
          {
            nome: itemLabel(v),
            qty: v.item_quantity ?? 1,
            valor: Number(v.final_value ?? v.visit_value ?? 0),
            grupo: `avulso-${avulso++}`,
          },
        ];

    for (const l of lista) {
      const atual = grupos.get(l.grupo) ?? { item: l.nome, qty: l.qty, hig: null, imp: null };
      atual.item = atual.item || l.nome;
      atual.qty = Math.max(atual.qty, l.qty);
      if (isHig(nomeServico)) atual.hig = (atual.hig ?? 0) + l.valor;
      else if (isImp(nomeServico)) atual.imp = (atual.imp ?? 0) + l.valor;
      grupos.set(l.grupo, atual);
    }
  }

  return [...grupos.values()].map((g) => {
    const total = (g.hig ?? 0) + (g.imp ?? 0);
    const sufixo = g.qty > 1 ? "/cada" : "";
    return {
      item: g.item,
      qty: String(g.qty || 1),
      value: `${brl(total)}${sufixo}`,
      valueHig: g.hig === null ? "—" : `${brl(g.hig)}${sufixo}`,
      valueImp: g.imp === null ? "—" : `${brl(g.imp)}${sufixo}`,
    };
  });
}

function resumoValor(wo: WorkOrderData) {
  const texto = (wo.os_value_text ?? "").trim();
  if (texto) return texto;
  const total = brl(Number(wo.total_gross_value ?? 0));
  const forma = wo.negotiated_payment_method ?? "";
  const parcelas = Number(wo.negotiated_installments ?? 1);
  if (parcelas > 1) return `${total} em até ${parcelas}x sem juros`;
  if (!forma) return total;
  const prefixo = /pix|dinheiro/i.test(forma) ? "no" : "em";
  return `${total} ${prefixo} ${forma}`;
}

function numeroClienteTexto(phone: string | null | undefined) {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 4) return "";
  return `nº ${digits.slice(-4)}`;
}

function renderName(template: string, wo: WorkOrderData) {
  return template
    .replaceAll("{{NUMERO_OS}}", wo.os_number)
    .replaceAll("{{NOME_CLIENTE}}", wo.customer?.full_name ?? "")
    .trim();
}

export async function loadDocument(workOrderId: string) {
  const db = await admin();
  const { data } = await db
    .from("work_order_documents")
    .select("*")
    .eq("work_order_id", workOrderId)
    .neq("template_type", "Termo de garantia")
    .eq("is_active", true)
    .order("document_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const { data: wo } = await db
    .from("work_orders")
    .select("updated_at")
    .eq("id", workOrderId)
    .maybeSingle();
  const outdated =
    data.generation_status === "Gerado" &&
    Boolean(wo?.updated_at) &&
    Boolean(data.source_updated_at) &&
    new Date(wo!.updated_at).getTime() > new Date(data.source_updated_at!).getTime() + 2000;
  return {
    id: data.id,
    status: outdated ? "Desatualizado" : data.generation_status,
    url: data.google_document_url,
    name: data.document_name,
    version: data.document_version,
    templateType: data.template_type,
    generatedAt: data.generated_at,
    errorMessage: data.error_message,
    outdated,
  };
}

export async function generateDocument(
  workOrderId: string,
  mode: "novo" | "atualizar" | "versao",
  userId: string | null,
) {
  const s = await readSettings();
  if (!s.enabled) throw new Error("A integração com o Google está desativada nas Configurações.");
  if (!s.templateHigienizacao || !s.templateImpermeabilizacao || !s.templateCombinado || !s.folderId)
    throw new Error("Integração não configurada. Informe os três modelos e a pasta de destino.");

  const db = await admin();
  const wo = await loadWorkOrder(workOrderId);
  const anterior = await loadDocument(workOrderId);

  const tipo = templateTypeFor(wo.visits);
  const templateId =
    tipo === "Higienização e Impermeabilização"
      ? s.templateCombinado
      : tipo === "Impermeabilização"
        ? s.templateImpermeabilizacao
        : s.templateHigienizacao;

  const versao = mode === "versao" && anterior ? anterior.version + 1 : (anterior?.version ?? 1);
  const baseName = renderName(s.nameTemplate, wo) || `OS ${wo.os_number}`;
  const nome = versao > 1 ? `${baseName} - V${versao}` : baseName;

  const { data: registro, error: registroError } = await db
    .from("work_order_documents")
    .insert({
      work_order_id: workOrderId,
      template_type: tipo,
      document_name: nome,
      document_version: versao,
      generation_status: "Gerando",
      generated_by: userId,
      is_active: false,
    })
    .select("id")
    .single();
  if (registroError || !registro) throw new Error("Não foi possível registrar a geração do documento.");

  try {
    const pastas = await ensureMaterialsFolders(workOrderId);
    if (!pastas.materials_folder_id) throw new Error("A pasta desta OS não foi criada no Google Drive.");
    const copia = await copyFile(templateId, nome, pastas.materials_folder_id);
    const combinado = tipo === "Higienização e Impermeabilização";

    await replacePlaceholders(copia.id, {
      NUMERO_OS: wo.os_number,
      NOME_CLIENTE: wo.customer?.full_name ?? "",
      NUMERO_CLIENTE_TEXTO: numeroClienteTexto(wo.customer?.phone),
      RESUMO_VALOR: resumoValor(wo),
      FORMA_PAGAMENTO: wo.negotiated_payment_method ?? "",
    });
    await fillItemsTable(copia.id, buildItems(wo, combinado));
    await stripRemainingPlaceholders(copia.id);

    const url = copia.webViewLink ?? docUrl(copia.id);

    await db
      .from("work_order_documents")
      .update({
        google_document_id: copia.id,
        google_document_url: url,
        generation_status: "Gerado",
        generated_at: new Date().toISOString(),
        source_updated_at: wo.updated_at,
        last_synced_at: new Date().toISOString(),
        error_message: null,
        is_active: true,
      })
      .eq("id", registro.id);

    // Registros antigos: "versao" preserva o anterior; "atualizar"/"novo" substituem.
    if (anterior) {
      if (mode === "versao") {
        await db.from("work_order_documents").update({ is_active: true }).eq("id", anterior.id);
      } else {
        await db.from("work_order_documents").delete().eq("id", anterior.id);
      }
    }

    return { ok: true, url, name: nome, version: versao, templateType: tipo };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao gerar o documento.";
    console.error("Falha na geração do documento da OS:", e);
    await db
      .from("work_order_documents")
      .update({ generation_status: "Erro", error_message: msg, is_active: !anterior })
      .eq("id", registro.id);
    throw new Error(msg);
  }
}

// ---------- Termo de garantia da impermeabilização ----------

export const WARRANTY_TYPE = "Termo de garantia";

type WarrantyVisit = {
  status: string;
  scheduled_date: string;
  completion_date: string | null;
  upholstery_description: string | null;
  service_type: { name: string } | null;
  upholstery_type: { name: string } | null;
  technician: { name: string } | null;
  service_items: Array<{
    description: string | null;
    active: boolean;
    quantity: number;
    upholstery_type: { name: string } | null;
  }>;
};

type WarrantyOrder = {
  id: string;
  os_number: string;
  updated_at: string;
  customer: { full_name: string } | null;
  visits: WarrantyVisit[];
};

const WARRANTY_SELECT = `
  id, os_number, updated_at,
  customer:customer_id ( full_name ),
  visits!visits_work_order_id_fkey ( status, scheduled_date, completion_date, upholstery_description,
    service_type:service_type_id ( name ), upholstery_type:upholstery_type_id ( name ),
    technician:technician_id ( name ),
    service_items ( description, active, quantity, upholstery_type:upholstery_type_id ( name ) ) )
`;

function dataBR(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

function maisUmAno(iso: string) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${Number(a) + 1}`;
}

/** Dados do termo: serviço de impermeabilização mais recente da OS. */
function warrantyData(wo: WarrantyOrder) {
  const imper = wo.visits.filter(
    (v) => v.status !== "Cancelado" && isImp(v.service_type?.name ?? ""),
  );
  if (!imper.length) return null;
  const ordenadas = [...imper].sort((a, b) =>
    (a.completion_date ?? a.scheduled_date).localeCompare(b.completion_date ?? b.scheduled_date),
  );
  const ultima = ordenadas[ordenadas.length - 1]!;
  const dataServico = ultima.completion_date ?? ultima.scheduled_date;

  const estofados = new Set<string>();
  for (const v of imper) {
    const itens = (v.service_items ?? []).filter((i) => i.active !== false && Number(i.quantity) > 0);
    if (itens.length) {
      for (const i of itens) {
        const nome = (i.description || i.upholstery_type?.name || "").trim();
        if (nome) estofados.add(Number(i.quantity) > 1 ? `${i.quantity}x ${nome}` : nome);
      }
    } else {
      const nome = (v.upholstery_description || v.upholstery_type?.name || "").trim();
      if (nome) estofados.add(nome);
    }
  }

  return {
    cliente: wo.customer?.full_name ?? "",
    dataServico: dataBR(dataServico),
    proxima: maisUmAno(dataServico),
    tecnico: ultima.technician?.name ?? "",
    estofados: [...estofados].join(", "),
  };
}

function warrantyBlocks(d: NonNullable<ReturnType<typeof warrantyData>>) {
  const b: Array<{ text: string; heading?: 1 | 2; bold?: boolean }> = [];
  b.push({ text: "TERMO DE GARANTIA – SERVIÇO DE IMPERMEABILIZAÇÃO", heading: 1 });
  b.push({ text: "" });
  b.push({ text: `Cliente: ${d.cliente}`, bold: true });
  b.push({ text: `Data do Serviço: ${d.dataServico}`, bold: true });
  b.push({ text: `Técnico Responsável: ${d.tecnico || "—"}`, bold: true });
  b.push({ text: `Estofado(s) Atendido(s): ${d.estofados || "—"}`, bold: true });
  b.push({ text: `DATA DA PRÓXIMA IMPERMEABILIZAÇÃO: ${d.proxima}`, bold: true });
  b.push({ text: "" });
  b.push({ text: "Garantia Turbine Clean – 12 Meses de Proteção e Cuidado", heading: 2 });
  b.push({
    text:
      "A Turbine Clean assegura ao cliente que o serviço de impermeabilização de estofados realizado está coberto por garantia de 1 (um) ano a partir da data do serviço.",
  });
  b.push({ text: "" });
  b.push({ text: "Cobertura da Garantia", heading: 2 });
  b.push({ text: "Durante o período de vigência, o cliente tem direito a:" });
  b.push({
    text:
      "• 1 ano de proteção contra penetração imediata de líquidos (quando limpos corretamente após o derramamento).",
  });
  b.push({
    text: "• 3 visitas técnicas gratuitas, mediante agendamento, para avaliação preventiva ou corretiva.",
  });
  b.push({
    text:
      "• Reaplicação sem custo adicional, caso o serviço tenha sido comprometido por falha de execução ou baixa fixação do produto.",
  });
  b.push({ text: "" });
  b.push({ text: "A Garantia NÃO cobre:", heading: 2 });
  b.push({
    text: "• Danos causados por uso inadequado do estofado (arranhões, rasgos, fogo, corte, tinta, etc.).",
  });
  b.push({
    text:
      "• Problemas decorrentes de limpeza com produtos abrasivos ou sem orientação da Turbine Clean.",
  });
  b.push({
    text: "• Uso do estofado antes da secagem completa (mínimo de 2 horas após a aplicação).",
  });
  b.push({
    text:
      "• Infiltrações/manchas causadas por fluídos corporais de pets/humanos (urina, sangue, fezes, vômito etc).",
  });
  b.push({
    text:
      "• Sujeiras superficiais decorrentes do uso diário, como marcas de mãos, pés, roupas sujas, gordura corporal, poeira, resíduos ou encardimento natural do tecido.",
  });
  b.push({ text: "" });
  b.push({
    text:
      "A impermeabilização tem como principal função proteger o tecido contra a penetração de líquidos e reduzir o risco de manchas permanentes por infiltração, não impedindo o acúmulo de sujeiras superficiais causadas pelo uso cotidiano.",
  });
  b.push({
    text:
      "Para manter o estofado conservado, o cliente deverá seguir corretamente as orientações do Guia de Cuidados Pós-Impermeabilização. Caso deseje, a Turbine Clean poderá realizar limpeza profissional de manutenção mediante cobrança adicional.",
  });
  b.push({ text: "" });
  b.push({ text: "Como Acionar a Garantia", heading: 2 });
  b.push({ text: "Em caso de necessidade, o cliente deverá:" });
  b.push({ text: "• Entrar em contato pelo WhatsApp da Turbine Clean no número: (11) 96807-0853." });
  b.push({ text: "• Enviar foto ou vídeo do problema identificado." });
  b.push({ text: "• Informar nome completo e data do serviço." });
  b.push({
    text: "• Agendar uma das 3 visitas técnicas gratuitas (disponíveis em dias úteis e horário comercial).",
  });
  b.push({ text: "" });
  b.push({ text: "Observações Importantes", heading: 2 });
  b.push({ text: "A garantia é intransferível e válida apenas para o estofado atendido originalmente." });
  b.push({
    text: "O cliente deverá seguir as orientações do Manual Pós-Serviço, entregue junto a este termo.",
  });
  b.push({
    text:
      "Após a aplicação do produto impermeabilizante, é expressamente proibido ao cliente realizar testes por conta própria, como derramar líquidos ou pressionar a superfície propositalmente. Somente o técnico responsável está autorizado a realizar testes de eficácia, seguindo os critérios técnicos e o tempo de cura adequado. Qualquer tentativa de teste feita pelo cliente pode comprometer o desempenho do produto e invalidar a garantia.",
  });
  b.push({ text: "" });
  b.push({ text: "Turbine Clean – Excelência em Higienização e Impermeabilização", bold: true });
  b.push({ text: "Av. Paulista, 726 – sala 1202" });
  b.push({ text: "Instagram: @turbineclean" });
  return b;
}

async function loadWarrantyOrder(workOrderId: string): Promise<WarrantyOrder> {
  const db = await admin();
  const { data, error } = await db
    .from("work_orders")
    .select(WARRANTY_SELECT)
    .eq("id", workOrderId)
    .single();
  if (error || !data) throw new Error("Ordem de serviço não encontrada.");
  return data as unknown as WarrantyOrder;
}

export async function loadWarranty(workOrderId: string) {
  const db = await admin();
  const { data } = await db
    .from("work_order_documents")
    .select("*")
    .eq("work_order_id", workOrderId)
    .eq("template_type", WARRANTY_TYPE)
    .eq("is_active", true)
    .order("document_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const wo = await loadWarrantyOrder(workOrderId).catch(() => null);
  const disponivel = Boolean(wo && warrantyData(wo));
  if (!data) return { available: disponivel, document: null };
  return {
    available: disponivel,
    document: {
      id: data.id,
      status: data.generation_status,
      url: data.google_document_url,
      name: data.document_name,
      version: data.document_version,
      generatedAt: data.generated_at,
      errorMessage: data.error_message,
    },
  };
}

export async function generateWarranty(workOrderId: string, userId: string | null) {
  const s = await readSettings();
  if (!s.enabled) throw new Error("A integração com o Google está desativada nas Configurações.");
  if (!s.folderId) throw new Error("Informe a pasta de destino nas Configurações.");

  const db = await admin();
  const wo = await loadWarrantyOrder(workOrderId);
  const dados = warrantyData(wo);
  if (!dados)
    throw new Error("Esta OS não tem serviço de impermeabilização, então não gera termo de garantia.");

  const anterior = await loadWarranty(workOrderId);
  const versao = (anterior.document?.version ?? 0) + 1;
  const baseNome = `Termo de garantia — OS ${wo.os_number} - ${dados.cliente}`.trim();
  const nome = versao > 1 ? `${baseNome} - V${versao}` : baseNome;

  const { data: registro, error: registroError } = await db
    .from("work_order_documents")
    .insert({
      work_order_id: workOrderId,
      template_type: WARRANTY_TYPE,
      document_name: nome,
      document_version: versao,
      generation_status: "Gerando",
      generated_by: userId,
      is_active: false,
    })
    .select("id")
    .single();
  if (registroError || !registro) throw new Error("Não foi possível registrar a geração do termo.");

  try {
    const { createDocument, moveFile, writeBlocks } = await import("@/lib/google-docs.server");
    const pastas = await ensureMaterialsFolders(workOrderId);
    if (!pastas.materials_folder_id) throw new Error("A pasta desta OS não foi criada no Google Drive.");

    const doc = await createDocument(nome);
    await writeBlocks(doc.documentId, warrantyBlocks(dados));
    await moveFile(doc.documentId, pastas.materials_folder_id);
    const url = docUrl(doc.documentId);

    await db
      .from("work_order_documents")
      .update({
        google_document_id: doc.documentId,
        google_document_url: url,
        generation_status: "Gerado",
        generated_at: new Date().toISOString(),
        source_updated_at: wo.updated_at,
        last_synced_at: new Date().toISOString(),
        error_message: null,
        is_active: true,
      })
      .eq("id", registro.id);

    if (anterior.document) {
      await db.from("work_order_documents").update({ is_active: false }).eq("id", anterior.document.id);
    }

    return { ok: true, url, name: nome, version: versao };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao gerar o termo de garantia.";
    console.error("Falha na geração do termo de garantia:", e);
    await db
      .from("work_order_documents")
      .update({ generation_status: "Erro", error_message: msg })
      .eq("id", registro.id);
    throw new Error(msg);
  }
}

/**
 * Geração automática na conclusão do atendimento: documento da OS e, quando houver
 * impermeabilização, o termo de garantia. Falhas não interrompem a conclusão.
 */
export async function ensureOsDocuments(workOrderId: string, userId: string | null) {
  const resultado = { document: false, warranty: false, errors: [] as string[] };
  try {
    const anterior = await loadDocument(workOrderId);
    await generateDocument(workOrderId, anterior ? "atualizar" : "novo", userId);
    resultado.document = true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao gerar o documento da OS.";
    console.error("Documento automático da OS falhou:", e);
    resultado.errors.push(msg);
  }
  try {
    const wo = await loadWarrantyOrder(workOrderId);
    if (warrantyData(wo)) {
      await generateWarranty(workOrderId, userId);
      resultado.warranty = true;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao gerar o termo de garantia.";
    console.error("Termo de garantia automático falhou:", e);
    resultado.errors.push(msg);
  }
  return resultado;
}
