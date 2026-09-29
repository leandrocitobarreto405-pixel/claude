/**
 * Transcrição dos áudios do cliente (Google Speech-to-Text v2, reconhecimento síncrono: áudios de
 * até 1 minuto). Usa a conta de serviço do Cloud Run; a API precisa estar ativada no projeto.
 * SPEECH_API_URL troca o endereço da API (testes).
 */
import { projetoDoGoogle, tokenDaContaDeServico } from "@/lib/google-cloud.server";

const MAX_BYTES = 10_000_000;

export type Transcricao = { texto: string } | { erro: string };

export async function transcreverAudio(url: string): Promise<Transcricao> {
  try {
    const arquivo = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!arquivo.ok) return { erro: `download do áudio respondeu ${arquivo.status}` };
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    if (bytes.length > MAX_BYTES) return { erro: "áudio grande demais" };

    const [token, projeto] = await Promise.all([tokenDaContaDeServico(), projetoDoGoogle()]);
    const base = (process.env["SPEECH_API_URL"] || "https://speech.googleapis.com").replace(
      /\/+$/,
      "",
    );
    const res = await fetch(
      `${base}/v2/projects/${encodeURIComponent(projeto)}/locations/global/recognizers/_:recognize`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          config: {
            autoDecodingConfig: {},
            languageCodes: ["pt-BR"],
            model: "long",
            features: { enableAutomaticPunctuation: true },
          },
          content: Buffer.from(bytes).toString("base64"),
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    if (!res.ok) {
      return {
        erro: `Speech-to-Text respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`,
      };
    }
    const json = (await res.json()) as {
      results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
    };
    const texto = (json.results ?? [])
      .map((r) => r.alternatives?.[0]?.transcript?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    return texto ? { texto } : { erro: "áudio sem fala reconhecida" };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  }
}
