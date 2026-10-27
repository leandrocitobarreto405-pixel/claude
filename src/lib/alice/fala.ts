/**
 * Texto que vira áudio (ElevenLabs ou Google): números do jeito que se fala. Valores em reais,
 * horários, porcentagens, "5x" e metros quadrados por extenso; o valor exato continua no texto
 * escrito. Números soltos ficam em algarismos (a voz lê e acerta o gênero: "2 fotos").
 */

const UNIDADES_M = [
  "zero",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
];
const UNIDADES_F = [
  "zero",
  "uma",
  "duas",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
];
const DEZ_A_DEZENOVE = [
  "dez",
  "onze",
  "doze",
  "treze",
  "catorze",
  "quinze",
  "dezesseis",
  "dezessete",
  "dezoito",
  "dezenove",
];
const DEZENAS = [
  "",
  "",
  "vinte",
  "trinta",
  "quarenta",
  "cinquenta",
  "sessenta",
  "setenta",
  "oitenta",
  "noventa",
];
const CENTENAS_M = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];
const CENTENAS_F = [
  "",
  "cento",
  "duzentas",
  "trezentas",
  "quatrocentas",
  "quinhentas",
  "seiscentas",
  "setecentas",
  "oitocentas",
  "novecentas",
];

type Genero = "m" | "f";

function ate999(n: number, g: Genero): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const partes: string[] = [];
  if (c) partes.push((g === "f" ? CENTENAS_F : CENTENAS_M)[c]!);
  if (resto) {
    if (resto < 10) partes.push((g === "f" ? UNIDADES_F : UNIDADES_M)[resto]!);
    else if (resto < 20) partes.push(DEZ_A_DEZENOVE[resto - 10]!);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${(g === "f" ? UNIDADES_F : UNIDADES_M)[u]}` : DEZENAS[d]!);
    }
  }
  return partes.join(" e ");
}

/** Inteiro por extenso (até 999.999.999), masculino ou feminino ("duas", "duzentas"). */
export function porExtenso(n: number, g: Genero = "m"): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return "zero";
  if (n > 999_999_999) return String(n);
  const milhoes = Math.floor(n / 1_000_000);
  const milhares = Math.floor((n % 1_000_000) / 1000);
  const resto = n % 1000;
  const grupos: string[] = [];
  if (milhoes) grupos.push(milhoes === 1 ? "um milhão" : `${ate999(milhoes, "m")} milhões`);
  if (milhares) grupos.push(milhares === 1 ? "mil" : `${ate999(milhares, g)} mil`);
  if (resto) grupos.push(ate999(resto, g));
  // "e" antes do último grupo quando ele é menor que 100 ou centena redonda ("mil e trinta").
  if (grupos.length > 1 && resto && (resto < 100 || resto % 100 === 0)) {
    const ultimo = grupos.pop()!;
    return `${grupos.join(" ")} e ${ultimo}`;
  }
  return grupos.join(" ");
}

/** "249,90" → "duzentos e quarenta e nove reais e noventa centavos". */
export function reaisPorExtenso(reais: number, centavos: number): string {
  const partes: string[] = [];
  if (reais) {
    const de = reais >= 1_000_000 && reais % 1_000_000 === 0 ? " de" : "";
    partes.push(`${porExtenso(reais)}${de} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos) partes.push(`${porExtenso(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero reais";
}

/** 9 → "nove da manhã", 14:30 → "duas e meia da tarde", 12 → "meio-dia". */
export function horaPorExtenso(h: number, m = 0): string {
  if (h > 23 || m > 59) return `${h}:${String(m).padStart(2, "0")}`;
  const min = m === 0 ? "" : m === 30 ? " e meia" : ` e ${porExtenso(m)}`;
  if (h === 12) return `meio-dia${min}`;
  if (h === 0) return `meia-noite${min}`;
  const periodo = h < 12 ? "da manhã" : h < 18 ? "da tarde" : "da noite";
  return `${porExtenso(h > 12 ? h - 12 : h, "f")}${min} ${periodo}`;
}

function numeroBr(t: string): number {
  return Number(t.replace(/\./g, ""));
}

/** Valores, horários, porcentagens, "5x" e m² por extenso. */
export function numerosParaFala(texto: string): string {
  return (
    texto
      // R$ 1.036,80 / R$ 50 / R$50,00
      .replace(/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/g, (_, r: string, c?: string) =>
        reaisPorExtenso(numeroBr(r), c ? Number(c.padEnd(2, "0")) : 0),
      )
      // 9h30, 9h, 09:00, 14:30 (horário)
      .replace(/\b(\d{1,2})\s?h\s?(\d{2})\b/gi, (_, h: string, m: string) =>
        horaPorExtenso(Number(h), Number(m)),
      )
      .replace(/\b(\d{1,2})\s?h\b/gi, (_, h: string) => horaPorExtenso(Number(h)))
      .replace(/\b(\d{1,2}):(\d{2})\b/g, (_, h: string, m: string) =>
        horaPorExtenso(Number(h), Number(m)),
      )
      // 20% / 5x (parcelas) / 8 m²
      .replace(/\b(\d+)(?:,(\d+))?\s?%/g, (_, i: string, d?: string) =>
        d
          ? `${porExtenso(Number(i))} vírgula ${porExtenso(Number(d))} por cento`
          : `${porExtenso(Number(i))} por cento`,
      )
      .replace(/\b(\d+)\s?x\b/gi, (_, n: string) =>
        Number(n) === 1 ? "uma vez" : `${porExtenso(Number(n), "f")} vezes`,
      )
      .replace(/\b(\d+)(?:,(\d+))?\s?m(²|2)(?![\w²])/g, (_, i: string, d?: string) =>
        d
          ? `${porExtenso(Number(i))} vírgula ${porExtenso(Number(d))} metros quadrados`
          : `${porExtenso(Number(i))} ${Number(i) === 1 ? "metro quadrado" : "metros quadrados"}`,
      )
  );
}
