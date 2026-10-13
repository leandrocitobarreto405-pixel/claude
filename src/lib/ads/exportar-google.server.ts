/**
 * Exportação das vendas para o Google Ads (importação offline de conversões por planilha).
 *
 * Para cada empresa com planilha configurada (ads_configuracoes.google_planilha_id):
 *  1. lê as conversões pendentes (vw_conversoes_google_pendentes: OS agendada, com gclid,
 *     ainda não enviada);
 *  2. reescreve a primeira aba da planilha: na linha 1 os nomes das colunas (o fluxo novo do
 *     Google Ads, na Central de dados, lê a linha 1 como cabeçalho; o fuso vai no horário, -03:00)
 *     e embaixo as conversões dos últimos 90 dias (as antigas que já estavam + as novas). Manter
 *     as recentes protege contra o Google ler a planilha depois de duas exportações seguidas; o
 *     Google ignora a mesma conversão (gclid + nome + horário) importada de novo;
 *  3. marca enviado_google_em nos cliques exportados (depois de gravar a planilha).
 *
 * A planilha é acessada com a conta Google que a empresa conectou no Nexa (acesso ao Drive).
 * simular: devolve as linhas sem gravar nem marcar nada.
 */
import { log } from "./captacao.server";

export const CABECALHO = [
  "Google Click ID",
  "Conversion Name",
  "Conversion Time",
  "Conversion Value",
  "Conversion Currency",
] as const;
const DIAS_NA_PLANILHA = 90;

type Linha = [string, string, string, number, string];

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

/** Horário "yyyy-MM-dd HH:mm:ss-03:00" → Date (para descartar as linhas antigas). */
function dataDaLinha(horario: unknown): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})([+-]\d{2}:\d{2})$/.exec(
    String(horario ?? ""),
  );
  return m ? new Date(`${m[1]}T${m[2]}${m[3]}`) : null;
}

/**
 * Conversões que já estavam na planilha, só as recentes e bem formadas. Cabeçalho e outras linhas
 * sem horário válido ficam de fora (inclusive a antiga linha "Parameters:...").
 */
export function linhasRecentes(valores: unknown[][], agora = new Date()): Linha[] {
  const limite = agora.getTime() - DIAS_NA_PLANILHA * 24 * 3600 * 1000;
  const linhas: Linha[] = [];
  for (const v of valores) {
    const quando = dataDaLinha(v[2]);
    if (!v[0] || !v[1] || !quando || quando.getTime() < limite) continue;
    linhas.push([
      String(v[0]),
      String(v[1]),
      String(v[2]),
      valorNumerico(v[3]),
      String(v[4] || "BRL"),
    ]);
  }
  return linhas;
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
  return valores.slice(1).filter((v) => v[0] && v[3] !== undefined && typeof v[3] !== "number")
    .length;
}

/** Linha 1 = exatamente os nomes das colunas. */
export function formatoCerto(valores: unknown[][]): boolean {
  const semVazias = (l: unknown[] | undefined) =>
    (l ?? []).map((c) => String(c ?? "").trim()).filter((c, i, t) => c || t.slice(i).some(Boolean));
  return semVazias(valores[0]).join("|") === CABECALHO.join("|");
}

/** Junta as antigas com as novas, sem repetir gclid + nome + horário. */
export function juntarLinhas(antigas: Linha[], novas: Linha[]): Linha[] {
  const chave = (l: Linha) => `${l[0]}|${l[1]}|${l[2]}`;
  const vistas = new Set(antigas.map(chave));
  return [...antigas, ...novas.filter((l) => !vistas.has(chave(l)) && vistas.add(chave(l)))];
}

