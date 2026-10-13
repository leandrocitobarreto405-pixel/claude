/** Regra do aviso de colchão (impermeabilização não recomendada). */
const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Item de colchão com impermeabilização (pelo nome do item e pelo serviço). */
export function colchaoComImper(textos: Array<string | null | undefined>, servico?: string | null) {
  const tudo = norm(textos.filter(Boolean).join(" "));
  return (
    tudo.includes("colchao") &&
    (tudo.includes("impermeab") || norm(servico ?? "").includes("impermeab"))
  );
}
