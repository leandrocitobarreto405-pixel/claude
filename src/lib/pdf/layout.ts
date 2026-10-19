/**
 * Montagem do PDF em A4 com pdf-lib: blocos de texto com quebra de linha e de página, tabela com
 * cabeçalho repetido na página seguinte, logo e rodapé com "página X de Y". Tudo em memória.
 */
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { FONTE_NEGRITO, FONTE_REGULAR } from "./fontes.gerado";
import { blocos as blocosDe, type Trecho } from "./marcacao";

export const A4: [number, number] = [595.28, 841.89];
const MARGEM = 48;
const RODAPE = 34;

export const CORES = {
  texto: rgb(0.13, 0.15, 0.2),
  suave: rgb(0.42, 0.45, 0.5),
  linha: rgb(0.85, 0.87, 0.9),
  fundo: rgb(0.95, 0.96, 0.97),
  destaque: rgb(0.06, 0.32, 0.43),
};

export type Fontes = { regular: PDFFont; negrito: PDFFont };

/** Tira o que a fonte não desenha (emoji etc.), para não sair um quadrado no PDF. */
export function limparTexto(texto: string, fonte: PDFFont): string {
  const ok = new Set(fonte.getCharacterSet());
  let out = "";
  for (const ch of texto.replace(/\t/g, " ")) {
    const cp = ch.codePointAt(0)!;
    out += ok.has(cp) ? ch : cp === 10 ? ch : " ";
  }
  return out;
}

export class Documento {
  readonly doc: PDFDocument;
  readonly fontes: Fontes;
  pagina!: PDFPage;
  y = 0;
  private readonly largura = A4[0] - MARGEM * 2;
  private rodape = "";

  private constructor(doc: PDFDocument, fontes: Fontes) {
    this.doc = doc;
    this.fontes = fontes;
  }

  static async criar(titulo: string, autor: string) {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const [regular, negrito] = await Promise.all([
      doc.embedFont(Buffer.from(FONTE_REGULAR, "base64"), { subset: true }),
      doc.embedFont(Buffer.from(FONTE_NEGRITO, "base64"), { subset: true }),
    ]);
    doc.setTitle(titulo);
    doc.setAuthor(autor);
    doc.setCreator("Nexa OS");
    doc.setProducer("Nexa OS");
    const d = new Documento(doc, { regular, negrito });
    d.novaPagina();
    return d;
  }

  definirRodape(texto: string) {
    this.rodape = texto;
  }

  novaPagina() {
    this.pagina = this.doc.addPage(A4);
    this.y = A4[1] - MARGEM;
  }

  /** Garante espaço; se não couber, vai para a página seguinte. */
  reservar(altura: number) {
    if (this.y - altura < MARGEM + RODAPE) this.novaPagina();
  }

  espaco(pt: number) {
    this.y -= pt;
  }

  largura_(texto: string, fonte: PDFFont, tamanho: number) {
    return fonte.widthOfTextAtSize(limparTexto(texto, fonte), tamanho);
  }

  /** Quebra trechos (com negrito) em linhas que cabem na largura. */
  quebrar(trechos: Trecho[], tamanho: number, largura: number): Trecho[][] {
    const linhas: Trecho[][] = [];
    let atual: Trecho[] = [];
    let w = 0;
    const espaco = (f: PDFFont) => f.widthOfTextAtSize(" ", tamanho);
    for (const t of trechos) {
      const fonte = t.negrito ? this.fontes.negrito : this.fontes.regular;
      const palavras = limparTexto(t.texto, fonte).split(/(\s+)/);
      for (const p of palavras) {
        if (!p) continue;
        if (/^\s+$/.test(p)) {
          if (atual.length) {
            atual.push({ texto: " ", negrito: t.negrito });
            w += espaco(fonte);
          }
          continue;
        }
        let palavra = p;
        let pw = fonte.widthOfTextAtSize(palavra, tamanho);
        if (w + pw > largura && atual.length) {
          while (atual.length && /^\s+$/.test(atual[atual.length - 1]!.texto)) atual.pop();
          linhas.push(atual);
          atual = [];
          w = 0;
        }
        // Palavra maior que a linha inteira: corta.
        while (pw > largura) {
          let n = palavra.length;
          while (n > 1 && fonte.widthOfTextAtSize(palavra.slice(0, n), tamanho) > largura) n--;
          linhas.push([{ texto: palavra.slice(0, n), negrito: t.negrito }]);
          palavra = palavra.slice(n);
          pw = fonte.widthOfTextAtSize(palavra, tamanho);
        }
        atual.push({ texto: palavra, negrito: t.negrito });
        w += pw;
      }
    }
    while (atual.length && /^\s+$/.test(atual[atual.length - 1]!.texto)) atual.pop();
    if (atual.length) linhas.push(atual);
    return linhas;
  }

