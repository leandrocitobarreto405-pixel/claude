/**
 * Áudio → mensagem de voz do WhatsApp: OGG/Opus mono 48 kHz, na mesma codificação do gravador
 * do Chatwoot (que toca como voz no iPhone): 128 kbit/s variável, quadros de 60 ms, páginas de
 * 3 s, modo voip, sem metadados extras. Serve para o áudio gravado na barra de resposta (WebM/Opus
 * no Android e no Chrome, MP4/AAC no iPhone) e para a fala da Alice (OGG/Opus do Google a 24 kHz):
 * os dois passam por aqui antes de ir ao Chatwoot. O ffmpeg vem na imagem do Cloud Run; FFMPEG
 * troca o binário (testes).
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const MAX_AUDIO_ENTRADA = 10 * 1024 * 1024;
/**
 * Mandar ao Chatwoot com a marcação de voz (is_voice_message → "voice": true na Meta)? Vale
 * para a barra de resposta e para a Alice. (Em 21/10 o problema do iPhone era o arquivo, não a
 * marcação: ver normalizarOggOpus.)
 */
export const MARCAR_COMO_VOZ = true;
/**
 * Taxa de bits da voz. O gravador do Chatwoot usa 128 kbit/s; para fala, 40 kbit/s (Opus VoIP)
 * soa igual e o arquivo fica 3x menor (sobe mais rápido e cabe em gravações longas sem passar
 * do limite do ícone de voz). Quadro de 60 ms, páginas de 3 s, tags limpas e pre-skip 0 ficam
 * iguais ao arquivo que tocou no iPhone em 21/10.
 */
export const BITRATE_VOZ = "40k";

/** Teto de segurança da saída (2 min a 128 kbit/s dão ~2 MB). */
export const MAX_VOZ_SAIDA = 4 * 1024 * 1024;

// CRC das páginas Ogg (polinômio 0x04c11db7, sem reflexão, início 0).
const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    t[i] = r >>> 0;
  }
  return t;
})();

