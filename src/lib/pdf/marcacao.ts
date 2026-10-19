/**
 * Marcação simples dos textos editáveis dos documentos (Configurações › Documentos):
 *  - linha em branco separa parágrafos;
 *  - "- " no começo da linha = item de lista; "1. " = item numerado;
 *  - "## " = subtítulo;
 *  - **trecho** = negrito.
 * Variáveis entre chaves ({empresa}, {meses}...) são trocadas antes.
 */

export type Trecho = { texto: string; negrito: boolean };
export type Bloco =
  | { tipo: "paragrafo"; trechos: Trecho[] }
  | { tipo: "item"; marcador: string; trechos: Trecho[] }
  | { tipo: "subtitulo"; texto: string };

export function trechos(linha: string): Trecho[] {
  const out: Trecho[] = [];
  const partes = linha.split("**");
  partes.forEach((p, i) => {
    if (p) out.push({ texto: p, negrito: i % 2 === 1 });
  });
  return out;
}

export function blocos(texto: string): Bloco[] {
  const out: Bloco[] = [];
  let paragrafo: string[] = [];
  const fechar = () => {
    if (paragrafo.length) out.push({ tipo: "paragrafo", trechos: trechos(paragrafo.join(" ")) });
    paragrafo = [];
  };
  for (const bruta of texto.replace(/\r/g, "").split("\n")) {
    const linha = bruta.trim();
    if (!linha) {
      fechar();
      continue;
    }
    const lista = /^[-•]\s+(.*)$/.exec(linha);
    const numero = /^(\d+)[.)]\s+(.*)$/.exec(linha);
    if (linha.startsWith("## ")) {
      fechar();
      out.push({ tipo: "subtitulo", texto: linha.slice(3).replace(/\*\*/g, "").trim() });
    } else if (lista) {
      fechar();
      out.push({ tipo: "item", marcador: "•", trechos: trechos(lista[1]!) });
    } else if (numero) {
      fechar();
      out.push({ tipo: "item", marcador: `${numero[1]}.`, trechos: trechos(numero[2]!) });
    } else {
      paragrafo.push(linha);
    }
  }
  fechar();
  return out;
}

/** Troca {variavel} pelos valores; variável sem valor some (fica vazia). */
export function substituir(
  texto: string,
  vars: Record<string, string | number | null | undefined>,
) {
  return texto.replace(/\{([a-z_]+)\}/g, (_, nome: string) => {
    const v = vars[nome];
    return v === null || v === undefined ? "" : String(v);
  });
}
