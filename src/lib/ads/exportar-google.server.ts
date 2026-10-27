/**
 * Exportação das vendas para o Google Ads (importação offline de conversões por planilha).
 *
 * Para cada empresa com planilha configurada (ads_configuracoes.google_planilha_id):
 *  1. guarda em ads_conversoes_google as vendas novas (vw_conversoes_google_candidatas: lead com
 *     clique de anúncio, ou sem clique mas com origem Google Ads; recompra fica fora), com o nome e
 *     o horário de conversão fixos e o e-mail/telefone já em SHA-256;
 *  2. reescreve a primeira aba da planilha: na linha 1 os nomes das colunas (CABECALHO; o fuso vai
 *     no horário, -03:00) e embaixo as vendas dos últimos 90 dias que não foram retiradas. A mesma
 *     venda sai sempre com o mesmo nome e horário, e o Google ignora a conversão importada de novo;
 *     linhas do formato antigo que já estavam na planilha são guardadas antes, com o mesmo nome,
 *     horário e valor;
 *  3. marca exportada_em e enviado_google_em nos cliques exportados (depois de gravar a planilha).
 *
 * A planilha é acessada com a conta Google que a empresa conectou no Nexa (acesso ao Drive).
 * simular: devolve as linhas sem gravar nem marcar nada.
 */
import { log } from "./captacao.server";
import { hashEmail, hashTelefone } from "./hash-google";

/**
 * Colunas da planilha (conversões de cliques com conversões otimizadas para leads). O clique
 * (gclid, ou gbraid/wbraid de iPhone quando não há gclid), o e-mail e o telefone já em SHA-256
 * (hex minúsculo); a linha pode ter clique, e-mail/telefone ou os dois.
 */
/** Versão do formato da planilha (2 = colunas com e-mail e telefone em hash, 27/10/2026). */
export const FORMATO = 2;

export const CABECALHO = [
  "Google Click ID",
  "GBRAID",
  "WBRAID",
  "Email",
  "Phone Number",
  "Conversion Name",
  "Conversion Time",
  "Conversion Value",
  "Conversion Currency",
] as const;
/** Formato até 27/10/2026 (só o clique). */
export const CABECALHO_ANTIGO = [
  "Google Click ID",
  "Conversion Name",
  "Conversion Time",
  "Conversion Value",
  "Conversion Currency",
] as const;
const DIAS_NA_PLANILHA = 90;

type LinhaNova = [string, string, string, string, string, string, string, number, string];
type Linha = LinhaNova;
/** Conversão lida da planilha (qualquer um dos dois formatos). */
export type LinhaLida = { gclid: string; nome: string; horario: string; valor: number };

export type ResultadoEmpresa = {
  empresa_id: string;
  planilha: string | null;
  novas: number;
  na_planilha: number;
  situacao: "enviado" | "formatada" | "nada_novo" | "sem_planilha" | "simulado" | "erro";
  erro?: string;
  linhas?: Linha[];
};

function sheetsBase() {
  return (process.env["SHEETS_API_URL"] || "https://sheets.googleapis.com").replace(/\/+$/, "");
}

