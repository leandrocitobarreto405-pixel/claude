/**
 * Exportação das vendas para o Google Ads (importação offline de conversões por planilha).
 *
 * Para cada empresa com planilha configurada (ads_configuracoes.google_planilha_id):
 *  1. lê as conversões pendentes (vw_conversoes_google_pendentes: venda faturada, com gclid,
 *     ainda não enviada);
 *  2. reescreve a primeira aba da planilha: "Parameters:TimeZone=America/Sao_Paulo", os nomes
 *     das colunas e as conversões dos últimos 90 dias (as antigas que já estavam + as novas). Manter
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
export const PARAMETROS = "Parameters:TimeZone=America/Sao_Paulo";
const DIAS_NA_PLANILHA = 90;

type Linha = [string, string, string, number, string];

export type ResultadoEmpresa = {
  empresa_id: string;
  planilha: string | null;
  novas: number;
  na_planilha: number;
  situacao: "enviado" | "nada_novo" | "sem_planilha" | "simulado" | "erro";
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

/** Linhas que já estavam na planilha (a partir da 3ª), só as recentes e bem formadas. */
export function linhasRecentes(valores: unknown[][], agora = new Date()): Linha[] {
  const limite = agora.getTime() - DIAS_NA_PLANILHA * 24 * 3600 * 1000;
  const linhas: Linha[] = [];
  for (const v of valores.slice(2)) {
    const quando = dataDaLinha(v[2]);
    if (!v[0] || !v[1] || !quando || quando.getTime() < limite) continue;
    linhas.push([
      String(v[0]),
      String(v[1]),
      String(v[2]),
      Number(v[3]) || 0,
      String(v[4] || "BRL"),
    ]);
  }
  return linhas;
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
  if (!novas.length) {
    log("INFO", "exportacao.nada_novo", { empresa_id: empresaId });
    return { ...base, na_planilha: 0, situacao: "nada_novo" };
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
  const linhas = juntarLinhas(linhasRecentes(atual.values ?? []), novas);

  await sheets(token, `${id}/values/${faixa}:clear`, { method: "POST", body: "{}" });
  await sheets(token, `${id}/values/${faixa}?valueInputOption=RAW`, {
    method: "PUT",
    body: JSON.stringify({ values: [[PARAMETROS], [...CABECALHO], ...linhas] }),
  });

  // Só depois de gravar a planilha: marca todos os cliques com gclid dos leads exportados.
  const leads = [
    ...new Set((pendentes ?? []).map((p) => p.crm_lead_id).filter(Boolean)),
  ] as string[];
  const { data: marcados, error: erroMarca } = await supabaseAdmin
    .from("ads_clicks")
    .update({ enviado_google_em: new Date().toISOString() })
    .eq("empresa_id", empresaId)
    .in("crm_lead_id", leads)
    .not("gclid", "is", null)
    .is("enviado_google_em", null)
    .select("id");
  if (erroMarca)
    throw new Error(`planilha gravada, mas falhou ao marcar enviados: ${erroMarca.message}`);

  await supabaseAdmin.from("ads_eventos").insert({
    empresa_id: empresaId,
    tipo: "exportacao_google",
    resultado: "enviado",
    detalhe: {
      planilha,
      aba,
      novas: novas.length,
      na_planilha: linhas.length,
      cliques_marcados: marcados?.length ?? 0,
    },
  });
  log("INFO", "exportacao.enviado", {
    empresa_id: empresaId,
    planilha,
    aba,
    novas: novas.length,
    na_planilha: linhas.length,
  });
  return { ...base, na_planilha: linhas.length, situacao: "enviado" };
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
