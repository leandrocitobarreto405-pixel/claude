/**
 * Captação dos leads das landing pages (pop-up do Google Ads): recebe o envio, confere o domínio
 * (CORS), limita por IP e grava em ads_clicks pela função do banco ads_registrar_clique.
 *
 * Nunca trava o front: a resposta é sempre 200 com { ok }, e o motivo de qualquer recusa fica no
 * log do Cloud Run (JSON estruturado, "ads.captacao") e em ads_eventos.
 */
import { createHash } from "node:crypto";

/** Nomes aceitos para cada campo (o pop-up pode mandar em inglês, camelCase ou português). */
const APELIDOS = {
  nome: ["nome", "name", "full_name", "fullName"],
  telefone: ["telefone", "phone", "whatsapp", "celular", "tel", "phone_number", "phoneNumber"],
  gclid: ["gclid"],
  gbraid: ["gbraid"],
  wbraid: ["wbraid"],
  fbclid: ["fbclid"],
  utm_source: ["utm_source", "utmSource"],
  utm_medium: ["utm_medium", "utmMedium"],
  utm_campaign: ["utm_campaign", "utmCampaign"],
  utm_term: ["utm_term", "utmTerm"],
  utm_content: ["utm_content", "utmContent"],
  page_url: ["page_url", "pageUrl", "url", "landing_page", "landingPage"],
  servico: ["servico", "serviço", "service"],
} as const satisfies Record<string, readonly string[]>;
type Campo = keyof typeof APELIDOS;
type Dados = Partial<Record<Campo, string>>;
const CAMPOS_DA_URL = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const satisfies readonly Campo[];

const MAX_CORPO = 20_000;

export function log(severity: "INFO" | "WARNING" | "ERROR", evento: string, dados: object) {
  const linha = JSON.stringify({ severity, message: `[ads] ${evento}`, evento, ...dados });
  if (severity === "ERROR") console.error(linha);
  else if (severity === "WARNING") console.warn(linha);
  else console.log(linha);
}

/** Corpo em JSON, formulário ou texto (sendBeacon manda text/plain com JSON). */
export function lerCorpo(texto: string): Record<string, unknown> {
  const t = texto.slice(0, MAX_CORPO).trim();
  if (!t) return {};
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j = JSON.parse(t) as unknown;
      return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(t));
}

/** Campos do pop-up com os nomes do banco. Aceita também os parâmetros dentro de page_url. */
export function dadosDoPopup(bruto: Record<string, unknown>): Dados {
  const plano: Record<string, unknown> = { ...bruto };
  for (const chave of ["utm", "utms", "params", "tracking"]) {
    const v = bruto[chave];
    if (v && typeof v === "object" && !Array.isArray(v)) Object.assign(plano, v);
  }
  const dados: Dados = {};
  for (const [campo, nomes] of Object.entries(APELIDOS) as [Campo, readonly string[]][]) {
    for (const nome of nomes) {
      const v = plano[nome];
      if (typeof v === "string" || typeof v === "number") {
        const s = String(v).trim();
        if (s) {
          dados[campo] = s;
          break;
        }
      }
    }
  }
  // gclid e UTMs que ficaram só na URL da página.
  if (dados.page_url) {
    try {
      const url = new URL(dados.page_url);
      for (const campo of CAMPOS_DA_URL) {
        const v = url.searchParams.get(campo);
        if (!dados[campo] && v) dados[campo] = v;
      }
    } catch {
      /* page_url que não é URL: fica como texto */
    }
  }
  return dados;
}

