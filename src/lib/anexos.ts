// Anexos das mensagens no navegador: baixa pelo servidor (/api/anexo/<id>) com o token da
// pessoa e a empresa ativa. Fica guardado por 1 hora: na memória enquanto a tela está aberta e no
// cache do navegador (Cache Storage), para não baixar de novo ao reabrir o app. Ao sair da conta,
// o cache é apagado.
import { supabase } from "@/integrations/supabase/client";
import { EMPRESA_HEADER, getEmpresaAtiva } from "@/lib/empresa-ativa";

const VALIDADE_MS = 60 * 60 * 1000;
const NOME_CACHE = "nexa-anexos";

const memoria = new Map<string, { p: Promise<Blob>; em: number }>();

async function cabecalhos(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const empresa = getEmpresaAtiva();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(empresa ? { [EMPRESA_HEADER]: empresa } : {}),
  };
}

const enderecoDe = (mensagemId: string, n: number) =>
  `/api/anexo/${mensagemId}${n ? `?n=${n}` : ""}`;

async function abrirCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(NOME_CACHE);
  } catch {
    return null;
  }
}

async function doCache(endereco: string): Promise<Blob | null> {
  const c = await abrirCache();
  const r = await c?.match(endereco).catch(() => undefined);
  if (!r) return null;
  const em = Number(r.headers.get("x-nexa-salvo-em") ?? 0);
  if (!em || Date.now() - em > VALIDADE_MS) {
    void c?.delete(endereco).catch(() => undefined);
    return null;
  }
  return r.blob();
}

async function guardar(endereco: string, blob: Blob) {
  const c = await abrirCache();
  if (!c) return;
  const r = new Response(blob, {
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      "x-nexa-salvo-em": String(Date.now()),
    },
  });
  await c.put(endereco, r).catch(() => undefined);
}

export async function baixarAnexo(mensagemId: string, n = 0): Promise<Blob> {
  const chave = `${mensagemId}:${n}`;
  const atual = memoria.get(chave);
  if (atual && Date.now() - atual.em < VALIDADE_MS) return atual.p;
  const endereco = enderecoDe(mensagemId, n);
  const p = (async () => {
    const guardado = await doCache(endereco);
    if (guardado) return guardado;
    const r = await fetch(endereco, { headers: await cabecalhos() });
    if (!r.ok) throw new Error("Não foi possível carregar o arquivo.");
    const blob = await r.blob();
    void guardar(endereco, blob);
    return blob;
  })();
  p.catch(() => memoria.delete(chave));
  memoria.set(chave, { p, em: Date.now() });
  return p;
}

/** "Tentar de novo": esquece o que estava guardado e baixa outra vez. */
export function esquecerAnexo(mensagemId: string, n = 0) {
  memoria.delete(`${mensagemId}:${n}`);
  void abrirCache().then((c) => c?.delete(enderecoDe(mensagemId, n)).catch(() => undefined));
}

/** Ao sair da conta: nada de anexo fica guardado no aparelho. */
export async function limparCacheAnexos() {
  memoria.clear();
  try {
    if (typeof caches !== "undefined") await caches.delete(NOME_CACHE);
  } catch {
    /* sem Cache Storage */
  }
}

export type TemposAudio = {
  baixarMs: number;
  prepararMs: number;
  iniciarMs: number;
  via: "nativo" | "wav" | "direto" | "nenhum";
  resultado: "ok" | "erro" | "tempo";
};

/** Tempo de cada etapa do player, para o registro do servidor (só números, sem dado de cliente). */
export function registrarTemposAudio(t: TemposAudio) {
  void (async () => {
    try {
      await fetch("/api/anexo-tempo", {
        method: "POST",
        keepalive: true,
        headers: { ...(await cabecalhos()), "Content-Type": "application/json" },
        body: JSON.stringify(t),
      });
    } catch {
      /* registro é opcional */
    }
  })();
}
