import { test } from "node:test";
import assert from "node:assert/strict";
import { ehOgg, wavDeCanais } from "./audio-wav";

test("WAV mono 16 bits com cabeçalho certo", () => {
  const wav = wavDeCanais([new Float32Array([0, 1, -1, 0.5])], 48000);
  const v = new DataView(wav.buffer);
  assert.equal(new TextDecoder().decode(wav.subarray(0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(wav.subarray(8, 12)), "WAVE");
  assert.equal(v.getUint16(22, true), 1);
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(40, true), 8);
  assert.equal(wav.length, 44 + 8);
  assert.equal(v.getInt16(46, true), 0x7fff);
  assert.equal(v.getInt16(48, true), -0x8000);
});

test("dois canais viram um (média) e valores fora de -1..1 são cortados", () => {
  const wav = wavDeCanais([new Float32Array([1, 2]), new Float32Array([0, 2])], 8000);
  const v = new DataView(wav.buffer);
  assert.equal(v.getInt16(44, true), Math.trunc(0.5 * 0x7fff));
  assert.equal(v.getInt16(46, true), 0x7fff);
});

test("reconhece OGG pelo começo do arquivo", () => {
  assert.equal(ehOgg(new TextEncoder().encode("OggS....")), true);
  assert.equal(ehOgg(new TextEncoder().encode("ID3.....")), false);
  assert.equal(ehOgg(new TextEncoder().encode("OggS")), true);
  assert.equal(ehOgg(new TextEncoder().encode("Ogg")), false);
});
