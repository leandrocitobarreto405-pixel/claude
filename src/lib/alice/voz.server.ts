/**
 * Google Cloud Text-to-Speech (vozes Chirp 3 HD pt-BR), com a conta de serviço do Cloud Run — a
 * mesma da transcrição; a API texttospeech.googleapis.com precisa estar ativada no projeto.
 * O áudio volta em OGG/Opus, o formato das mensagens de voz do WhatsApp.
 * TTS_API_URL troca o endereço da API (testes).
 */
import { tokenDaContaDeServico } from "@/lib/google-cloud.server";
import { TEMPO_MAX_SINTESE_MS, vozesDaApi, type Voz } from "./voz";

function base() {
  return (process.env["TTS_API_URL"] || "https://texttospeech.googleapis.com").replace(/\/+$/, "");
}

export type Sintese = { bytes: Uint8Array } | { erro: string };

/** Erro curto, sem o texto falado nem token (vai para o registro de uso). */
function erroCurto(status: number, corpo: string) {
  let msg = corpo;
  try {
    msg = (JSON.parse(corpo) as { error?: { message?: string } }).error?.message ?? corpo;
  } catch {
    /* corpo não é JSON */
  }
  return `Text-to-Speech respondeu ${status}: ${msg.slice(0, 200)}`;
}

export async function sintetizar(
  texto: string,
  voz: string,
  tempoMs = TEMPO_MAX_SINTESE_MS,
): Promise<Sintese> {
  try {
    const token = await tokenDaContaDeServico();
    const res = await fetch(`${base()}/v1/text:synthesize`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: texto },
        voice: { languageCode: "pt-BR", name: voz },
        audioConfig: { audioEncoding: "OGG_OPUS" },
      }),
      signal: AbortSignal.timeout(tempoMs),
    });
    if (!res.ok) return { erro: erroCurto(res.status, await res.text().catch(() => "")) };
    const json = (await res.json()) as { audioContent?: string };
    if (!json.audioContent) return { erro: "Text-to-Speech não devolveu áudio" };
    return { bytes: new Uint8Array(Buffer.from(json.audioContent, "base64")) };
  } catch (e) {
    const nome = e instanceof Error ? e.name : "";
    if (nome === "TimeoutError" || nome === "AbortError")
      return { erro: `Text-to-Speech demorou mais de ${Math.round(tempoMs / 1000)} s` };
    return { erro: e instanceof Error ? e.message.slice(0, 200) : String(e) };
  }
}

/** Vozes Chirp 3 HD em pt-BR que a API oferece. */
export async function listarVozes(): Promise<Voz[]> {
  const token = await tokenDaContaDeServico();
  const res = await fetch(`${base()}/v1/voices?languageCode=pt-BR`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(erroCurto(res.status, await res.text().catch(() => "")));
  const json = (await res.json()) as { voices?: Array<{ name?: string; ssmlGender?: string }> };
  return vozesDaApi(json.voices ?? []);
}
