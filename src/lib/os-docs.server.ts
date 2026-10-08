import { brl } from "@/lib/format";
import {
  copyFile,
  deleteFile,
  docUrl,
  enviarParaLixeira,
  extractGoogleId,
  fillItemsTable,
  getFile,
  listarDocumentosDaPasta,
  moveFile,
  renameFile,
  replacePlaceholders,
  stripRemainingPlaceholders,
  type DocItem,
} from "@/lib/google-docs.server";
import { ensureInternalFolder, ensureMaterialsFolders } from "@/lib/os-media.server";
import { escolherSubstituidos, nomeSubstituido } from "@/lib/os-docs-versoes";
import { SEM_MODELO_GARANTIA } from "@/lib/os-docs-campos";
import { bancoDaEmpresa, contextoEmpresa } from "@/lib/request-db.server";

const SETTINGS_KEY = "os_document_settings";
export const DEFAULT_NAME_TEMPLATE = "OS {{NUMERO_OS}} - {{NOME_CLIENTE}}";

export type OsDocSettings = {
  enabled: boolean;
  autoGenerate: boolean;
  nameTemplate: string;
  templateHigienizacao: string;
  templateImpermeabilizacao: string;
  templateCombinado: string;
  /** Modelo do termo de garantia da impermeabilização (vazio = termo não é gerado). */
  templateGarantia: string;
  folderId: string;
};

/** Banco da requisição: cliente do usuário, restrito pelo RLS à empresa ativa. */
async function admin() {
  return bancoDaEmpresa();
}

export type DadosEmpresa = { nome: string; telefone: string | null; instagram: string | null };

/** Nome e contatos da empresa ativa, usados nos textos dos documentos. */
export async function dadosEmpresa(): Promise<DadosEmpresa> {
  const db = await admin();
  const { empresaId } = contextoEmpresa();
  const [{ data: empresa }, { data: config }] = await Promise.all([
    db.from("empresas").select("nome, telefone").eq("id", empresaId).maybeSingle(),
    db
      .from("app_settings")
      .select("value")
      .eq("empresa_id", empresaId)
      .eq("key", "company")
      .maybeSingle(),
  ]);
  const v = (config?.value ?? {}) as { name?: string; phone?: string; instagram?: string };
  return {
    nome: v.name || empresa?.nome || "Empresa",
    telefone: v.phone || empresa?.telefone || null,
    instagram: v.instagram || null,
  };
}

