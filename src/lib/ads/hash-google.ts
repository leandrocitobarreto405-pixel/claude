/**
 * Telefone e e-mail no formato das conversões otimizadas para leads do Google Ads: normalizados e
 * com SHA-256 em hexadecimal minúsculo. Regras do Google ("Format user data", Data Manager):
 *  - e-mail: sem espaços, minúsculo; gmail.com/googlemail.com sem pontos e sem "+sufixo" antes do @;
 *  - telefone: E.164 (+ e só dígitos).
 * https://developers.google.com/data-manager/api/devguides/concepts/formatting
 */
import { createHash } from "node:crypto";

const sha256 = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");

export function normalizarEmail(email: string | null | undefined): string | null {
  const e = String(email ?? "")
    .replace(/\s+/g, "")
    .toLowerCase();
  const m = /^([^@]+)@([^@]+\.[^@]+)$/.exec(e);
  if (!m) return null;
  const dominio = m[2]!;
  let local = m[1]!;
  if (dominio === "gmail.com" || dominio === "googlemail.com") {
    local = local.split("+")[0]!.replace(/\./g, "");
    if (!local) return null;
  }
  return `${local}@${dominio}`;
}

/**
 * Telefone do Brasil em E.164. Aceita com ou sem 55; celular que veio do WhatsApp sem o nono
 * dígito (55 + DDD + 8 dígitos começando com 6–9) ganha o 9. Outro país (+ com código ≠ 55) fica
 * como veio, se tiver de 8 a 15 dígitos.
 */
export function normalizarTelefone(telefone: string | null | undefined): string | null {
  const bruto = String(telefone ?? "").trim();
  let d = bruto.replace(/\D/g, "");
  if (!d) return null;
  if (bruto.startsWith("+") && !d.startsWith("55"))
    return d.length >= 8 && d.length <= 15 ? `+${d}` : null;
  if (d.length === 12 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (!d.startsWith("55")) return null;
  if (d.length === 12 && /[6-9]/.test(d[4]!)) d = `${d.slice(0, 4)}9${d.slice(4)}`;
  if (d.length !== 12 && d.length !== 13) return null;
  if (d[2] === "0" || d[3] === "0") return null;
  return `+${d}`;
}

export function hashEmail(email: string | null | undefined): string | null {
  const n = normalizarEmail(email);
  return n ? sha256(n) : null;
}

export function hashTelefone(telefone: string | null | undefined): string | null {
  const n = normalizarTelefone(telefone);
  return n ? sha256(n) : null;
}
