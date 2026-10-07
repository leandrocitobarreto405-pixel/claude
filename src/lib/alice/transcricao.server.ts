/**
 * Transcrição dos áudios do cliente (Google Speech-to-Text v2, reconhecimento síncrono: até 1 minuto
 * por pedido; áudio de voz mais longo é dividido em partes de 55 s, até ~10 minutos). Usa a conta
 * de serviço do Cloud Run; a API precisa estar ativada no projeto.
 * SPEECH_API_URL troca o endereço da API (testes).
 */
import { projetoDoGoogle, tokenDaContaDeServico } from "@/lib/google-cloud.server";

const MAX_BYTES = 10_000_000;

export type Transcricao = { texto: string } | { erro: string };

/** Até 11 partes de 55 s (~10 min): áudio maior é transcrito só no começo. */
const MAX_PARTES = 11;

async function reconhecer(
  bytes: Uint8Array,
  token: string,
  projeto: string,
): Promise<{ texto: string } | { erro: string }> {
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
    return { erro: `Speech-to-Text respondeu ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  const json = (await res.json()) as {
    results?: Array<{ alternatives?: Array<{ transcript?: string }> }>;
  };
  return {
    texto: (json.results ?? [])
      .map((r) => r.alternatives?.[0]?.transcript?.trim() ?? "")
      .filter(Boolean)
      .join(" ")
      .trim(),
  };
}

export async function transcreverAudio(url: string): Promise<Transcricao> {
  try {
    const arquivo = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!arquivo.ok) return { erro: `download do áudio respondeu ${arquivo.status}` };
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    if (bytes.length > MAX_BYTES) return { erro: "áudio grande demais" };

    // O reconhecimento síncrono aceita até 60 s: áudio de voz (Ogg/Opus) mais longo vai em partes.
    const { dividirOggOpus, duracaoOggOpus } = await import("./ogg-opus");
    const duracao = duracaoOggOpus(bytes);
    let partes =
      duracao !== null && duracao > 58 ? (dividirOggOpus(bytes, 55) ?? [bytes]) : [bytes];
    const cortado = partes.length > MAX_PARTES;
    if (cortado) partes = partes.slice(0, MAX_PARTES);

    const [token, projeto] = await Promise.all([tokenDaContaDeServico(), projetoDoGoogle()]);
    const textos: string[] = [];
    for (const parte of partes) {
      const r = await reconhecer(parte, token, projeto);
      if ("erro" in r) return r;
      if (r.texto) textos.push(r.texto);
    }
    const texto = textos.join(" ").trim();
    if (!texto) return { erro: "áudio sem fala reconhecida" };
    return {
      texto: cortado
        ? `${texto} [o áudio continua depois de ${Math.round((MAX_PARTES * 55) / 60)} minutos; o restante não foi transcrito]`
        : texto,
    };
  } catch (e) {
    return { erro: e instanceof Error ? e.message : String(e) };
  }
}
