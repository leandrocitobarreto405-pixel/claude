// Logo e assinatura da empresa: qualquer arquivo aceito (JPG, PNG, WebP, HEIC no Safari, PDF)
// vira PNG no navegador, com no máximo `maxLado` px no lado maior. PNG pequeno passa como está
// (preserva a transparência da assinatura).
const MAX_ENTRADA = 20 * 1024 * 1024;

export type OpcoesPng = { maxLado?: number; nome?: string };

async function bitmapDoPdf(arquivo: File): Promise<ImageBitmap> {
  const pdfjs = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) })
    .promise;
  const pagina = await pdf.getPage(1);
  const base = pagina.getViewport({ scale: 1 });
  const escala = Math.min(4, 1600 / Math.max(base.width, base.height));
  const viewport = pagina.getViewport({ scale: escala });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível desenhar o PDF.");
  await pagina.render({ canvasContext: ctx, viewport }).promise;
  return createImageBitmap(canvas);
}

async function bitmapDaImagem(arquivo: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(arquivo);
  } catch {
    const heic = /\.(heic|heif)$/i.test(arquivo.name) || /heic|heif/i.test(arquivo.type);
    throw new Error(
      heic
        ? "Este navegador não abre HEIC. No iPhone use o Safari, ou converta para JPG antes."
        : "Não foi possível abrir a imagem. Use JPG, PNG, WebP, HEIC ou PDF.",
    );
  }
}

/** Converte para PNG (data e tipo image/png). */
export async function paraPng(arquivo: File, opcoes: OpcoesPng = {}): Promise<File> {
  if (arquivo.size > MAX_ENTRADA) throw new Error("Arquivo grande demais (até 20 MB).");
  const maxLado = opcoes.maxLado ?? 1200;
  const nome = opcoes.nome ?? arquivo.name.replace(/\.[^.]+$/, "") + ".png";
  const ehPdf = arquivo.type === "application/pdf" || /\.pdf$/i.test(arquivo.name);
  const bitmap = ehPdf ? await bitmapDoPdf(arquivo) : await bitmapDaImagem(arquivo);
  const maior = Math.max(bitmap.width, bitmap.height);
  if (!ehPdf && arquivo.type === "image/png" && maior <= maxLado) {
    bitmap.close();
    return new File([arquivo], nome, { type: "image/png" });
  }
  const esc = Math.min(1, maxLado / maior);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * esc));
  canvas.height = Math.max(1, Math.round(bitmap.height * esc));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível converter a imagem.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("Não foi possível converter a imagem.");
  return new File([blob], nome, { type: "image/png" });
}
