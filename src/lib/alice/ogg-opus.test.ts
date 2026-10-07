import { test } from "node:test";
import assert from "node:assert/strict";
import { dividirOggOpus, duracaoOggOpus } from "./ogg-opus";

// Ogg/Opus sintético: OpusHead, OpusTags e páginas de áudio de 1 s (pacotes falsos; o divisor
// não decodifica). CRC calculado como no Ogg, para conferir que as partes saem válidas.
const TABELA = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();
const crc = (b: Uint8Array) => {
  let c = 0;
  for (const x of b) c = ((c << 8) ^ TABELA[((c >>> 24) ^ x) & 0xff]!) >>> 0;
  return c >>> 0;
};

function pagina(tipo: number, granulo: bigint, seq: number, corpo: Uint8Array): Uint8Array {
  const b = new Uint8Array(27 + 1 + corpo.length);
  const v = new DataView(b.buffer);
  b.set([0x4f, 0x67, 0x67, 0x53], 0);
  b[5] = tipo;
  v.setBigInt64(6, granulo, true);
  v.setUint32(14, 1234, true);
  v.setUint32(18, seq, true);
  b[26] = 1;
  b[27] = corpo.length;
  b.set(corpo, 28);
  v.setUint32(22, crc(b), true);
  return b;
}

function oggSintetico(segundos: number): Uint8Array {
  const head = new Uint8Array(19);
  head.set(new TextEncoder().encode("OpusHead"), 0);
  head[8] = 1;
  head[9] = 1;
  head[10] = 0x38; // pre-skip 312
  head[11] = 0x01;
  const tags = new TextEncoder().encode("OpusTags\0\0\0\0\0\0\0\0");
  const paginas = [pagina(0x02, 0n, 0, head), pagina(0, 0n, 1, tags)];
  for (let s = 1; s <= segundos; s++)
    paginas.push(
      pagina(
        s === segundos ? 0x04 : 0,
        312n + BigInt(s) * 48_000n,
        s + 1,
        new Uint8Array(40).fill(s),
      ),
    );
  const total = paginas.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of paginas) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

function lerPaginas(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: { seq: number; granulo: bigint; tipo: number; crcOk: boolean }[] = [];
  let p = 0;
  while (p < b.length) {
    const n = b[p + 26]!;
    let corpo = 0;
    for (let i = 0; i < n; i++) corpo += b[p + 27 + i]!;
    const pag = new Uint8Array(b.subarray(p, p + 27 + n + corpo));
    const lido = new DataView(pag.buffer).getUint32(22, true);
    new DataView(pag.buffer).setUint32(22, 0, true);
    out.push({
      seq: v.getUint32(p + 18, true),
      granulo: v.getBigInt64(p + 6, true),
      tipo: b[p + 5]!,
      crcOk: crc(pag) === lido,
    });
    p += 27 + n + corpo;
  }
  return out;
}

test("áudio curto não é dividido; não-Ogg devolve null", () => {
  const curto = oggSintetico(30);
  assert.equal(duracaoOggOpus(curto), 30);
  assert.deepEqual(dividirOggOpus(curto, 55), [curto]);
  assert.equal(dividirOggOpus(new TextEncoder().encode("ID3 mp3 qualquer"), 55), null);
  assert.equal(duracaoOggOpus(new TextEncoder().encode("nada")), null);
});

test("áudio de 5 min vira partes de até 55 s, válidas e recomeçando do zero", () => {
  const longo = oggSintetico(300);
  assert.equal(duracaoOggOpus(longo), 300);
  const partes = dividirOggOpus(longo, 55)!;
  assert.equal(partes.length, 6);
  const duracoes = partes.map((p) => duracaoOggOpus(p)!);
  assert.ok(
    duracoes.every((d) => d <= 55),
    `durações: ${duracoes.join(", ")}`,
  );
  assert.equal(
    duracoes.reduce((a, b) => a + b, 0),
    300,
  );
  for (const parte of partes) {
    const pags = lerPaginas(parte);
    assert.ok(
      pags.every((x) => x.crcOk),
      "CRC de todas as páginas",
    );
    assert.deepEqual(
      pags.map((x) => x.seq),
      pags.map((_, i) => i),
      "sequência recomeça em cada parte",
    );
    assert.equal(pags[0]!.tipo & 0x02, 0x02, "começa com o OpusHead");
    assert.equal(pags[pags.length - 1]!.tipo & 0x04, 0x04, "última página marca o fim");
    assert.equal(pags[2]!.granulo, 312n + 48_000n, "primeiro áudio de cada parte começa em 1 s");
  }
});