async function exportarEmpresa(
  empresaId: string,
  planilha: string | null,
  simular: boolean,
): Promise<ResultadoEmpresa> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: pendentes, error } = await supabaseAdmin
    .from("vw_conversoes_google_pendentes")
    .select("ads_click_id, crm_lead_id, gclid, conversao_nome, conversao_horario, valor")
    .eq("empresa_id", empresaId)
    .order("conversao_em");
  if (error) throw new Error(`leitura das conversões: ${error.message}`);
  const novas: Linha[] = (pendentes ?? []).map((p) => [
    p.gclid ?? "",
    p.conversao_nome ?? "",
    p.conversao_horario ?? "",
    Number(p.valor ?? 0),
    "BRL",
  ]);
  const base = { empresa_id: empresaId, planilha, novas: novas.length };

  if (simular) return { ...base, na_planilha: 0, situacao: "simulado", linhas: novas };
  if (!planilha) {
    if (novas.length) {
      log("WARNING", "exportacao.sem_planilha", { empresa_id: empresaId, pendentes: novas.length });
      await supabaseAdmin.from("ads_eventos").insert({
        empresa_id: empresaId,
        tipo: "exportacao_google",
        resultado: "sem_planilha",
        detalhe: { pendentes: novas.length },
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
  const faixa = encodeURIComponent(`'${aba.replace(/'/g, "''")}'!A1:E`);
  const atual = (await sheets(
    token,
    `${id}/values/${faixa}?valueRenderOption=UNFORMATTED_VALUE`,
  )) as {
    values?: unknown[][];
  };
  const valores = atual.values ?? [];

  // Nada novo, planilha no formato e valores como número: não mexe. Valor como texto é regravado.
  const comoTextoAntes = valoresComoTexto(valores);
  if (!novas.length && formatoCerto(valores) && !comoTextoAntes) {
    log("INFO", "exportacao.nada_novo", { empresa_id: empresaId, planilha, aba });
    // Registra toda execução (antes o "nada novo" não deixava rastro no banco).
    await supabaseAdmin.from("ads_eventos").insert({
      empresa_id: empresaId,
      tipo: "exportacao_google",
      resultado: "nada_novo",
      detalhe: {
        planilha,
        aba,
        na_planilha: Math.max(0, valores.length - 1),
        valores_como_texto: 0,
      },
    });
    return { ...base, na_planilha: 0, situacao: "nada_novo" };
  }

  // Grava parâmetros, cabeçalho, conversões recentes que já estavam e as novas. Sem conversões
  // novas, isto só (re)formata a planilha vazia ou fora do formato.
  const linhas = juntarLinhas(linhasRecentes(valores), novas);
  await sheets(token, `${id}/values/${faixa}:clear`, { method: "POST", body: "{}" });
  await sheets(token, `${id}/values/${faixa}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [[...CABECALHO], ...linhas] }),
  });

  // Confere no Google o que ficou gravado (vai para o log).
  const conferencia = (await sheets(
    token,
    `${id}/values/${encodeURIComponent(`'${aba.replace(/'/g, "''")}'!A1:E2`)}`,
  )) as { values?: unknown[][] };
  const primeirasLinhas = (conferencia.values ?? []).map((l) => l.map((c) => String(c ?? "")));
  if (!formatoCerto(primeirasLinhas)) {
    throw new Error(
      `a planilha não ficou no formato esperado: ${JSON.stringify(primeirasLinhas).slice(0, 300)}`,
    );
  }
  // Confere o tipo da célula (sem formatação): o Conversion Value tem de estar como número.
  const gravado = (await sheets(
    token,
    `${id}/values/${faixa}?valueRenderOption=UNFORMATTED_VALUE`,
  )) as { values?: unknown[][] };
  const comoTexto = valoresComoTexto(gravado.values ?? []);
  if (comoTexto)
    log("WARNING", "exportacao.valor_como_texto", { empresa_id: empresaId, comoTexto });

  // Só depois de gravar a planilha: marca todos os cliques com gclid dos leads exportados.
  const leads = [
    ...new Set((pendentes ?? []).map((p) => p.crm_lead_id).filter(Boolean)),
  ] as string[];
  let marcados = 0;
  if (leads.length) {
    const { data, error: erroMarca } = await supabaseAdmin
      .from("ads_clicks")
      .update({ enviado_google_em: new Date().toISOString() })
      .eq("empresa_id", empresaId)
      .in("crm_lead_id", leads)
      .not("gclid", "is", null)
      .is("enviado_google_em", null)
      .select("id");
    if (erroMarca)
      throw new Error(`planilha gravada, mas falhou ao marcar enviados: ${erroMarca.message}`);
    marcados = data?.length ?? 0;
  }

  const situacao = novas.length ? "enviado" : "formatada";
  await supabaseAdmin.from("ads_eventos").insert({
    empresa_id: empresaId,
    tipo: "exportacao_google",
    resultado: situacao,
    detalhe: {
      planilha,
      aba,
      novas: novas.length,
      na_planilha: linhas.length,
      cliques_marcados: marcados,
      primeiras_linhas: primeirasLinhas,
      valores_como_texto: comoTexto,
      valores_como_texto_antes: comoTextoAntes,
    },
  });
  log("INFO", `exportacao.${situacao}`, {
    empresa_id: empresaId,
    planilha,
    aba,
    novas: novas.length,
    na_planilha: linhas.length,
    cliques_marcados: marcados,
  });
  return { ...base, na_planilha: linhas.length, situacao };
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