async function sheets(token: string, caminho: string, init: RequestInit = {}) {
  const res = await fetch(`${sheetsBase()}/v4/spreadsheets/${caminho}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`Google Sheets respondeu ${res.status}: ${texto.slice(0, 300)}`);
  return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
}

/**
 * O Google Ads lê o Conversion Value com ponto decimal. Numa planilha em pt-BR o número aparece
 * como "295,8" e a linha é recusada (só as de valor inteiro entram). A planilha precisa estar
 * em en_US; o fuso do horário não depende disso (vai escrito na própria célula, -03:00).
 */
export const LOCALIDADE_PLANILHA = "en_US";
export function localidadeCerta(locale: unknown): boolean {
  return (
    String(locale ?? "")
      .replace("-", "_")
      .toLowerCase() === "en_us"
  );
}

/** Abrevia o gclid nos registros (só para conferência; nunca o valor inteiro no log). */
export function linhasParaRegistro(valores: unknown[][], maximo = 12): string[][] {
  return valores
    .slice(0, maximo)
    .map((l, i) =>
      l.map((c, j) => (i > 0 && j === 0 ? `${String(c ?? "").slice(0, 12)}…` : String(c ?? ""))),
    );
}

/** Deixa a planilha em en_US (uma vez); devolve de onde veio e se mudou. */
async function garantirLocalidade(token: string, id: string) {
  const props = (await sheets(token, `${id}?fields=properties.locale`)) as {
    properties?: { locale?: string };
  };
  const de = props.properties?.locale ?? "";
  if (localidadeCerta(de)) return { de, para: de, alterada: false };
  await sheets(token, `${id}:batchUpdate`, {
    method: "POST",
    body: JSON.stringify({
      requests: [
        {
          updateSpreadsheetProperties: {
            properties: { locale: LOCALIDADE_PLANILHA },
            fields: "locale",
          },
        },
      ],
    }),
  });
  return { de, para: LOCALIDADE_PLANILHA, alterada: true };
}

/** Horário "yyyy-MM-dd HH:mm:ss-03:00" → Date (para descartar as linhas antigas). */
function dataDaLinha(horario: unknown): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})$/.exec(
    String(horario ?? ""),
  );
  return m ? new Date(`${m[1]}T${m[2]}${m[3]}`) : null;
}

/**
 * Conversões que já estavam na planilha, no formato antigo (5 colunas) ou no novo, pelos nomes do
 * cabeçalho. Linhas sem horário válido ficam de fora (inclusive a antiga linha "Parameters:...").
 */
export function lerLinhas(valores: unknown[][]): LinhaLida[] {
  const cab = (valores[0] ?? []).map((c) => String(c ?? "").trim());
  const col = (nome: string, padrao: number) => {
    const i = cab.indexOf(nome);
    return i >= 0 ? i : padrao;
  };
  const [g, n, h, v] = [
    col("Google Click ID", 0),
    col("Conversion Name", 1),
    col("Conversion Time", 2),
    col("Conversion Value", 3),
  ];
  const linhas: LinhaLida[] = [];
  for (const l of valores) {
    if (!l[n] || !dataDaLinha(l[h])) continue;
    linhas.push({
      gclid: String(l[g] ?? "").trim(),
      nome: String(l[n]),
      horario: String(l[h]),
      valor: valorNumerico(l[v]),
    });
  }
  return linhas;
}

/** Para comparar a planilha com o que seria gravado (número como número, vazio como ""). */
function normalizarLinha(l: unknown[]): string {
  return JSON.stringify(
    Array.from({ length: CABECALHO.length }, (_, i) => {
      const c = l[i];
      return typeof c === "number" ? c : String(c ?? "");
    }),
  );
}

/** Conversion Value como número; aceita texto "295,8" ou "295.8" que alguém tenha digitado. */
export function valorNumerico(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let t = String(v ?? "").replace(/\s/g, "");
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Linhas de conversão (lidas com UNFORMATTED_VALUE) cujo Conversion Value está como texto.
 * Número aparece como número; "295,8" digitado vira texto e o Google Ads pode recusar.
 */
export function valoresComoTexto(valores: unknown[][]): number {
  const cab = (valores[0] ?? []).map((c) => String(c ?? "").trim());
  const n = Math.max(0, cab.indexOf("Conversion Name"));
  const v = cab.indexOf("Conversion Value") >= 0 ? cab.indexOf("Conversion Value") : 3;
  return valores.slice(1).filter((l) => l[n] && l[v] !== undefined && typeof l[v] !== "number")
    .length;
}

/** Linha 1 = exatamente os nomes das colunas. */
export function formatoCerto(valores: unknown[][]): boolean {
  const semVazias = (l: unknown[] | undefined) =>
    (l ?? []).map((c) => String(c ?? "").trim()).filter((c, i, t) => c || t.slice(i).some(Boolean));
  return semVazias(valores[0]).join("|") === CABECALHO.join("|");
}

type Db = import("@supabase/supabase-js").SupabaseClient;

type Conversao = {
  id?: string;
  work_order_id: string;
  crm_lead_id: string | null;
  ads_click_id: string | null;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  email_sha256: string | null;
  telefone_sha256: string | null;
  conversao_nome: string;
  conversao_horario: string;
  valor: number;
  base: "clique" | "origem";
  exportada_em?: string | null;
};

/** Linha da planilha nova a partir da conversão guardada. */
export function linhaDaConversao(c: Conversao): LinhaNova {
  return [
    c.gclid ?? "",
    c.gbraid ?? "",
    c.wbraid ?? "",
    c.email_sha256 ?? "",
    c.telefone_sha256 ?? "",
    c.conversao_nome,
    c.conversao_horario,
    Number(c.valor ?? 0),
    "BRL",
  ];
}

/** E-mail e telefone (com hash) da venda: cliente da OS e, sem telefone, o do lead. */
async function contatoDaVenda(db: Db, workOrderId: string, leadId: string | null) {
  const { data: w } = await db
    .from("work_orders")
    .select("customer:customer_id ( email, phone )")
    .eq("id", workOrderId)
    .maybeSingle();
  const cliente = (w as { customer?: { email: string | null; phone: string | null } } | null)
    ?.customer;
  let telefone = cliente?.phone ?? null;
  if (leadId) {
    const { data: l } = await db
      .from("crm_leads")
      .select("normalized_phone")
      .eq("id", leadId)
      .maybeSingle();
    telefone = (l as { normalized_phone?: string | null } | null)?.normalized_phone || telefone;
  }
  return { email_sha256: hashEmail(cliente?.email), telefone_sha256: hashTelefone(telefone) };
}

/**
 * Vendas que já estavam na planilha (formato antigo ou novo) e ainda não estão guardadas:
 * guarda com o MESMO nome, horário e valor da planilha (o Google não conta de novo). OS que foi
 * cancelada, apagada ou marcada como teste fica registrada como retirada e sai da planilha.
 */
async function guardarAsDaPlanilha(db: Db, empresaId: string, linhas: LinhaLida[]) {
  const comGclid = linhas.filter((l) => l.gclid);
  if (!comGclid.length) return { guardadas: 0, retiradas: [] as string[] };
  const { data: ja } = await db
    .from("ads_conversoes_google")
    .select("gclid")
    .eq("empresa_id", empresaId)
    .in(
      "gclid",
      comGclid.map((l) => l.gclid),
    );
  const guardados = new Set((ja ?? []).map((r: { gclid: string | null }) => r.gclid));
  let guardadas = 0;
  const retiradas: string[] = [];
  for (const l of comGclid) {
    if (guardados.has(l.gclid)) continue;
    const { data: clique } = await db
      .from("ads_clicks")
      .select(
        "id, crm_lead_id, gbraid, wbraid, lead:crm_lead_id ( linked_work_order_id, work_order:linked_work_order_id ( id, os_number, status, deleted_at, eh_teste ) )",
      )
      .eq("empresa_id", empresaId)
      .eq("gclid", l.gclid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const c = clique as {
      id: string;
      crm_lead_id: string | null;
      lead?: {
        work_order?: {
          id: string;
          os_number: string;
          status: string | null;
          deleted_at: string | null;
          eh_teste: boolean;
        } | null;
      } | null;
    } | null;
    const os = c?.lead?.work_order;
    if (!c || !os) {
      log("WARNING", "exportacao.linha_sem_venda", { gclid: `${l.gclid.slice(0, 12)}…` });
      continue;
    }
    const invalida = os.deleted_at
      ? "OS apagada"
      : os.status === "Cancelada"
        ? "OS cancelada"
        : os.eh_teste
          ? "OS de teste"
          : null;
    const contato = await contatoDaVenda(db, os.id, c.crm_lead_id);
    const { error } = await db.from("ads_conversoes_google").insert({
      empresa_id: empresaId,
      work_order_id: os.id,
      crm_lead_id: c.crm_lead_id,
      ads_click_id: c.id,
      gclid: l.gclid,
      ...contato,
      conversao_nome: l.nome,
      conversao_horario: l.horario,
      valor: l.valor,
      base: "clique",
      exportada_em: new Date().toISOString(),
      ...(invalida ? { retirada_em: new Date().toISOString(), motivo_retirada: invalida } : {}),
    });
    if (error && error.code !== "23505")
      throw new Error(`guardar a venda da planilha: ${error.message}`);
    if (invalida) retiradas.push(`OS ${os.os_number} (${invalida})`);
    else guardadas++;
  }
  return { guardadas, retiradas };
}

/** Vendas novas (com clique ou com origem Google Ads), já com e-mail e telefone em hash. */
async function novasConversoes(db: Db, empresaId: string): Promise<Conversao[]> {
  const { data, error } = await db
    .from("vw_conversoes_google_candidatas")
    .select(
      "work_order_id, crm_lead_id, ads_click_id, gclid, gbraid, wbraid, telefone, email, conversao_nome, conversao_horario, valor, base",
    )
    .eq("empresa_id", empresaId)
    .order("venda_em");
  if (error) throw new Error(`leitura das conversões: ${error.message}`);
  return (data ?? []).map((v: Record<string, unknown>) => ({
    work_order_id: String(v["work_order_id"]),
    crm_lead_id: (v["crm_lead_id"] as string | null) ?? null,
    ads_click_id: (v["ads_click_id"] as string | null) ?? null,
    gclid: (v["gclid"] as string | null) ?? null,
    gbraid: (v["gbraid"] as string | null) ?? null,
    wbraid: (v["wbraid"] as string | null) ?? null,
    email_sha256: hashEmail(v["email"] as string | null),
    telefone_sha256: hashTelefone(v["telefone"] as string | null),
    conversao_nome: String(v["conversao_nome"]),
    conversao_horario: String(v["conversao_horario"]),
    valor: Number(v["valor"] ?? 0),
    base: v["base"] === "clique" ? "clique" : "origem",
  }));
}

async function exportarEmpresa(
  empresaId: string,
  planilha: string | null,
  simular: boolean,
): Promise<ResultadoEmpresa> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as Db;
  // Só entram as que têm algum identificador (clique, e-mail ou telefone).
  const novas = (await novasConversoes(db, empresaId)).filter(
    (c) => c.gclid || c.gbraid || c.wbraid || c.email_sha256 || c.telefone_sha256,
  );
  const base = { empresa_id: empresaId, planilha, novas: novas.length };

  if (simular)
    return { ...base, na_planilha: 0, situacao: "simulado", linhas: novas.map(linhaDaConversao) };
  if (!planilha) {
    if (novas.length) {
      log("WARNING", "exportacao.sem_planilha", { empresa_id: empresaId, pendentes: novas.length });
      await supabaseAdmin.from("ads_eventos").insert({
        empresa_id: empresaId,
        tipo: "exportacao_google",
        resultado: "sem_planilha",
        detalhe: { pendentes: novas.length, formato: FORMATO },
      });
    }
    return { ...base, na_planilha: 0, situacao: "sem_planilha" };
  }
  const { tokenGoogle } = await import("@/lib/google-auth.server");
  const token = await tokenGoogle(empresaId);
  const id = encodeURIComponent(planilha);
  const info = (await sheets(token, `${id}?fields=sheets.properties.title`)) as {
    sheets?: Array<{ properties?: { title?: string } }>;
  };
  const aba = info.sheets?.[0]?.properties?.title ?? "Sheet1";
  const nomeAba = `'${aba.replace(/'/g, "''")}'`;
  const faixa = encodeURIComponent(`${nomeAba}!A1:Z`);
  const atual = (await sheets(
    token,
    `${id}/values/${faixa}?valueRenderOption=UNFORMATTED_VALUE`,
  )) as { values?: unknown[][] };
  const valores = atual.values ?? [];

  // Localidade da planilha: en_US para o valor sair com ponto ("295.8"), senão o Google Ads recusa.
  const localidade = await garantirLocalidade(token, id);
  if (localidade.alterada) {
    await supabaseAdmin.from("ads_eventos").insert({
      empresa_id: empresaId,
      tipo: "exportacao_google",
      resultado: "localidade_alterada",
      detalhe: { planilha, aba, de: localidade.de, para: localidade.para },
    });
  }

  // 1. O que já estava na planilha fica guardado com o mesmo nome/horário/valor.
  const sincronia = await guardarAsDaPlanilha(db, empresaId, lerLinhas(valores));
  // 2. As novas entram na tabela (ainda sem exportada_em).
  if (novas.length) {
    const { error } = await db.from("ads_conversoes_google").upsert(
      novas.map((c) => ({ ...c, empresa_id: empresaId })),
      { onConflict: "empresa_id,work_order_id", ignoreDuplicates: true },
    );
    if (error) throw new Error(`guardar as conversões novas: ${error.message}`);
  }
  // 3. A planilha é a tabela: vendas dos últimos 90 dias que não foram retiradas.
  const limite = new Date(Date.now() - DIAS_NA_PLANILHA * 24 * 3600 * 1000);
  const { data: guardadas, error: erroLista } = await db
    .from("ads_conversoes_google")
    .select(
      "id, work_order_id, crm_lead_id, ads_click_id, gclid, gbraid, wbraid, email_sha256, telefone_sha256, conversao_nome, conversao_horario, valor, base, exportada_em",
    )
    .eq("empresa_id", empresaId)
    .is("retirada_em", null)
    .order("conversao_horario");
  if (erroLista) throw new Error(`leitura das conversões guardadas: ${erroLista.message}`);
  const lista = ((guardadas ?? []) as Conversao[]).filter((c) => {
    const quando = dataDaLinha(c.conversao_horario);
    return quando !== null && quando >= limite;
  });
  const linhas = lista.map(linhaDaConversao);

  const iguais =
    formatoCerto(valores) &&
    !valoresComoTexto(valores) &&
    JSON.stringify(valores.slice(1).map(normalizarLinha)) ===
      JSON.stringify(linhas.map(normalizarLinha));
  if (iguais) {
    log("INFO", "exportacao.nada_novo", { empresa_id: empresaId, planilha, aba });
    await supabaseAdmin.from("ads_eventos").insert({
      empresa_id: empresaId,
      tipo: "exportacao_google",
      resultado: "nada_novo",
      detalhe: {
        planilha,
        aba,
        na_planilha: linhas.length,
        localidade: localidade.para,
        formato: FORMATO,
      },
    });
    return { ...base, na_planilha: linhas.length, situacao: "nada_novo" };
  }

  await sheets(token, `${id}/values/${faixa}:clear`, { method: "POST", body: "{}" });
  await sheets(
    token,
    `${id}/values/${encodeURIComponent(`${nomeAba}!A1:I`)}?valueInputOption=RAW`,
    {
      method: "PUT",
      body: JSON.stringify({ values: [[...CABECALHO], ...linhas] }),
    },
  );

  // Confere no Google o cabeçalho gravado e o tipo do valor.
  const gravado = (await sheets(
    token,
    `${id}/values/${faixa}?valueRenderOption=UNFORMATTED_VALUE`,
  )) as { values?: unknown[][] };
  if (!formatoCerto(gravado.values ?? [])) {
    throw new Error(
      `a planilha não ficou no formato esperado: ${JSON.stringify((gravado.values ?? [])[0] ?? []).slice(0, 300)}`,
    );
  }
  const comoTexto = valoresComoTexto(gravado.values ?? []);
  if (comoTexto)
    log("WARNING", "exportacao.valor_como_texto", { empresa_id: empresaId, comoTexto });

  // Só depois de gravar: marca as exportadas e os cliques (tela do Google).
  const agora = new Date().toISOString();
  const pendentes = lista.filter((c) => !c.exportada_em);
  if (pendentes.length) {
    const { error } = await db
      .from("ads_conversoes_google")
      .update({ exportada_em: agora })
      .in(
        "id",
        pendentes.map((c) => c.id!),
      );
    if (error)
      throw new Error(`planilha gravada, mas falhou ao marcar exportadas: ${error.message}`);
  }
  const leads = [...new Set(pendentes.map((c) => c.crm_lead_id).filter(Boolean))] as string[];
  let marcados = 0;
  if (leads.length) {
    const { data } = await supabaseAdmin
      .from("ads_clicks")
      .update({ enviado_google_em: agora })
      .eq("empresa_id", empresaId)
      .in("crm_lead_id", leads)
      .is("enviado_google_em", null)
      .select("id");
    marcados = data?.length ?? 0;
  }

  const situacao = pendentes.length ? "enviado" : "formatada";
  const contar = (f: (c: Conversao) => boolean) => lista.filter(f).length;
  await supabaseAdmin.from("ads_eventos").insert({
    empresa_id: empresaId,
    tipo: "exportacao_google",
    resultado: situacao,
    detalhe: {
      planilha,
      aba,
      novas: pendentes.length,
      na_planilha: linhas.length,
      com_gclid: contar((c) => Boolean(c.gclid)),
      so_braid: contar((c) => !c.gclid && Boolean(c.gbraid || c.wbraid)),
      com_email: contar((c) => Boolean(c.email_sha256)),
      com_telefone: contar((c) => Boolean(c.telefone_sha256)),
      sem_clique: contar((c) => !c.gclid && !c.gbraid && !c.wbraid),
      guardadas_da_planilha: sincronia.guardadas,
      retiradas: sincronia.retiradas,
      cliques_marcados: marcados,
      cabecalho: [...CABECALHO],
      formato: FORMATO,
      valores_como_texto: comoTexto,
      localidade: localidade.para,
    },
  });
  log("INFO", `exportacao.${situacao}`, {
    empresa_id: empresaId,
    planilha,
    aba,
    novas: pendentes.length,
    na_planilha: linhas.length,
    retiradas: sincronia.retiradas.length,
  });
  return { ...base, novas: pendentes.length, na_planilha: linhas.length, situacao };
}

