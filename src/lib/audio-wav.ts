// WAV (PCM 16 bits, mono) a partir do áudio já decodificado. O Safari não toca OGG/Opus no
// <audio>: o player decodifica o OGG no aparelho e entrega o WAV ao <audio>, que toca mesmo com o
// iPhone no silencioso (a Web Audio API fica muda nesse modo).

/** WAV mono 16 bits: os canais são misturados num só. */
export function wavDeCanais(canais: Float32Array[], taxa: number): Uint8Array {
  const amostras = canais.reduce((m, c) => Math.max(m, c.length), 0);
  const dados = amostras * 2;
  const out = new Uint8Array(44 + dados);
  const v = new DataView(out.buffer);
  const texto = (pos: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[pos + i] = s.charCodeAt(i);
  };
  texto(0, "RIFF");
  v.setUint32(4, 36 + dados, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  v.setUint32(16, 16, true); // tamanho do bloco fmt
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, taxa, true);
  v.setUint32(28, taxa * 2, true); // bytes por segundo
  v.setUint16(32, 2, true); // bytes por amostra
  v.setUint16(34, 16, true); // bits por amostra
  texto(36, "data");
  v.setUint32(40, dados, true);
  const n = canais.length || 1;
  for (let i = 0; i < amostras; i++) {
    let soma = 0;
    for (const c of canais) soma += c[i] ?? 0;
    const s = Math.max(-1, Math.min(1, soma / n));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/** O arquivo começa com "OggS" (OGG, normalmente Opus no WhatsApp). */
export function ehOgg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  );
}