  private desenharLinha(
    linha: Trecho[],
    x: number,
    tamanho: number,
    cor: RGB,
    alinhamento: "esquerda" | "centro" | "direita" = "esquerda",
    largura = this.largura,
  ) {
    const total = linha.reduce(
      (s, t) =>
        s +
        (t.negrito ? this.fontes.negrito : this.fontes.regular).widthOfTextAtSize(t.texto, tamanho),
      0,
    );
    let cx =
      alinhamento === "centro"
        ? x + (largura - total) / 2
        : alinhamento === "direita"
          ? x + largura - total
          : x;
    for (const t of linha) {
      const fonte = t.negrito ? this.fontes.negrito : this.fontes.regular;
      this.pagina.drawText(t.texto, { x: cx, y: this.y, size: tamanho, font: fonte, color: cor });
      cx += fonte.widthOfTextAtSize(t.texto, tamanho);
    }
  }

  /** Parágrafo com quebra de linha e de página. */
  texto(
    conteudo: string | Trecho[],
    opcoes: {
      tamanho?: number;
      negrito?: boolean;
      cor?: RGB;
      alinhamento?: "esquerda" | "centro" | "direita";
      recuo?: number;
      depois?: number;
      entrelinha?: number;
    } = {},
  ) {
    const tamanho = opcoes.tamanho ?? 10;
    const entre = tamanho * (opcoes.entrelinha ?? 1.4);
    const recuo = opcoes.recuo ?? 0;
    const tr: Trecho[] =
      typeof conteudo === "string"
        ? [{ texto: conteudo, negrito: Boolean(opcoes.negrito) }]
        : conteudo;
    for (const linha of this.quebrar(tr, tamanho, this.largura - recuo)) {
      this.reservar(entre);
      this.y -= tamanho;
      this.desenharLinha(
        linha,
        MARGEM + recuo,
        tamanho,
        opcoes.cor ?? CORES.texto,
        opcoes.alinhamento,
        this.largura - recuo,
      );
      this.y -= entre - tamanho;
    }
    this.y -= opcoes.depois ?? 0;
  }

  titulo(texto: string, tamanho = 13) {
    this.reservar(tamanho * 3);
    this.espaco(6);
    this.texto(texto, { tamanho, negrito: true, cor: CORES.destaque, depois: 2 });
  }

  separador() {
    this.reservar(14);
    this.espaco(6);
    this.pagina.drawLine({
      start: { x: MARGEM, y: this.y },
      end: { x: A4[0] - MARGEM, y: this.y },
      thickness: 0.6,
      color: CORES.linha,
    });
    this.espaco(8);
  }

  /** Texto editável (marcação de marcacao.ts): parágrafos, listas e subtítulos. */
  marcado(texto: string, tamanho = 10) {
    for (const b of blocosDe(texto)) {
      if (b.tipo === "subtitulo") this.titulo(b.texto, 11.5);
      else if (b.tipo === "paragrafo") this.texto(b.trechos, { tamanho, depois: 4 });
      else {
        const linhas = this.quebrar(b.trechos, tamanho, this.largura - 16);
        const entre = tamanho * 1.4;
        linhas.forEach((linha, i) => {
          this.reservar(entre);
          this.y -= tamanho;
          if (i === 0)
            this.pagina.drawText(b.marcador, {
              x: MARGEM + 2,
              y: this.y,
              size: tamanho,
              font: this.fontes.negrito,
              color: CORES.destaque,
            });
          this.desenharLinha(
            linha,
            MARGEM + 16,
            tamanho,
            CORES.texto,
            "esquerda",
            this.largura - 16,
          );
          this.y -= entre - tamanho;
        });
        this.y -= 2;
      }
    }
  }

  /** Rótulo em negrito + valor na mesma linha ("Forma de pagamento: Pix"). */
  campo(rotulo: string, valor: string, tamanho = 10.5) {
    if (!valor.trim()) return;
    this.texto(
      [
        { texto: `${rotulo} `, negrito: true },
        { texto: valor, negrito: false },
      ],
      { tamanho, depois: 2 },
    );
  }

