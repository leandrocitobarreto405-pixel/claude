/**
 * Google Planilhas com a conta Google da empresa (a mesma conexão das vendas para o Google Ads).
 * Cria, grava e lê planilhas no Drive da conta conectada. Nenhum token aparece em erro ou log:
 * as mensagens trazem só o que o Google respondeu sobre a planilha.
 */
import { tokenGoogle } from "@/lib/google-auth.server";

const SHEETS = () =>
  (process.env["SHEETS_API_URL"] || "https://sheets.googleapis.com").replace(/\/+$/, "");
const DRIVE = "https://www.googleapis.com/drive/v3";

export class ErroGoogle extends Error {
  constructor(
    mensagem: string,
    /** Passo exato para resolver, quando dá para saber. */
    readonly acao: string | null,
  ) {
    super(mensagem);
  }
}

/** Traduz a resposta de erro do Google em mensagem + passo para resolver. */
function erroDoGoogle(servico: string, status: number, corpo: string): ErroGoogle {
  let motivo = "";
  let link: string | null = null;
  try {
    const j = JSON.parse(corpo) as {
      error?: { message?: string; status?: string; details?: Array<Record<string, unknown>> };
    };
    motivo = j.error?.message ?? "";
    for (const d of j.error?.details ?? []) {
      const meta = d["metadata"] as Record<string, string> | undefined;
      if (meta?.["activationUrl"]) link = meta["activationUrl"];
    }
  } catch {
    motivo = corpo.slice(0, 200);
  }
  if (!link)
    link = motivo.match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/\S+/)?.[0] ?? null;
  if (
    status === 403 &&
    /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(motivo + corpo)
  )
    return new ErroGoogle(
      `A API do ${servico} está desligada no projeto do Google Cloud da Nexa.`,
      link
        ? `Abra ${link} (logado na conta dona do projeto) e clique em "Ativar". Espere 2 minutos e teste de novo.`
        : `No Google Cloud da Nexa, abra "APIs e serviços" → "Biblioteca", procure "${servico} API" e clique em "Ativar".`,
    );
  if (status === 401 || status === 403)
    return new ErroGoogle(
      `O Google recusou o acesso ao ${servico} (${status}).`,
      'Em Configurações → Modelos de ordem de serviço → Conta Google da empresa, toque em "Conectar de novo" e marque todas as permissões.',
    );
  return new ErroGoogle(`O ${servico} respondeu ${status}: ${motivo.slice(0, 200)}`, null);
}

async function chamar(servico: string, url: string, token: string, init: RequestInit = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const texto = await res.text();
  if (!res.ok) throw erroDoGoogle(servico, res.status, texto);
  return texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
}

/** Token da conta Google da empresa, com o passo para resolver quando falhar. */
export async function tokenDaEmpresa(empresaId: string): Promise<string> {
  try {
    return await tokenGoogle(empresaId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ErroGoogle(
      msg,
      /conectada de novo|Conecte a conta/i.test(msg)
        ? 'Em Configurações → Modelos de ordem de serviço → Conta Google da empresa, toque em "Conectar de novo" (ou "Conectar conta Google") e marque todas as permissões.'
        : null,
    );
  }
}

export async function criarPlanilha(
  token: string,
  titulo: string,
  abas: string[],
): Promise<string> {
  const r = (await chamar("Google Sheets", `${SHEETS()}/v4/spreadsheets`, token, {
    method: "POST",
    body: JSON.stringify({
      properties: { title: titulo, locale: "pt_BR", timeZone: "America/Sao_Paulo" },
      sheets: abas.map((title) => ({ properties: { title } })),
    }),
  })) as { spreadsheetId?: string };
  if (!r.spreadsheetId) throw new ErroGoogle("O Google não devolveu a planilha criada.", null);
  return r.spreadsheetId;
}

const faixa = (aba: string, celulas = "A1:Z") =>
  encodeURIComponent(`'${aba.replace(/'/g, "''")}'!${celulas}`);

/** Reescreve a aba inteira com as linhas (a primeira é o cabeçalho). */
export async function gravarAba(token: string, id: string, aba: string, linhas: unknown[][]) {
  const base = `${SHEETS()}/v4/spreadsheets/${encodeURIComponent(id)}/values`;
  await chamar("Google Sheets", `${base}/${faixa(aba)}:clear`, token, {
    method: "POST",
    body: "{}",
  });
  await chamar("Google Sheets", `${base}/${faixa(aba, "A1")}?valueInputOption=RAW`, token, {
    method: "PUT",
    body: JSON.stringify({ values: linhas }),
  });
}

export async function lerAba(
  token: string,
  id: string,
  aba: string,
  celulas = "A1:Z",
): Promise<unknown[][]> {
  const r = (await chamar(
    "Google Sheets",
    `${SHEETS()}/v4/spreadsheets/${encodeURIComponent(id)}/values/${faixa(aba, celulas)}`,
    token,
  )) as { values?: unknown[][] };
  return r.values ?? [];
}

/** Abas que a planilha já tem. */
export async function abasDaPlanilha(token: string, id: string): Promise<string[]> {
  const r = (await chamar(
    "Google Sheets",
    `${SHEETS()}/v4/spreadsheets/${encodeURIComponent(id)}?fields=sheets.properties.title`,
    token,
  )) as { sheets?: Array<{ properties?: { title?: string } }> };
  return (r.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);
}

export async function criarAbas(token: string, id: string, abas: string[]) {
  if (!abas.length) return;
  await chamar(
    "Google Sheets",
    `${SHEETS()}/v4/spreadsheets/${encodeURIComponent(id)}:batchUpdate`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        requests: abas.map((title) => ({ addSheet: { properties: { title } } })),
      }),
    },
  );
}

