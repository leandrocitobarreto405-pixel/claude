/**
 * Roteiro da Alice por serviço (26/10/2026): as "Instruções da Alice" viram o núcleo, sempre
 * carregado, e cada serviço tem um módulo (colchão, sofá, impermeabilização…) que a Alice carrega
 * com `carregar_modulo` quando identifica o serviço. Os módulos carregados ficam guardados na
 * conversa e vêm junto nas próximas respostas. Empresa sem módulos: roteiro inteiro, como antes.
 * Funções puras.
 */

export type ModuloRoteiro = { chave: string; titulo: string; texto: string };

const CHAVE = /^[a-z0-9_]{2,30}$/;
export const MAX_MODULOS = 20;
export const MAX_TEXTO_MODULO = 20000;

/** Valor salvo (jsonb) → lista válida, sem chave repetida nem módulo vazio. */
export function modulosDaConfig(v: unknown): ModuloRoteiro[] {
  if (!Array.isArray(v)) return [];
  const vistos = new Set<string>();
  const out: ModuloRoteiro[] = [];
  for (const m of v as Array<Record<string, unknown>>) {
    const chave = String(m?.["chave"] ?? "")
      .trim()
      .toLowerCase();
    const titulo = String(m?.["titulo"] ?? "").trim();
    const texto = String(m?.["texto"] ?? "").trim();
    if (!CHAVE.test(chave) || vistos.has(chave) || !titulo || !texto) continue;
    vistos.add(chave);
    out.push({ chave, titulo: titulo.slice(0, 60), texto: texto.slice(0, MAX_TEXTO_MODULO) });
    if (out.length >= MAX_MODULOS) break;
  }
  return out;
}

/** Chave a partir do título (para módulo novo na tela): "Sofá e estofados" → "sofa_e_estofados". */
export function chaveDoTitulo(titulo: string): string {
  return (
    titulo
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 30) || "modulo"
  );
}

/** Só as chaves que existem na empresa, na ordem dos módulos, sem repetir. */
export function chavesValidas(modulos: ModuloRoteiro[], pedidas: readonly string[]): string[] {
  const set = new Set(pedidas.map((c) => c.trim().toLowerCase()));
  return modulos.filter((m) => set.has(m.chave)).map((m) => m.chave);
}

/** Linha das regras técnicas: quais módulos existem e como carregar. */
export function linhaDosModulos(modulos: ModuloRoteiro[]): string {
  if (!modulos.length) return "";
  return `
- Roteiro por serviço: as instruções da empresa abaixo são o núcleo. Assim que identificar o serviço, carregue o módulo com carregar_modulo antes de diagnosticar ou orçar (mais de um serviço: todos os necessários). Módulos: ${modulos.map((m) => `${m.chave} (${m.titulo})`).join(", ")}. Os módulos já carregados nesta conversa vêm no bloco "Módulos carregados" e valem como parte das instruções da empresa.`;
}

/** Bloco com os módulos carregados (texto já com os campos da empresa aplicados). */
export function blocoDosModulos(
  modulos: ModuloRoteiro[],
  chaves: readonly string[],
  aplicar: (texto: string) => string = (t) => t,
): string {
  const escolhidos = chavesValidas(modulos, chaves)
    .map((c) => modulos.find((m) => m.chave === c)!)
    .filter(Boolean);
  if (!escolhidos.length) return "";
  return [
    "# Módulos carregados nesta conversa (parte das instruções da empresa)",
    ...escolhidos.map((m) => `## Módulo: ${m.titulo}\n${aplicar(m.texto)}`),
  ].join("\n\n");
}

/** Junta os módulos novos aos já carregados (sem repetir, na ordem da empresa). */
export function juntarCarregados(
  modulos: ModuloRoteiro[],
  atuais: readonly string[],
  novos: readonly string[],
): string[] {
  return chavesValidas(modulos, [...atuais, ...novos]);
}
