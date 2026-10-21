// Conversão para mensagem de voz: gera um tom curto em WebM/Opus e em MP4/AAC (os formatos que os
// celulares gravam) e confere que a saída é OGG/Opus mono. Pula sem ffmpeg na máquina.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { amostrasDoPacote, normalizarOggOpus, paraOggOpus } from "./audio-voz.server";
import { duracaoOggOpus } from "./alice/ogg-opus";

function temFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tom(formato: "webm" | "mp4"): Uint8Array {
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=7",
    "-ac",
    "2",
  ];
  if (formato === "webm") args.push("-c:a", "libopus", "-f", "webm");
  else args.push("-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4");
  args.push("pipe:1");
  return new Uint8Array(execFileSync("ffmpeg", args, { maxBuffer: 50 * 1024 * 1024 }));
}

/** Lê as páginas Ogg: quantos quadros por página e a duração de cada quadro (como o Chatwoot). */
function quadrosEPaginas(b: Uint8Array) {
  const buf = Buffer.from(b);
  let i = 0;
  const paginas: Array<{ granule: number; quadros: number }> = [];
  for (;;) {
    i = buf.indexOf("OggS", i);
    if (i < 0) break;
    const granule = Number(buf.readBigInt64LE(i + 6));
    const nseg = buf[i + 26]!;
    const segs = buf.subarray(i + 27, i + 27 + nseg);
    let quadros = 0;
    let corpo = 0;
    for (const s of segs) {
      corpo += s;
      if (s < 255) quadros++;
    }
    paginas.push({ granule, quadros });
    i = i + 27 + nseg + corpo;
  }
  // Páginas 0 e 1 são os cabeçalhos; a terceira é a primeira cheia (50 quadros de 60 ms = 3 s).
  const p = paginas[2]!;
  const anterior = paginas[1]!.granule;
  return { msPorQuadro: (p.granule - anterior) / p.quadros / 48, quadrosPorPagina: p.quadros };
}

function opusHead(b: Uint8Array) {
  const i = Buffer.from(b).indexOf("OpusHead");
  assert.ok(i >= 0, "OpusHead presente");
  return {
    canais: b[i + 9],
    preskip: Buffer.from(b).readUInt16LE(i + 10),
    taxa: Buffer.from(b).readUInt32LE(i + 12),
  };
}

/** Páginas do Ogg: cabeçalho, segmentos e corpo. */
function paginasOgg(b: Uint8Array) {
  const buf = Buffer.from(b);
  const out: Array<{ inicio: number; granule: number; segmentos: Buffer; corpo: Buffer }> = [];
  let i = 0;
  while (i < buf.length) {
    const nseg = buf[i + 26]!;
    const segmentos = buf.subarray(i + 27, i + 27 + nseg);
    let corpo = 0;
    for (const s of segmentos) corpo += s;
    out.push({
      inicio: i,
      granule: Number(buf.readBigInt64LE(i + 6)),
      segmentos,
      corpo: buf.subarray(i + 27 + nseg, i + 27 + nseg + corpo),
    });
    i += 27 + nseg + corpo;
  }
  return out;
}

/** O granule de cada página de áudio bate com a soma dos pacotes (sem deslocamento). */
function granulesConsistentes(b: Uint8Array) {
  const pags = paginasOgg(b);
  let soma = 0;
  for (const p of pags.slice(2)) {
    let pos = 0;
    let inicio = 0;
    for (const s of p.segmentos) {
      pos += s;
      if (s < 255) {
        soma += amostrasDoPacote(p.corpo.subarray(inicio, pos));
        inicio = pos;
      }
    }
    if (p !== pags[pags.length - 1] && p.granule !== soma) return false;
    if (p === pags[pags.length - 1] && (p.granule > soma || p.granule <= 0)) return false;
  }
  return true;
}

test(
  "WebM/Opus (Android) e MP4/AAC (iPhone) viram OGG/Opus mono",
  { skip: !temFfmpeg() },
  async () => {
    for (const f of ["webm", "mp4"] as const) {
      const out = await paraOggOpus(tom(f));
      assert.equal(Buffer.from(out.slice(0, 4)).toString(), "OggS", `${f}: é OGG`);
      const h = opusHead(out);
      assert.equal(h.canais, 1, `${f}: mono`);
      assert.equal(h.taxa, 48000, `${f}: 48 kHz`);
      const dur = duracaoOggOpus(out);
      assert.ok(dur !== null && dur > 6.5 && dur < 7.5, `${f}: ~7 s (${dur})`);
      assert.ok(out.length < 200_000, `${f}: ~7 s a até 128 kbit/s (${out.length} bytes)`);
      assert.equal(Buffer.from(out).indexOf("encoder="), -1, `${f}: sem metadados extras`);
      const cab = opusHead(out);
      assert.equal(cab.preskip, 0, `${f}: pre-skip 0 como o gravador do Chatwoot`);
      assert.notEqual(Buffer.from(out).readUInt32LE(14), 0, `${f}: série diferente de 0`);
      assert.ok(granulesConsistentes(out), `${f}: granule de cada página = amostras acumuladas`);
      const qp = quadrosEPaginas(out);
      assert.equal(qp.quadrosPorPagina, 50, `${f}: páginas de 3 s (50 quadros)`);
      assert.equal(Math.round(qp.msPorQuadro), 60, `${f}: quadros de 60 ms`);
    }
  },
);

test("entrada inválida: erro claro, sem travar", { skip: !temFfmpeg() }, async () => {
  await assert.rejects(paraOggOpus(new Uint8Array([1, 2, 3, 4])), /ffmpeg falhou/);
});

test(
  "granule deslocado (MP4 do iPhone): normalizar corrige e o decodificador aceita",
  { skip: !temFfmpeg() },
  async () => {
    const bom = await paraOggOpus(tom("mp4"));
    // Simula o que o ffmpeg faz com o início negativo do MP4 do iPhone: granules 312 amostras
    // menores que as amostras, pre-skip 312 e OpusTags com encoder.
    const buf = Buffer.from(bom);
    const pags = paginasOgg(bom);
    for (const p of pags.slice(2)) buf.writeBigInt64LE(BigInt(p.granule - 312), p.inicio + 6);
    const h = buf.indexOf("OpusHead");
    buf.writeUInt16LE(312, h + 10);
    assert.equal(granulesConsistentes(new Uint8Array(buf)), false, "arquivo quebrado de propósito");
    const consertado = normalizarOggOpus(new Uint8Array(buf));
    assert.ok(granulesConsistentes(consertado), "granules refeitos pelos pacotes");
    assert.equal(opusHead(consertado).preskip, 0);
    // Decodifica inteiro sem erro (ffmpeg) e com o mesmo tamanho do bom.
    const { execFileSync } = await import("node:child_process");
    const tmp = `${process.env["TMPDIR"] ?? "/tmp"}/voz-teste-${process.pid}.ogg`;
    const { writeFileSync, unlinkSync } = await import("node:fs");
    writeFileSync(tmp, consertado);
    try {
      execFileSync("ffmpeg", ["-v", "error", "-i", tmp, "-f", "null", "-"], { stdio: "pipe" });
    } finally {
      unlinkSync(tmp);
    }
    assert.equal(amostrasDoPacote(new Uint8Array([0x58])), 2880, "TOC: SILK WB 60 ms, 1 quadro");
    assert.equal(amostrasDoPacote(new Uint8Array([0xfb, 0x03])), 2880, "TOC: CELT FB 20 ms × 3");
  },
);
