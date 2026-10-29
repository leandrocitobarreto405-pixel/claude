// Preparação do áudio para o <audio> do player das conversas: Chrome e Android tocam o OGG/Opus
// direto; o Safari não toca OGG, então o arquivo é decodificado no aparelho (ogg-opus-decoder,
// WebAssembly) e vira WAV. m4a e mp3 vão direto.
import { ehOgg, wavDeCanais } from "@/lib/audio-wav";

export type ViaAudio = "nativo" | "wav" | "direto";

type DecodificadorOgg = {
  OggOpusDecoder: new () => {
    ready: Promise<void>;
    decodeFile: (
      dados: Uint8Array,
    ) => Promise<{ channelData: Float32Array[]; samplesDecoded: number; sampleRate: number }>;
    free: () => void;
  };
};

let decodificador: Promise<DecodificadorOgg> | null = null;

/**
 * ogg-opus-decoder (WebAssembly) servido de /ogg-opus-decoder/ como script comum: importado
 * como módulo, o empacotador do servidor travava; e ele só é preciso no navegador.
 */
function carregarDecodificador(): Promise<DecodificadorOgg> {
  if (!decodificador) {
    decodificador = new Promise<DecodificadorOgg>((ok, falha) => {
      const chave = "ogg-opus-decoder" as const;
      const w = window as unknown as Record<string, DecodificadorOgg | undefined>;
      if (w[chave]) return ok(w[chave]!);
      const script = document.createElement("script");
      script.src = "/ogg-opus-decoder/ogg-opus-decoder.min.js";
      script.async = true;
      script.onload = () => (w[chave] ? ok(w[chave]!) : falha(new Error("decodificador vazio")));
      script.onerror = () => falha(new Error("decodificador não carregou"));
      document.head.appendChild(script);
    });
    decodificador.catch(() => (decodificador = null));
  }
  return decodificador;
}

let oggNativo: boolean | null = null;

/** O navegador toca OGG/Opus no <audio> (Chrome, Android, Firefox). */
export function tocaOggNativo(): boolean {
  if (oggNativo === null) {
    try {
      oggNativo = document.createElement("audio").canPlayType('audio/ogg; codecs="opus"') !== "";
    } catch {
      oggNativo = false;
    }
  }
  return oggNativo;
}

/** Ao abrir a conversa: no Safari, o decodificador já fica carregado antes do primeiro play. */
export function preCarregarDecodificador() {
  if (typeof window === "undefined" || tocaOggNativo()) return;
  void carregarDecodificador().catch(() => undefined);
}

async function paraWav(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { OggOpusDecoder } = await carregarDecodificador();
  const dec = new OggOpusDecoder();
  await dec.ready;
  try {
    const { channelData, samplesDecoded, sampleRate } = await dec.decodeFile(bytes);
    if (!samplesDecoded || !channelData.length) throw new Error("áudio vazio");
    const canais = channelData.map((c) => c.subarray(0, samplesDecoded));
    return new Blob([wavDeCanais(canais, sampleRate) as Uint8Array<ArrayBuffer>], {
      type: "audio/wav",
    });
  } finally {
    dec.free();
  }
}

/** Arquivo pronto para o <audio>: OGG direto se o navegador toca, WAV se não; o resto, direto. */
export async function prepararAudio(
  blob: Blob,
  forcarWav: boolean,
): Promise<{ url: string; via: ViaAudio }> {
  const ogg = ehOgg(new Uint8Array(await blob.slice(0, 4).arrayBuffer()));
  if (!ogg) return { url: URL.createObjectURL(blob), via: "direto" };
  if (!forcarWav && tocaOggNativo())
    return { url: URL.createObjectURL(new Blob([blob], { type: "audio/ogg" })), via: "nativo" };
  return { url: URL.createObjectURL(await paraWav(blob)), via: "wav" };
}

let silencio: string | null = null;

/** WAV mudo e curto: tocado no próprio toque, libera o <audio> no iPhone para o play depois do download. */
export function urlSilencio(): string {
  if (!silencio) {
    const wav = wavDeCanais([new Float32Array(400)], 8000);
    silencio = URL.createObjectURL(
      new Blob([wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }),
    );
  }
  return silencio;
}