/** Como veio a autorização recusada (sem guardar o conteúdo). */
export function tipoDeAutorizacao(
  cabecalho: string | null,
): "nenhuma" | "oidc" | "bearer" | "outra" {
  const v = (cabecalho ?? "").trim();
  if (!v) return "nenhuma";
  const token = v.replace(/^Bearer\s+/i, "");
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) return "oidc";
  return /^Bearer\s+/i.test(v) ? "bearer" : "outra";
}

let ultimaRecusa = 0;

/** Chamada da exportação com autenticação errada: registra (uma vez por hora por instância). */
export async function registrarExportacaoRecusada(request: Request) {
  const agora = Date.now();
  const autorizacao = tipoDeAutorizacao(request.headers.get("authorization"));
  const agente = (request.headers.get("user-agent") ?? "").slice(0, 120);
  log("WARNING", "exportacao.nao_autorizado", { autorizacao, agente });
  if (agora - ultimaRecusa < 3600_000) return;
  ultimaRecusa = agora;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("ads_eventos").insert({
    tipo: "exportacao_google",
    resultado: "nao_autorizado",
    detalhe: { autorizacao, agente },
  });
}

/** Já houve exportação hoje (São Paulo) para a empresa? */
async function exportouHoje(empresaId: string, hojeSP: string): Promise<boolean> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin
    .from("ads_eventos")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("tipo", "exportacao_google")
    .in("resultado", ["enviado", "formatada", "nada_novo", "sem_planilha"])
    // Só conta a exportação no formato atual: na troca de formato, a varredura roda uma vez a
    // mais no mesmo dia, logo depois da publicação.
    .contains("detalhe", { formato: FORMATO })
    .gte("created_at", `${hojeSP}T00:00:00-03:00`);
  return (count ?? 0) > 0;
}

