/**
 * ElevenLabs (texto em fala) para o áudio da Alice. A chave fica no Secret Manager
 * (ELEVENLABS_API_KEY no Cloud Run) e nunca vai para log, erro ou tela. A ElevenLabs devolve MP3; o
 * envio passa pelo mesmo ffmpeg da barra de resposta e vira mensagem de voz OGG/Opus mono (a regra
 * que resolveu o iPhone). ELEVENLABS_API_URL troca o endereço da API (testes).
 */
import { TEMPO_MAX_SINTESE_MS, type ModeloEleven } from "./voz";

function base() {
  return (process.env["ELEVENLABS_API_URL"] || "https://api.elevenlabs.io").replace(/\/+$/, "");
}

export function elevenConfigurada(): boolean {
  return Boolean(process.env["ELEVENLABS_API_KEY"]);
}

function chave(): string {
  const k = process.env["ELEVENLABS_API_KEY"];
  if (!k) throw new Error("ElevenLabs não configurada no servidor (ELEVENLABS_API_KEY).");
  return k;
}

/** Erro curto, sem o texto falado nem a chave (vai para o registro de uso). */
function erroCurto(status: number, corpo: string) {
  let msg = corpo;
  try {
    const j = JSON.parse(corpo) as { detail?: { message?: string; status?: string } | string };
    msg =
      typeof j.detail === "string" ? j.detail : (j.detail?.message ?? j.detail?.status ?? corpo);
  } catch {
    /* corpo não é JSON */
  }
  const tipo =
    status === 429 ? "muitos pedidos seguidos ou limite do plano" : `respondeu ${status}`;
  return `ElevenLabs ${tipo} (${status}): ${String(msg).slice(0, 160)}`;
}

export async function sintetizarEleven(
  texto: string,
  voz: string,
  modelo: ModeloEleven,
  tempoMs = TEMPO_MAX_SINTESE_MS,
): Promise<{ bytes: Uint8Array } | { erro: string }> {
  try {
    const res = await fetch(
      `${base()}/v1/text-to-speech/${encodeURIComponent(voz)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": chave(),
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text: texto, model_id: modelo, language_code: "pt" }),
        signal: AbortSignal.timeout(tempoMs),
      },
    );
    if (!res.ok) return { erro: erroCurto(res.status, await res.text().catch(() => "")) };
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length) return { erro: "ElevenLabs não devolveu áudio" };
    return { bytes };
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    if (nome === "TimeoutError" || nome === "AbortError")
      return { erro: `ElevenLabs demorou mais de ${Math.round(tempoMs / 1000)} s` };
    const msg = e instanceof Error ? e.message : String(e);
    return { erro: msg.slice(0, 200) };
  }
}

export type VozEleven = { id: string; nome: string; descricao: string; previa: string | null };

/** Vozes da conta (as que a Nexa adicionou) que falam português do Brasil. */
export async function listarVozesEleven(): Promise<VozEleven[]> {
  const res = await fetch(`${base()}/v1/voices`, {
    headers: { "xi-api-key": chave() },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(erroCurto(res.status, await res.text().catch(() => "")));
  const json = (await res.json()) as {
    voices?: Array<{
      voice_id?: string;
      name?: string;
      description?: string | null;
      preview_url?: string | null;
      labels?: Record<string, string>;
      verified_languages?: Array<{ language?: string; accent?: string; locale?: string }>;
    }>;
  };
  return vozesPtBr(json.voices ?? []);
}

/** Filtra as vozes em português do Brasil (rótulos ou idiomas verificados). */
export function vozesPtBr(
  lista: Array<{
    voice_id?: string;
    name?: string;
    description?: string | null;
    preview_url?: string | null;
    labels?: Record<string, string>;
    verified_languages?: Array<{ language?: string; accent?: string; locale?: string }>;
  }>,
): VozEleven[] {
  const brasil = (t: string | undefined) => /bra[sz]il|pt-br/i.test(t ?? "");
  return lista
    .filter((v) => {
      if (!v.voice_id) return false;
      const l = v.labels ?? {};
      if (
        (l["language"] === "pt" || l["language"] === "pt-BR") &&
        (!l["accent"] || brasil(l["accent"]))
      )
        return true;
      return (v.verified_languages ?? []).some(
        (x) => x.locale === "pt-BR" || (x.language === "pt" && brasil(x.accent)),
      );
    })
    .map((v) => ({
      id: v.voice_id!,
      nome: v.name ?? v.voice_id!,
      descricao: (v.description ?? "").slice(0, 160),
      previa: v.preview_url ?? null,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}
