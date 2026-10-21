/** Iniciais do nome da empresa para o avatar sem logo ("Turbine Clean" → "TC"). */
export function iniciaisDaEmpresa(nome: string): string {
  const partes = nome
    .trim()
    .split(/\s+/)
    .filter((p) => p && !/^(de|da|do|dos|das|e|&)$/i.test(p));
  const letras = partes.slice(0, 2).map((p) => p[0]!.toUpperCase());
  return letras.join("") || "?";
}
