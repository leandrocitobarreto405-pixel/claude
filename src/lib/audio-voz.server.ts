/**
 * Áudio gravado no celular → mensagem de voz do WhatsApp: OGG/Opus, mono, 48 kHz, ~32 kbit/s.
 * O navegador grava no que o celular permite (WebM/Opus no Android e no Chrome, MP4/AAC no
 * iPhone); o ffmpeg da imagem do Cloud Run converte tudo para o único formato que chega como voz
 * (foto de perfil + microfone), o mesmo das respostas da Alice. FFMPEG troca o binário (testes).
 */
import { spawn } from "node:child_process";

export const MAX_AUDIO_ENTRADA = 10 * 1024 * 1024;
/** Acima disto o WhatsApp mostra o áudio como arquivo, não como voz. */
export const MAX_VOZ_SAIDA = 512 * 1024;

export async function paraOggOpus(bytes: Uint8Array, tempoMs = 20_000): Promise<Uint8Array> {
  if (bytes.length > MAX_AUDIO_ENTRADA) throw new Error("Áudio grande demais (até 10 MB).");
  const bin = process.env["FFMPEG"] || "ffmpeg";
  return new Promise<Uint8Array>((resolve, reject) => {
    const p = spawn(
      bin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        "32k",
        "-application",
        "voip",
        "-f",
        "ogg",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const saida: Buffer[] = [];
    let erro = "";
    const timer = setTimeout(() => {
      p.kill("SIGKILL");
      reject(new Error("A conversão do áudio demorou demais."));
    }, tempoMs);
    p.stdout.on("data", (d: Buffer) => saida.push(d));
    p.stderr.on("data", (d: Buffer) => (erro += d.toString("utf8").slice(0, 500)));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg indisponível: ${e.message}`));
    });
    p.on("close", (codigo) => {
      clearTimeout(timer);
      if (codigo !== 0) return reject(new Error(`ffmpeg falhou (${codigo}): ${erro.trim()}`));
      const out = new Uint8Array(Buffer.concat(saida));
      if (out.length > MAX_VOZ_SAIDA)
        return reject(new Error("Áudio longo demais para mensagem de voz (até ~2 min)."));
      resolve(out);
    });
    p.stdin.on("error", () => undefined);
    p.stdin.end(Buffer.from(bytes));
  });
}