export async function readSettings(): Promise<OsDocSettings> {
  const db = await admin();
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("empresa_id", contextoEmpresa().empresaId)
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  const v = (data?.value ?? {}) as Partial<OsDocSettings>;
  return {
    enabled: v.enabled ?? false,
    autoGenerate: v.autoGenerate ?? true,
    nameTemplate: v.nameTemplate || DEFAULT_NAME_TEMPLATE,
    templateHigienizacao: v.templateHigienizacao ?? "",
    templateImpermeabilizacao: v.templateImpermeabilizacao ?? "",
    templateCombinado: v.templateCombinado ?? "",
    templateGarantia: v.templateGarantia ?? "",
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
  /** Omitido: mantém o modelo do termo salvo. */
  garantia?: string;
  pasta: string;
}) {
  const current = await readSettings();
  type IdKey =
    | "templateHigienizacao"
    | "templateImpermeabilizacao"
    | "templateCombinado"
    | "templateGarantia"
    | "folderId";
  const campos: Array<[IdKey, string, string, "doc" | "pasta"]> = [
    ["templateHigienizacao", input.higienizacao, "modelo de higienização", "doc"],
    ["templateImpermeabilizacao", input.impermeabilizacao, "modelo de impermeabilização", "doc"],
    ["templateCombinado", input.combinado, "modelo combinado", "doc"],
    ["folderId", input.pasta, "pasta de destino", "pasta"],
  ];
  if (input.garantia !== undefined)
    campos.push(["templateGarantia", input.garantia, "modelo do termo de garantia", "doc"]);

  const next: OsDocSettings = {
    ...current,
    enabled: input.enabled,
    autoGenerate: input.autoGenerate,
    nameTemplate: input.nameTemplate.trim() || DEFAULT_NAME_TEMPLATE,
  };

  for (const [key, raw, rotulo, tipo] of campos) {
    const texto = (raw ?? "").trim();
    // Em branco mantém o que já está salvo (a tela limpa os campos depois de salvar).
    if (!texto) continue;
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
    .upsert(
      { key: SETTINGS_KEY, value: next as never, updated_at: new Date().toISOString() },
      { onConflict: "empresa_id,key" },
    );
  if (error) throw new Error("Não foi possível salvar as configurações da integração.");
  return { ok: true };
}

export async function testIntegration() {
  const s = await readSettings();
  if (
    !s.templateHigienizacao ||
    !s.templateImpermeabilizacao ||
    !s.templateCombinado ||
    !s.folderId
  )
    throw new Error("Integração não configurada. Informe os três modelos e a pasta de destino.");

  for (const [id, rotulo] of [
    [s.templateHigienizacao, "Higienização"],
    [s.templateImpermeabilizacao, "Impermeabilização"],
    [s.templateCombinado, "Higienização e Impermeabilização"],
    ...(s.templateGarantia ? ([[s.templateGarantia, "Termo de garantia"]] as const) : []),
  ] as const) {
    const file = await getFile(id);
    if (file.mimeType !== "application/vnd.google-apps.document")
      throw new Error(`O modelo de ${rotulo} não é um documento do Google Docs.`);
  }

  const { nome: empresa } = await dadosEmpresa();
  const copia = await copyFile(
    s.templateHigienizacao,
    `Teste de integração — ${empresa}`,
    s.folderId,
  );
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
  const { data, error } = await db
    .from("work_orders")
    .select(SELECT)
    .eq("id", workOrderId)
    .single();
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

/**
 * Um documento só na pasta do cliente (a pasta é compartilhada com ele): fica o gerado mais
 * recente e os anteriores, da OS ou do termo, vão para a pasta "Controle interno" da OS. Falha
 * aqui não desfaz a geração; o que não saiu sai na próxima.
 */
async function manterUmDocumento(input: {
  workOrderId: string;
  garantia: boolean;
  base: string;
  pastaCliente: string;
}) {
  const db = await admin();
  const consulta = db
    .from("work_order_documents")
    .select(
      "id, created_at, google_document_id, google_document_url, generation_status, is_active, document_name, document_version, template_type",
    )
    .eq("work_order_id", input.workOrderId);
  const { data } = await (input.garantia
    ? consulta.eq("template_type", WARRANTY_TYPE)
    : consulta.neq("template_type", WARRANTY_TYPE));
  const registros = data ?? [];
  const arquivos = await listarDocumentosDaPasta(input.pastaCliente).catch((e) => {
    console.error("Não consegui listar a pasta da OS no Drive:", e);
    return [];
  });
  const escolha = escolherSubstituidos({ registros, arquivos, base: input.base });
  if (!escolha.vencedor) return null;

  const naoSaiu = new Set<string>();
  if (escolha.arquivos.length) {
    const nomes = new Map<string, string>(arquivos.map((a) => [a.id, a.name]));
    for (const r of registros)
      if (r.google_document_id && r.document_name && !nomes.has(r.google_document_id))
        nomes.set(r.google_document_id, r.document_name);
    const agora = new Date();
    let interna: string | null = null;
    for (const id of escolha.arquivos) {
      try {
        const pasta = (interna ??= await ensureInternalFolder(input.workOrderId));
        await moveFile(id, pasta);
        await renameFile(id, nomeSubstituido(nomes.get(id) ?? input.base, agora));
      } catch (e) {
        // Arquivo que já não existe no Drive não precisa sair; o resto tenta de novo depois.
        const sumiu = e instanceof Error && /não encontrado/i.test(e.message);
        if (!sumiu) naoSaiu.add(id);
        console.error("Documento anterior não saiu da pasta do cliente:", id, e);
      }
    }
  }
  const substituidos = escolha.registros
    .filter((r) => !naoSaiu.has(r.google_document_id!))
    .map((r) => r.id);
  if (substituidos.length)
    await db
      .from("work_order_documents")
      .update({ is_active: false, generation_status: "Substituído" })
      .in("id", substituidos);
  // Tentativa antiga que deu erro deixa de aparecer no lugar do documento que ficou.
  const errosAntigos = registros
    .filter((r) => r.is_active && r.generation_status === "Erro" && r.id !== escolha.vencedor!.id)
    .map((r) => r.id);
  if (errosAntigos.length)
    await db.from("work_order_documents").update({ is_active: false }).in("id", errosAntigos);
  return registros.find((r) => r.id === escolha.vencedor!.id)!;
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
    .order("created_at", { ascending: false })
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
  if (
    !s.templateHigienizacao ||
    !s.templateImpermeabilizacao ||
    !s.templateCombinado ||
    !s.folderId
  )
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
      empresa_id: contextoEmpresa().empresaId,
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
  if (registroError || !registro)
    throw new Error("Não foi possível registrar a geração do documento.");

  let copiaId: string | null = null;
  try {
    const pastas = await ensureMaterialsFolders(workOrderId);
    if (!pastas.materials_folder_id)
      throw new Error("A pasta desta OS não foi criada no Google Drive.");
    const copia = await copyFile(templateId, nome, pastas.materials_folder_id);
    copiaId = copia.id;
    // Já registra o arquivo: outra geração da mesma OS em andamento não o tira da pasta.
    await db
      .from("work_order_documents")
      .update({ google_document_id: copia.id })
      .eq("id", registro.id);
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

    // Um documento só na pasta do cliente: os anteriores vão para o controle interno.
    const ficou = await manterUmDocumento({
      workOrderId,
      garantia: false,
      base: baseName,
      pastaCliente: pastas.materials_folder_id,
    }).catch((e) => {
      console.error("Falha ao tirar os documentos anteriores da pasta do cliente:", e);
      return null;
    });
    if (ficou && ficou.id !== registro.id && ficou.google_document_url)
      return {
        ok: true,
        url: ficou.google_document_url,
        name: ficou.document_name ?? nome,
        version: ficou.document_version,
        templateType: ficou.template_type,
      };

    return { ok: true, url, name: nome, version: versao, templateType: tipo };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao gerar o documento.";
    console.error("Falha na geração do documento da OS:", e);
    // Cópia pela metade não fica na pasta do cliente (vai para a lixeira do Drive).
    if (copiaId)
      await enviarParaLixeira(copiaId).catch((x) =>
        console.error("Cópia com falha não foi para a lixeira:", copiaId, x),
      );
    await db
      .from("work_order_documents")
      .update({
        generation_status: "Erro",
        error_message: msg,
        is_active: !anterior,
        google_document_id: null,
      })
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
    const itens = (v.service_items ?? []).filter(
      (i) => i.active !== false && Number(i.quantity) > 0,
    );
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

/** Campos do modelo do termo de garantia. */
export function camposGarantia(
  osNumber: string,
  d: NonNullable<ReturnType<typeof warrantyData>>,
): Record<string, string> {
  return {
    NUMERO_OS: osNumber,
    NOME_CLIENTE: d.cliente,
    DATA_SERVICO: d.dataServico,
    TECNICO: d.tecnico || "—",
    ESTOFADOS: d.estofados || "—",
    DATA_PROXIMA: d.proxima,
  };
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
  // Sem modelo próprio não gera: o texto de outra empresa nunca vai para o cliente.
  if (!s.templateGarantia)
    throw new Error(`${SEM_MODELO_GARANTIA} em Configurações → Modelos da OS.`);

  const db = await admin();
  const wo = await loadWarrantyOrder(workOrderId);
  const dados = warrantyData(wo);
  if (!dados)
    throw new Error(
      "Esta OS não tem serviço de impermeabilização, então não gera termo de garantia.",
    );

  const anterior = await loadWarranty(workOrderId);
  const versao = (anterior.document?.version ?? 0) + 1;
  const baseNome = `Termo de garantia — OS ${wo.os_number} - ${dados.cliente}`.trim();
  const nome = versao > 1 ? `${baseNome} - V${versao}` : baseNome;

  const { data: registro, error: registroError } = await db
    .from("work_order_documents")
    .insert({
      empresa_id: contextoEmpresa().empresaId,
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

  let docId: string | null = null;
  try {
    const pastas = await ensureMaterialsFolders(workOrderId);
    if (!pastas.materials_folder_id)
      throw new Error("A pasta desta OS não foi criada no Google Drive.");

    // Cópia do modelo da empresa, já na pasta da OS, com os campos trocados.
    const copia = await copyFile(s.templateGarantia, nome, pastas.materials_folder_id);
    docId = copia.id;
    await db
      .from("work_order_documents")
      .update({ google_document_id: copia.id })
      .eq("id", registro.id);
    await replacePlaceholders(copia.id, camposGarantia(wo.os_number, dados));
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

    // Um termo só na pasta do cliente: os anteriores vão para o controle interno.
    const ficou = await manterUmDocumento({
      workOrderId,
      garantia: true,
      base: baseNome,
      pastaCliente: pastas.materials_folder_id,
    }).catch((e) => {
      console.error("Falha ao tirar os termos anteriores da pasta do cliente:", e);
      return null;
    });
    if (ficou && ficou.id !== registro.id && ficou.google_document_url)
      return {
        ok: true,
        url: ficou.google_document_url,
        name: ficou.document_name ?? nome,
        version: ficou.document_version,
      };

    return { ok: true, url, name: nome, version: versao };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao gerar o termo de garantia.";
    console.error("Falha na geração do termo de garantia:", e);
    if (docId)
      await enviarParaLixeira(docId).catch((x) =>
        console.error("Termo com falha não foi para a lixeira:", docId, x),
      );
    await db
      .from("work_order_documents")
      .update({ generation_status: "Erro", error_message: msg, google_document_id: null })
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
