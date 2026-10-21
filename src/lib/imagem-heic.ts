// Foto em HEIC/HEIF (iPhone, PC): o WhatsApp só aceita JPG/PNG/WebP. Converte no navegador quando
// ele sabe abrir HEIC (Safari); nos outros, avisa para converter antes.
import { ehHeic } from "@/lib/caixa";

export async function prepararFoto(arquivo: File): Promise<File> {
  if (!ehHeic(arquivo.name, arquivo.type)) return arquivo;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(arquivo);
  } catch {
    throw new Error("Este navegador não abre fotos HEIC. Converta para JPG antes de enviar.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
  if (!blob) throw new Error("Não foi possível converter a foto HEIC.");
  const nome = arquivo.name.replace(/\.(heic|heif)$/i, "") + ".jpg";
  return new File([blob], nome, { type: "image/jpeg" });
}