/**
 * Exportação diária sem depender do Cloud Scheduler: chamada pela varredura (de 5 em 5 min),
 * roda uma vez por dia por empresa, a partir das 5h de São Paulo. Se o job das 5h também rodar,
 * a segunda chamada não acha nada pendente (os cliques já ficam marcados).
 */
export async function exportacaoDiaria(agora = new Date()) {
  const s = agora.toLocaleString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const hoje = s.slice(0, 10);
  if (s.slice(11, 16) < "05:00") return [];
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: configs } = await supabaseAdmin
    .from("ads_configuracoes")
    .select("empresa_id")
    .not("google_planilha_id", "is", null);
  const resultados: ResultadoEmpresa[] = [];
  for (const c of configs ?? []) {
    if (await exportouHoje(c.empresa_id, hoje)) continue;
    resultados.push(...(await exportarConversoesGoogle({ empresaId: c.empresa_id })));
  }
  return resultados;
}

/** Exporta todas as empresas (ou uma). Erro numa empresa não impede as outras. */
export async function exportarConversoesGoogle(opcoes: {
  simular?: boolean;
  empresaId?: string | null;
}): Promise<ResultadoEmpresa[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let consulta = supabaseAdmin.from("ads_configuracoes").select("empresa_id, google_planilha_id");
  if (opcoes.empresaId) consulta = consulta.eq("empresa_id", opcoes.empresaId);
  const { data: configs, error } = await consulta;
  if (error) throw new Error(`leitura das configurações: ${error.message}`);

  log("INFO", "exportacao.inicio", { empresas: configs?.length ?? 0, simular: !!opcoes.simular });
  const resultados: ResultadoEmpresa[] = [];
  for (const c of configs ?? []) {
    try {
      resultados.push(await exportarEmpresa(c.empresa_id, c.google_planilha_id, !!opcoes.simular));
    } catch (e) {
      const erro = e instanceof Error ? e.message : String(e);
      log("ERROR", "exportacao.erro", { empresa_id: c.empresa_id, erro });
      await supabaseAdmin.from("ads_eventos").insert({
        empresa_id: c.empresa_id,
        tipo: "exportacao_google",
        resultado: "erro",
        detalhe: { erro: erro.slice(0, 500) },
      });
      resultados.push({
        empresa_id: c.empresa_id,
        planilha: c.google_planilha_id,
        novas: 0,
        na_planilha: 0,
        situacao: "erro",
        erro,
      });
    }
  }
  log("INFO", "exportacao.fim", {
    resultados: resultados.map(({ linhas: _l, ...r }) => r),
  });
  return resultados;
}