  /**
   * Tabela: colunas com fração da largura; linhas quebram o texto da célula; na quebra de página
   * o cabeçalho é desenhado de novo.
   */
  tabela(
    colunas: Array<{
      titulo: string;
      fracao: number;
      alinhamento?: "esquerda" | "centro" | "direita";
    }>,
    linhas: string[][],
    tamanho = 9.5,
  ) {
    const larguras = colunas.map((c) => c.fracao * this.largura);
    const pad = 6;
    const entre = tamanho * 1.35;
    const cabecalho = () => {
      const alturas = colunas.map(
        (c, i) =>
          this.quebrar([{ texto: c.titulo, negrito: true }], tamanho, larguras[i]! - pad * 2)
            .length,
      );
      const h = Math.max(...alturas) * entre + pad * 2;
      this.reservar(h + entre + pad * 2);
      this.pagina.drawRectangle({
        x: MARGEM,
        y: this.y - h,
        width: this.largura,
        height: h,
        color: CORES.fundo,
      });
      let x = MARGEM;
      const topo = this.y;
      colunas.forEach((c, i) => {
        this.y = topo - pad;
        for (const l of this.quebrar(
          [{ texto: c.titulo, negrito: true }],
          tamanho,
          larguras[i]! - pad * 2,
        )) {
          this.y -= tamanho;
          this.desenharLinha(
            l,
            x + pad,
            tamanho,
            CORES.texto,
            c.alinhamento,
            larguras[i]! - pad * 2,
          );
          this.y -= entre - tamanho;
        }
        x += larguras[i]!;
      });
      this.y = topo - h;
    };
    cabecalho();
    for (const linha of linhas) {
      const quebradas = linha.map((cel, i) =>
        this.quebrar([{ texto: cel, negrito: false }], tamanho, larguras[i]! - pad * 2),
      );
      const h = Math.max(1, ...quebradas.map((q) => q.length)) * entre + pad * 2;
      if (this.y - h < MARGEM + RODAPE) {
        this.novaPagina();
        cabecalho();
      }
      const topo = this.y;
      let x = MARGEM;
      quebradas.forEach((q, i) => {
        this.y = topo - pad;
        for (const l of q) {
          this.y -= tamanho;
          this.desenharLinha(
            l,
            x + pad,
            tamanho,
            CORES.texto,
            colunas[i]!.alinhamento,
            larguras[i]! - pad * 2,
          );
          this.y -= entre - tamanho;
        }
        x += larguras[i]!;
      });
      this.y = topo - h;
      this.pagina.drawLine({
        start: { x: MARGEM, y: this.y },
        end: { x: A4[0] - MARGEM, y: this.y },
        thickness: 0.5,
        color: CORES.linha,
      });
    }
    this.espaco(8);
  }

  /** Caixa com fundo para destacar (ex.: valor total). */
  destaque(trechos: Trecho[], tamanho = 12) {
    const linhas = this.quebrar(trechos, tamanho, this.largura - 20);
    const entre = tamanho * 1.4;
    const h = linhas.length * entre + 14;
    this.reservar(h + 4);
    this.pagina.drawRectangle({
      x: MARGEM,
      y: this.y - h,
      width: this.largura,
      height: h,
      color: CORES.fundo,
    });
    const topo = this.y;
    this.y -= 7;
    for (const l of linhas) {
      this.y -= tamanho;
      this.desenharLinha(l, MARGEM + 10, tamanho, CORES.texto, "esquerda", this.largura - 20);
      this.y -= entre - tamanho;
    }
    this.y = topo - h - 8;
  }

  async imagem(bytes: Uint8Array, tipo: "png" | "jpg"): Promise<PDFImage | null> {
    try {
      return tipo === "png" ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
    } catch {
      return null;
    }
  }

  /** Cabeçalho: logo à esquerda (opcional) e as linhas da empresa ao lado. */
  cabecalhoEmpresa(logo: PDFImage | null, nome: string, linhas: string[]) {
    const maxH = 64;
    const maxW = 120;
    let lw = 0;
    let lh = 0;
    if (logo) {
      const esc = Math.min(maxW / logo.width, maxH / logo.height, 1);
      lw = logo.width * esc;
      lh = logo.height * esc;
    }
    const topo = this.y;
    const xTexto = logo ? MARGEM + lw + 16 : MARGEM;
    const largura = this.largura - (logo ? lw + 16 : 0);
    let y = topo;
    const desenhar = (t: string, tam: number, negrito: boolean, cor: RGB) => {
      for (const l of this.quebrar([{ texto: t, negrito }], tam, largura)) {
        y -= tam;
        this.y = y;
        this.desenharLinha(l, xTexto, tam, cor, "esquerda", largura);
        y -= tam * 0.45;
      }
    };
    desenhar(nome, 13, true, CORES.texto);
    for (const l of linhas) desenhar(l, 9, false, CORES.suave);
    if (logo) this.pagina.drawImage(logo, { x: MARGEM, y: topo - lh, width: lw, height: lh });
    this.y = Math.min(y, topo - lh) - 6;
    this.separador();
  }

  /** Rodapé e numeração em todas as páginas; devolve os bytes do PDF. */
  async salvar(): Promise<Uint8Array> {
    const paginas = this.doc.getPages();
    paginas.forEach((p, i) => {
      const t = `${this.rodape ? `${this.rodape}  ·  ` : ""}Página ${i + 1} de ${paginas.length}`;
      const limpo = limparTexto(t, this.fontes.regular);
      const w = this.fontes.regular.widthOfTextAtSize(limpo, 8);
      p.drawText(limpo, {
        x: (A4[0] - w) / 2,
        y: MARGEM / 2,
        size: 8,
        font: this.fontes.regular,
        color: CORES.suave,
      });
    });
    return this.doc.save();
  }
}
