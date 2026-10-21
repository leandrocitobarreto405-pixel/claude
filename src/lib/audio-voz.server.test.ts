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
    "sine=frequency=440:duration=2",
    "-ac",
    "2",
  ];
  if (formato === "webm") args.push("-c:a", "libopus", "-f", "webm");
  else args.push("-c:a", "aac", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4");
  args.push("pipe:1");
  return new Uint8Array(execFileSync("ffmpeg", args, { maxBuffer: 50 * 1024 * 1024 }));
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
      assert.ok(dur !== null && dur > 1.5 && dur < 2.5, `${f}: ~2 s (${dur})`);
      assert.ok(out.length < 60_000, `${f}: pequeno (${out.length} bytes)`);
    }
  },
);

test("entrada inválida: erro claro, sem travar", { skip: !temFfmpeg() }, async () => {
  await assert.rejects(paraOggOpus(new Uint8Array([1, 2, 3, 4])), /ffmpeg falhou/);
});
