// Foto para o WhatsApp: qualquer imagem (JPG, PNG, WebP, HEIC do iPhone) é reaberta no
// navegador com a orientação EXIF já aplicada e gravada de novo sem a etiqueta, para não chegar
// girada no WhatsApp (que ignora a orientação). Reduz para no máximo 2048 px no lado maior
// (sobe mais rápido) e converte HEIC para JPG. Se o navegador não abrir o arquivo, avisa.
import { ehHeic } from "@/lib/caixa";

export const LADO_MAXIMO_FOTO = 2048;

async function abrirImagem(arquivo: File): Promise<ImageBitmap | HTMLImageElement> {
  // createImageBitmap com "from-image" aplica a orientação EXIF (Chrome, Safari 15+, Firefox).
  try {
    return await createImageBitmap(arquivo, { imageOrientation: "from-image" });
  } catch {
    /* tenta pelo <img>, que também respeita a orientação nos navegadores atuais */
  }
  const url = URL.createObjectURL(arquivo);
  try {
    return await new Promise<HTMLImageElement>((ok, falha) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => falha(new Error("não abriu"));
      img.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export async function prepararFoto(arquivo: File): Promise<File> {
  let imagem: ImageBitmap | HTMLImageElement;
  try {
    imagem = await abrirImagem(arquivo);
  } catch {
    if (ehHeic(arquivo.name, arquivo.type))
      throw new Error("Este navegador não abre fotos HEIC. Converta para JPG antes de enviar.");
    // Formato que o navegador não decodifica: vai como está.
    return arquivo;
  }
  const largura = "naturalWidth" in imagem ? imagem.naturalWidth : imagem.width;
  const altura = "naturalHeight" in imagem ? imagem.naturalHeight : imagem.height;
  const escala = Math.min(1, LADO_MAXIMO_FOTO / Math.max(largura, altura));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(largura * escala));
  canvas.height = Math.max(1, Math.round(altura * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) return arquivo;
  ctx.drawImage(imagem, 0, 0, canvas.width, canvas.height);
  if ("close" in imagem) imagem.close();
  const png = arquivo.type === "image/png";
  const blob = await new Promise<Blob | null>((r) =>
    canvas.toBlob(r, png ? "image/png" : "image/jpeg", 0.88),
  );
  if (!blob) {
    if (ehHeic(arquivo.name, arquivo.type)) throw new Error("Não foi possível converter a foto.");
    return arquivo;
  }
  const nome = arquivo.name.replace(/\.[a-z0-9]+$/i, "") + (png ? ".png" : ".jpg");
  return new File([blob], nome, { type: png ? "image/png" : "image/jpeg" });
}
