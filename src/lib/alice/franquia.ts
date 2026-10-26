/**
 * Franquia da Alice (decisão de 26/10/2026): conversas em que a Alice respondeu no mês, contra as
 * incluídas no plano. Funções puras do medidor (tela da empresa e Painel Nexa).
 */
import { brl } from "@/lib/format";

export type UsoAlice = {
  mes: string;
  usadas: number;
  franquia: number | null;
  /** O plano trava na franquia (Profissional + Alice); senão, só mede. */
  trava: boolean;
  preco_excedente: number | null;
  excedentes: number;
  valor_excedente: number;
};

export function lerUso(v: unknown): UsoAlice | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
  return {
    mes: String(o["mes"] ?? ""),
    usadas: Number(o["usadas"] ?? 0),
    franquia: n(o["franquia"]),
    trava: o["trava"] === true,
    preco_excedente: n(o["preco_excedente"]),
    excedentes: Number(o["excedentes"] ?? 0),
    valor_excedente: Number(o["valor_excedente"] ?? 0),
  };
}

/** "Alice: 120 de 150 conversas este mês" (sem franquia: só a contagem). */
export function textoMedidor(u: UsoAlice): string {
  const conversas = u.usadas === 1 ? "conversa" : "conversas";
  return u.franquia
    ? `Alice: ${u.usadas} de ${u.franquia} conversas este mês`
    : `Alice: ${u.usadas} ${conversas} este mês`;
}

/** Percentual usado (0 a 100, para a barra); sem franquia, null. */
export function percentualUsado(u: UsoAlice): number | null {
  if (!u.franquia) return null;
  return Math.min(100, Math.round((u.usadas / u.franquia) * 100));
}

export type NivelFranquia = "normal" | "atencao" | "esgotada";

/** Atenção a partir de 80%; esgotada em 100% (só faz diferença em plano que trava). */
export function nivelFranquia(u: UsoAlice): NivelFranquia {
  const p = percentualUsado(u);
  if (p === null) return "normal";
  if (p >= 100) return "esgotada";
  return p >= 80 ? "atencao" : "normal";
}

/** Frase do que acontece depois da franquia. */
export function textoDepoisDaFranquia(
  u: UsoAlice,
  continuar: boolean,
  teto: number | null,
): string {
  if (!u.trava || !u.franquia) return "Sem limite no seu plano: aqui é só acompanhamento.";
  const preco = u.preco_excedente ?? 0;
  if (!continuar || teto === null)
    return `Ao chegar nas ${u.franquia}, a Alice para e as conversas novas vão para a equipe.`;
  return `Depois das ${u.franquia}, a Alice segue até ${brl(teto)} de excedente no mês (${brl(preco)} por conversa, na próxima fatura).`;
}