/** Manda o arquivo para a lixeira do Drive (some sozinho em 30 dias). */
export async function moverParaLixeira(token: string, id: string) {
  await chamar(
    "Google Drive",
    `${DRIVE}/files/${encodeURIComponent(id)}?supportsAllDrives=true`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ trashed: true }),
    },
  );
}

export type ResultadoTeste = {
  ok: boolean;
  passos: Array<{ nome: string; ok: boolean; detalhe: string | null }>;
  acao: string | null;
};

/**
 * Teste completo com a conexão da empresa: token, criar planilha, gravar, ler de volta e mandar
 * para a lixeira. Nada fica no Drive (a planilha de teste vai para a lixeira no fim).
 */
export async function testarPlanilhas(empresaId: string): Promise<ResultadoTeste> {
  const passos: ResultadoTeste["passos"] = [];
  const falhou = (nome: string, e: unknown): ResultadoTeste => {
    passos.push({ nome, ok: false, detalhe: e instanceof Error ? e.message : String(e) });
    return { ok: false, passos, acao: e instanceof ErroGoogle ? e.acao : null };
  };
  let token: string;
  try {
    token = await tokenDaEmpresa(empresaId);
    passos.push({ nome: "Conta Google conectada e autorização válida", ok: true, detalhe: null });
  } catch (e) {
    return falhou("Conta Google conectada e autorização válida", e);
  }
  let id: string;
  try {
    id = await criarPlanilha(token, "Nexa OS — teste de acesso (pode apagar)", ["Teste"]);
    passos.push({ nome: "Criar planilha nova no Drive", ok: true, detalhe: null });
  } catch (e) {
    return falhou("Criar planilha nova no Drive", e);
  }
  try {
    const marca = new Date().toISOString();
    await gravarAba(token, id, "Teste", [["Teste do Nexa OS", marca]]);
    const lido = await lerAba(token, id, "Teste", "A1:B1");
    if (String(lido[0]?.[1] ?? "") !== marca) throw new Error("o que foi gravado não voltou igual");
    passos.push({ nome: "Gravar e ler de volta", ok: true, detalhe: null });
  } catch (e) {
    return falhou("Gravar e ler de volta", e);
  }
  try {
    await moverParaLixeira(token, id);
    passos.push({ nome: "Apagar a planilha de teste", ok: true, detalhe: null });
  } catch (e) {
    // O acesso às planilhas funciona; só não deu para apagar o teste.
    passos.push({
      nome: "Apagar a planilha de teste",
      ok: false,
      detalhe: `${e instanceof Error ? e.message : String(e)} A planilha "Nexa OS — teste de acesso" ficou no Drive e pode ser apagada à mão.`,
    });
    return { ok: true, passos, acao: e instanceof ErroGoogle ? e.acao : null };
  }
  return { ok: true, passos, acao: null };
}
