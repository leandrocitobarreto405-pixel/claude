// Conversão para mensagem de voz: gera um tom curto em WebM/Opus e em MP4/AAC (os formatos que os
// celulares gravam) e confere que a saída é OGG/Opus mono. Pula sem ffmpeg na máquina.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { paraOggOpus } from "./audio-voz.server";
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
  return { canais: b[i + 9], taxa: Buffer.from(b).readUInt32LE(i + 12) };
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
      assert.deepEqual(
        quadrosEPaginas(out),
        { msPorQuadro: 60, quadrosPorPagina: 50 },
        `${f}: quadros de 60 ms, páginas de 3 s`,
      );
    }
  },
);

test("entrada inválida: erro claro, sem travar", { skip: !temFfmpeg() }, async () => {
  await assert.rejects(paraOggOpus(new Uint8Array([1, 2, 3, 4])), /ffmpeg falhou/);
});