function hostDaUrl(valor: string | null | undefined): string | null {
  if (!valor) return null;
  try {
    return new URL(valor).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Domínio da landing: Origin; sem Origin (sendBeacon antigo, teste), Referer ou page_url. */
export function hostDe(request: Request, dados?: Dados): string | null {
  return (
    hostDaUrl(request.headers.get("origin")) ??
    hostDaUrl(request.headers.get("referer")) ??
    hostDaUrl(dados?.page_url)
  );
}

/** IP do visitante (Cloud Run: primeiro endereço de X-Forwarded-For). */
export function ipDe(request: Request): string | null {
  const encaminhado = request.headers.get("x-forwarded-for");
  return encaminhado?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

/** O IP não é guardado: só um hash com o segredo do servidor. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  const sal = process.env["NEXA_TAREFAS_SEGREDO"] ?? "nexa-ads";
  return createHash("sha256").update(`${sal}|${ip}`).digest("hex").slice(0, 32);
}

// ---------------------------------------------------------------- domínios (CORS)
let dominios: { lista: Set<string>; em: number } | null = null;
const VALIDADE_DOMINIOS_MS = 60_000;

export async function dominioPermitido(host: string | null): Promise<boolean> {
  if (!host) return false;
  if (!dominios || Date.now() - dominios.em > VALIDADE_DOMINIOS_MS) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("ads_dominios").select("dominio");
    if (error) {
      log("ERROR", "dominios.falha", { erro: error.message });
      return dominios?.lista.has(host) ?? false;
    }
    dominios = { lista: new Set((data ?? []).map((d) => d.dominio)), em: Date.now() };
  }
  return dominios.lista.has(host);
}

export function cabecalhosCors(origem: string | null): Record<string, string> {
  return origem
    ? {
        "Access-Control-Allow-Origin": origem,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      }
    : { Vary: "Origin" };
}

// ---------------------------------------------------------------- limite por instância
// Proteção rápida antes do banco (o limite oficial, 20 em 10 min por IP, fica no banco).
const janela = new Map<string, number[]>();
const LIMITE_MEMORIA = 30;
const JANELA_MEMORIA_MS = 60_000;

export function acimaDoLimiteLocal(chave: string | null): boolean {
  if (!chave) return false;
  const agora = Date.now();
  const recentes = (janela.get(chave) ?? []).filter((t) => agora - t < JANELA_MEMORIA_MS);
  recentes.push(agora);
  janela.set(chave, recentes);
  if (janela.size > 5000) {
    for (const [k, v] of janela)
      if (!v.some((t) => agora - t < JANELA_MEMORIA_MS)) janela.delete(k);
  }
  return recentes.length > LIMITE_MEMORIA;
}

// ---------------------------------------------------------------- captação
export type Resultado = {
  ok: boolean;
  resultado: string;
  motivo?: string;
};

export async function registrarClique(request: Request): Promise<Resultado> {
  const texto = await request.text();
  const dados = dadosDoPopup(lerCorpo(texto));
  const host = hostDe(request, dados);
  const ipHash = hashIp(ipDe(request));
  const base = {
    host,
    ip_hash: ipHash,
    tem_gclid: Boolean(dados.gclid),
    servico: dados.servico ?? null,
  };

  if (acimaDoLimiteLocal(ipHash)) {
    log("WARNING", "captacao.limite_local", base);
    return { ok: false, resultado: "limite" };
  }
  if (!dados.telefone) {
    log("WARNING", "captacao.sem_telefone", { ...base, campos: Object.keys(dados) });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("ads_registrar_clique", {
    _host: host ?? "",
    _ip_hash: ipHash ?? "",
    _dados: dados,
  });
  if (error) {
    log("ERROR", "captacao.falha_banco", { ...base, erro: error.message });
    return { ok: false, resultado: "erro" };
  }
  const r = (data ?? {}) as { resultado?: string; id?: string; motivo?: string; avisos?: string[] };
  const resultado = r.resultado ?? "desconhecido";
  const gravou = resultado === "gravado" || resultado === "duplicado";
  log(gravou ? "INFO" : "WARNING", `captacao.${resultado}`, {
    ...base,
    id: r.id ?? null,
    motivo: r.motivo ?? null,
    avisos: r.avisos ?? [],
  });
  return { ok: gravou, resultado, ...(r.motivo ? { motivo: r.motivo } : {}) };
}
