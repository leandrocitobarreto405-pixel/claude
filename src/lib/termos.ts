// Termos de uso e privacidade (decisão C): "li e aceito" com usuário, data, IP e versão. Enquanto a
// Nexa não define a versão, ninguém é perguntado; versão nova = todos aceitam de novo.

/** Valor guardado em configuracoes_plataforma (jsonb) → texto ou null. */
export function lerTextoConfig(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

export function precisaAceitar(versaoVigente: string | null, versoesAceitas: string[]): boolean {
  return Boolean(versaoVigente) && !versoesAceitas.includes(versaoVigente as string);
}

/** Versão: texto curto, ex.: "2026-11" ou "v2". */
export function validarVersao(v: unknown): string {
  const t = String(v ?? "").trim();
  if (!/^[\w.-]{1,40}$/.test(t)) throw new Error("Versão inválida (use algo como 2026-11 ou v2).");
  return t;
}

export function validarUrlTermos(u: unknown): string {
  const t = String(u ?? "").trim();
  if (!/^https:\/\/\S{4,1000}$/.test(t))
    throw new Error("Informe o link do documento (https://…).");
  return t;
}

/** Primeiro IP de X-Forwarded-For (Cloud Run), sem porta. */
export function ipDoPedido(encaminhado: string | null, real: string | null): string | null {
  const ip = encaminhado?.split(",")[0]?.trim() || real?.trim() || "";
  return ip ? ip.slice(0, 64) : null;
}