function crcOgg(pagina: Uint8Array): number {
  let crc = 0;
  for (const b of pagina) crc = ((crc << 8) ^ TABELA_CRC[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc >>> 0;
}

type PaginaOgg = { cabecalho: Buffer; segmentos: Buffer; corpo: Buffer };

function lerPaginas(b: Buffer): PaginaOgg[] | null {
  const paginas: PaginaOgg[] = [];
  let i = 0;
  while (i < b.length) {
    if (b.subarray(i, i + 4).toString() !== "OggS" || i + 27 > b.length) return null;
    const nseg = b[i + 26]!;
    const segmentos = b.subarray(i + 27, i + 27 + nseg);
    let corpo = 0;
    for (const s of segmentos) corpo += s;
    const fim = i + 27 + nseg + corpo;
    if (fim > b.length) return null;
    paginas.push({
      cabecalho: Buffer.from(b.subarray(i, i + 27)),
      segmentos: Buffer.from(segmentos),
      corpo: Buffer.from(b.subarray(i + 27 + nseg, fim)),
    });
    i = fim;
  }
  return paginas;
}

/** Amostras (a 48 kHz) de um pacote Opus, pelo byte TOC (RFC 6716 §3.1). */
export function amostrasDoPacote(pacote: Uint8Array): number {
  if (!pacote.length) return 0;
  const toc = pacote[0]!;
  const config = toc >> 3;
  const codigo = toc & 3;
  let quadro: number;
  if (config < 12) quadro = [480, 960, 1920, 2880][config % 4]!;
  else if (config < 16) quadro = [480, 960][config % 2]!;
  else quadro = [120, 240, 480, 960][config % 4]!;
  const quadros = codigo === 0 ? 1 : codigo < 3 ? 2 : (pacote[1] ?? 0) & 0x3f;
  return quadro * quadros;
}

/** Pacotes de uma página: a tabela de segmentos junta os pedaços (255 = continua). */
function pacotesDaPagina(p: PaginaOgg): Uint8Array[] {
  const pacotes: Uint8Array[] = [];
  let pos = 0;
  let inicio = 0;
  for (const s of p.segmentos) {
    pos += s;
    if (s < 255) {
      pacotes.push(p.corpo.subarray(inicio, pos));
      inicio = pos;
    }
  }
  return pacotes;
}

/**
 * Deixa o OGG/Opus do ffmpeg exatamente como o gravador do Chatwoot (que toca como voz no
 * iPhone) e dentro do que o libopusfile aceita:
 * - pre-skip 0 no OpusHead e granule de cada página = amostras acumuladas (o ffmpeg herda o
 *   deslocamento negativo do MP4 do iPhone e grava granules menores que as amostras; o Android
 *   tolera, o iPhone recusa com "áudio não está mais disponível");
 * - OpusTags só com o vendor, sem "encoder=…";
 * - número de série diferente de 0 (o modo bitexact do ffmpeg grava 0);
 * - CRC de todas as páginas refeito.
 * Se o arquivo não tiver a estrutura esperada, devolve como está.
 */
export function normalizarOggOpus(bytes: Uint8Array, vendor = "nexa"): Uint8Array {
  const paginas = lerPaginas(Buffer.from(bytes));
  if (!paginas || paginas.length < 3) return bytes;
  const [cab, tags] = [paginas[0]!, paginas[1]!];
  if (cab.corpo.subarray(0, 8).toString() !== "OpusHead") return bytes;
  if (tags.corpo.subarray(0, 8).toString() !== "OpusTags") return bytes;
  // OpusHead: pre-skip (bytes 10-11) = 0.
  cab.corpo.writeUInt16LE(0, 10);
  // OpusTags: só o vendor.
  const v = Buffer.from(vendor, "utf8");
  tags.corpo = Buffer.concat([
    Buffer.from("OpusTags"),
    Buffer.from(new Uint32Array([v.length]).buffer),
    v,
    Buffer.from([0, 0, 0, 0]),
  ]);
  if (tags.corpo.length >= 255) return bytes;
  tags.segmentos = Buffer.from([tags.corpo.length]);
  // Granules acumulados a partir dos pacotes; a última página respeita o corte do ffmpeg
  // (granule original menor que o acumulado = áudio termina antes).
  let acumulado = 0;
  const ultima = paginas.length - 1;
  for (let k = 2; k <= ultima; k++) {
    const p = paginas[k]!;
    const original = Number(p.cabecalho.readBigInt64LE(6));
    const amostras = pacotesDaPagina(p).reduce((s, pk) => s + amostrasDoPacote(pk), 0);
    const continuacao = (p.cabecalho[5]! & 1) !== 0 && p.segmentos[p.segmentos.length - 1] === 255;
    acumulado += amostras;
    let granule = acumulado;
    if (k === ultima && original >= 0) {
      const anterior = k > 2 ? Number(paginas[k - 1]!.cabecalho.readBigInt64LE(6)) : 0;
      const duracaoOriginal = original - anterior;
      if (duracaoOriginal > 0 && duracaoOriginal < amostras)
        granule = acumulado - amostras + duracaoOriginal;
    }
    if (continuacao) granule = -1;
    p.cabecalho.writeBigInt64LE(BigInt(granule), 6);
  }
  // Série diferente de zero (fixa, para o arquivo ser reproduzível).
  const serie = cab.cabecalho.readUInt32LE(14) || 0x4e455841;
  const partes: Buffer[] = [];
  for (const p of paginas) {
    p.cabecalho[26] = p.segmentos.length;
    p.cabecalho.writeUInt32LE(serie, 14);
    p.cabecalho.writeUInt32LE(0, 22);
    const pagina = Buffer.concat([p.cabecalho, p.segmentos, p.corpo]);
    pagina.writeUInt32LE(crcOgg(pagina), 22);
    partes.push(pagina);
  }
  return new Uint8Array(Buffer.concat(partes));
}

/** Mantido pelo nome antigo. */
export const limparOpusTags = normalizarOggOpus;

/** OGG com OpusHead na primeira página (gravado no navegador pelo opus-recorder). */
export function ehOggOpus(bytes: Uint8Array): boolean {
  return (
    bytes.length > 36 &&
    Buffer.from(bytes.subarray(0, 4)).toString() === "OggS" &&
    Buffer.from(bytes.subarray(28, 36)).toString() === "OpusHead"
  );
}

/**
 * Mensagem de voz a partir do que o navegador mandou: OGG/Opus já pronto (opus-recorder) só
 * passa pela normalização (pre-skip 0, granules, série, tags), sem ffmpeg; qualquer outro
 * formato (ou um OGG que não dê para ler) vai pelo ffmpeg, como reserva.
 */
export async function prepararVoz(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; via: "opus-recorder" | "ffmpeg" }> {
  if (ehOggOpus(bytes)) {
    try {
      const out = normalizarOggOpus(bytes);
      if (out.length > MAX_VOZ_SAIDA)
        throw new Error("Áudio longo demais para mensagem de voz (até 2 min).");
      if (temAudio(out)) return { bytes: out, via: "opus-recorder" };
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("Áudio longo")) throw e;
      console.warn("Voz: OGG do navegador não normalizou; indo pelo ffmpeg", e);
    }
  }
  return { bytes: await paraOggOpus(bytes), via: "ffmpeg" };
}

/**
 * Converte o que o navegador gravou (WebM/Opus, MP4/AAC…) em mensagem de voz OGG/Opus.
 * A entrada vai para um arquivo temporário: um MP4 com o índice (moov) no fim não é legível pelo
 * pipe e o ffmpeg devolvia um OGG só com cabeçalhos, sem erro. Saída sem áudio também é erro.
 */
export async function paraOggOpus(bytes: Uint8Array, tempoMs = 20_000): Promise<Uint8Array> {
  if (bytes.length > MAX_AUDIO_ENTRADA) throw new Error("Áudio grande demais (até 10 MB).");
  const bin = process.env["FFMPEG"] || "ffmpeg";
  const entrada = join(tmpdir(), `voz-${process.pid}-${randomUUID()}`);
  await writeFile(entrada, bytes);
  try {
    const bruto = await rodarFfmpeg(bin, entrada, tempoMs);
    const out = normalizarOggOpus(bruto);
    if (out.length > MAX_VOZ_SAIDA)
      throw new Error("Áudio longo demais para mensagem de voz (até 2 min).");
    if (!temAudio(out)) throw new Error("ffmpeg falhou: a saída ficou sem áudio.");
    return out;
  } finally {
    await unlink(entrada).catch(() => undefined);
  }
}

/** Há pelo menos uma página com amostras (granule > 0). */
function temAudio(ogg: Uint8Array): boolean {
  return (lerPaginas(Buffer.from(ogg)) ?? []).some((p) => p.cabecalho.readBigInt64LE(6) > 0n);
}

function rodarFfmpeg(bin: string, entrada: string, tempoMs: number): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const p = spawn(
      bin,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        entrada,
        "-vn",
        "-map_metadata",
        "-1",
        "-fflags",
        "+bitexact",
        "-ac",
        "1",
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        BITRATE_VOZ,
        "-vbr",
        "on",
        "-frame_duration",
        "60",
        "-application",
        "voip",
        "-page_duration",
        "3000000",
        "-f",
        "ogg",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
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
      resolve(new Uint8Array(Buffer.concat(saida)));
    });
  });
}
