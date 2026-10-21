// Conversão para mensagem de voz: gera um tom curto em WebM/Opus e em MP4/AAC (os formatos que os
// celulares gravam) e confere que a saída é OGG/Opus mono. Pula sem ffmpeg na máquina.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  BITRATE_VOZ,
  MARCAR_COMO_VOZ,
  amostrasDoPacote,
  conferirOggGravado,
  ehOggOpus,
  normalizarOggOpus,
  paraOggOpus,
  prepararVoz,
} from "./audio-voz.server";
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

/**
 * O que fez o áudio gravado no app tocar no iPhone (21/10/2026), para não regredir:
 *  1. granule de cada página = amostras acumuladas (o ffmpeg herdava o início negativo do MP4 do
 *     iPhone e deixava os granules 312 amostras curtos; o decodificador de referência recusava);
 *  2. pre-skip 0 e número de série diferente de 0, como o gravador do Chatwoot;
 *  3. OpusTags só com o vendor (sem "encoder=");
 *  4. quadros de 60 ms em páginas de 3 s, mono 48 kHz, aplicação voip;
 *  5. marcação de voz (is_voice_message) ligada no envio — MARCAR_COMO_VOZ.
 * O bitrate caiu de 128 para 40 kbit/s em 21/10 (fala, arquivo 3x menor); o resto ficou igual.
 */
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
      // 7 s a 40 kbit/s ≈ 35 KB (a 128 kbit/s eram ~110 KB).
      assert.ok(out.length < 60_000, `${f}: ~7 s a 40 kbit/s (${out.length} bytes)`);
      assert.ok(out.length > 15_000, `${f}: não ficou vazio nem mudo (${out.length} bytes)`);
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

test("voz: 40 kbit/s e marcação de voz ligada (o que tocou no iPhone)", () => {
  assert.equal(BITRATE_VOZ, "40k");
  assert.equal(MARCAR_COMO_VOZ, true);
});

test("MP4 com o índice (moov) no fim também converte", { skip: !temFfmpeg() }, async () => {
  // Gerado em arquivo, sem faststart: o moov fica no fim e não dá para ler pelo pipe.
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/voz-moov-`);
  try {
    execFileSync("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=7",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      `${dir}/fim.m4a`,
    ]);
    const out = await paraOggOpus(new Uint8Array(readFileSync(`${dir}/fim.m4a`)));
    const dur = duracaoOggOpus(out);
    assert.ok(dur !== null && dur > 6.5 && dur < 7.5, `~7 s (${dur})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "OGG/Opus gravado no navegador vai cru, sem ffmpeg; o resto vai pelo ffmpeg",
  { skip: !temFfmpeg() },
  async () => {
    const ogg = await paraOggOpus(tom("webm"));
    assert.equal(ehOggOpus(ogg), true);
    assert.equal(ehOggOpus(tom("mp4")), false);
    // Cru: byte a byte igual ao que o navegador mandou (pre-skip, granules, série e tags intactos).
    const buf = Buffer.from(ogg);
    buf.writeUInt16LE(312, buf.indexOf("OpusHead") + 10);
    const direto = await prepararVoz(new Uint8Array(buf));
    assert.equal(direto.via, "opus-recorder");
    assert.deepEqual(Buffer.from(direto.bytes), buf, "sem normalização");
    assert.equal(opusHead(direto.bytes).preskip, 312);
    const convertido = await prepararVoz(tom("mp4"));
    assert.equal(convertido.via, "ffmpeg");
    // OGG quebrado (cabeçalho só) cai no ffmpeg e dá erro claro, não arquivo vazio.
    await assert.rejects(prepararVoz(ogg.slice(0, 40)), /ffmpeg falhou|sem áudio/);
  },
);

test(
  "gravação em dobro (dois gravadores, páginas intercaladas) é recusada",
  { skip: !temFfmpeg() },
  async () => {
    const ogg = await paraOggOpus(tom("webm"));
    const pags = paginasOgg(ogg).map((p) =>
      Buffer.from(ogg.subarray(p.inicio, p.inicio + 27 + p.segmentos.length + p.corpo.length)),
    );
    // Como no arquivo das 13:33 de 21/10: Head, Tags, Head, Tags, A2, B2, A3, B3…
    const dobro = Buffer.concat([
      pags[0]!,
      pags[1]!,
      pags[0]!,
      pags[1]!,
      pags[2]!,
      pags[2]!,
      pags[3]!,
      pags[3]!,
    ]);
    const c = conferirOggGravado(new Uint8Array(dobro));
    assert.equal(c.ok, false);
    await assert.rejects(prepararVoz(new Uint8Array(dobro)), /em dobro/);
    assert.deepEqual(conferirOggGravado(ogg), { ok: true });
  },
);
