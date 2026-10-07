/**
 * Divide um áudio Ogg/Opus (o áudio de voz do WhatsApp) em partes menores, sem decodificar:
 * cada parte repete as páginas de cabeçalho (OpusHead/OpusTags) e leva um trecho das páginas de
 * áudio, com a numeração, as posições e o CRC refeitos. Serve para mandar áudio longo ao
 * reconhecimento de fala síncrono, que aceita até 60 s por pedido.
 */

type Pagina = {
  bytes: Uint8Array;
  tipo: number;
  granulo: bigint;
};

const AMOSTRAS_POR_SEGUNDO = 48_000n; // Opus: posição sempre em 48 kHz.

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

function crcOgg(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) crc = ((crc << 8) ^ TABELA_CRC[((crc >>> 24) ^ b) & 0xff]!) >>> 0;
  return crc >>> 0;
}

function lerPaginas(dados: Uint8Array): Pagina[] | null {
  const paginas: Pagina[] = [];
  const v = new DataView(dados.buffer, dados.byteOffset, dados.byteLength);
  let p = 0;
  while (p + 27 <= dados.length) {
    if (
      dados[p] !== 0x4f ||
      dados[p + 1] !== 0x67 ||
      dados[p + 2] !== 0x67 ||
      dados[p + 3] !== 0x53
    )
      return null; // não é "OggS"
    const segmentos = dados[p + 26]!;
    if (p + 27 + segmentos > dados.length) return null;
    let corpo = 0;
    for (let i = 0; i < segmentos; i++) corpo += dados[p + 27 + i]!;
    const fim = p + 27 + segmentos + corpo;
    if (fim > dados.length) return null;
    paginas.push({
      bytes: dados.subarray(p, fim),
      tipo: dados[p + 5]!,
      granulo: v.getBigInt64(p + 6, true),
    });
    p = fim;
  }
  return paginas.length ? paginas : null;
}

function reescrever(
  pag: Pagina,
  sequencia: number,
  granulo: bigint,
  fimDoFluxo: boolean,
): Uint8Array {
  const b = new Uint8Array(pag.bytes);
  const v = new DataView(b.buffer);
  b[5] = (pag.tipo & ~0x04) | (fimDoFluxo ? 0x04 : 0);
  v.setBigInt64(6, granulo, true);
  v.setUint32(18, sequencia, true);
  v.setUint32(22, 0, true);
  v.setUint32(22, crcOgg(b), true);
  return b;
}

function juntar(partes: Uint8Array[]): Uint8Array {
  const total = partes.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const x of partes) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

/** Duração (s) de um Ogg/Opus, ou null se não for Ogg/Opus. */
export function duracaoOggOpus(dados: Uint8Array): number | null {
  const paginas = lerPaginas(dados);
  if (!paginas) return null;
  const cab = paginas[0]!.bytes;
  const ini = 27 + cab[26]!;
  if (new TextDecoder().decode(cab.subarray(ini, ini + 8)) !== "OpusHead") return null;
  const preSkip = BigInt(cab[ini + 10]! | (cab[ini + 11]! << 8));
  const ultimo = paginas.reduce((m, x) => (x.granulo > m ? x.granulo : m), 0n);
  return Number(ultimo - preSkip) / 48_000;
}

/**
 * Partes de no máximo `segundos` (aprox.), cada uma um Ogg/Opus completo. Devolve null se o
 * arquivo não for Ogg/Opus; devolve [dados] se já couber numa parte.
 */
export function dividirOggOpus(dados: Uint8Array, segundos = 55): Uint8Array[] | null {
  const paginas = lerPaginas(dados);
  if (!paginas) return null;
  const cab = paginas[0]!.bytes;
  const ini = 27 + cab[26]!;
  if (new TextDecoder().decode(cab.subarray(ini, ini + 8)) !== "OpusHead") return null;
  const preSkip = BigInt(cab[ini + 10]! | (cab[ini + 11]! << 8));

  // Cabeçalho: OpusHead e as páginas do OpusTags (posição 0, antes do primeiro áudio).
  let nCab = 1;
  while (nCab < paginas.length && paginas[nCab]!.granulo === 0n) nCab++;
  const cabecalho = paginas.slice(0, nCab);
  const audio = paginas.slice(nCab);
  if (!audio.length) return [dados];

  const limite = BigInt(segundos) * AMOSTRAS_POR_SEGUNDO;
  const grupos: { paginas: Pagina[]; inicio: bigint }[] = [];
  let atual: Pagina[] = [];
  let inicio = 0n; // posição antes da primeira página do grupo
  let anterior = 0n;
  for (const pag of audio) {
    const continua = (pag.tipo & 0x01) !== 0; // começa no meio de um pacote: não dá para cortar aqui
    if (atual.length && !continua && pag.granulo > 0n && pag.granulo - inicio > limite) {
      grupos.push({ paginas: atual, inicio });
      atual = [];
      inicio = anterior;
    }
    atual.push(pag);
    if (pag.granulo > 0n) anterior = pag.granulo;
  }
  if (atual.length) grupos.push({ paginas: atual, inicio });
  if (grupos.length === 1) return [dados];

  return grupos.map((g, gi) => {
    // Primeira parte mantém as posições; as outras recomeçam do zero (+ pre-skip).
    const desloc = gi === 0 ? 0n : g.inicio - preSkip;
    const corpo = g.paginas.map((pag, i) =>
      reescrever(
        pag,
        nCab + i,
        pag.granulo > 0n ? pag.granulo - desloc : pag.granulo,
        i === g.paginas.length - 1,
      ),
    );
    return juntar([...cabecalho.map((c) => c.bytes), ...corpo]);
  });
}
