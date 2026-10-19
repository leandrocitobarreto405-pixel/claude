/**
 * Entrega de um PDF gerado no servidor: no celular abre o "Compartilhar" do sistema com o arquivo
 * (WhatsApp, salvar em Arquivos...); sem esse recurso, baixa. O arquivo não fica salvo em lugar
 * nenhum do app. No iPhone o compartilhar só abre logo após um toque: se a geração demorar, o
 * PDF fica pronto e a tela mostra um segundo botão "Compartilhar".
 */
import { useState } from "react";
import { toast } from "sonner";

export type ArquivoPdf = { base64: string; nome: string };

function paraArquivo(a: ArquivoPdf): File {
  const bin = atob(a.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], a.nome, { type: "application/pdf" });
}

function baixar(arquivo: File) {
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement("a");
  a.href = url;
  a.download = arquivo.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function podeCompartilhar(arquivo: File) {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files: [arquivo] }) &&
    // No computador o "Compartilhar" atrapalha: baixa direto.
    window.matchMedia("(pointer: coarse)").matches
  );
}

/** "ok" entregue; "toque" precisa de outro toque (iPhone); "cancelado" a pessoa fechou. */
async function entregar(arquivo: File): Promise<"ok" | "toque" | "cancelado"> {
  if (!podeCompartilhar(arquivo)) {
    baixar(arquivo);
    return "ok";
  }
  try {
    await navigator.share({ files: [arquivo], title: arquivo.name });
    return "ok";
  } catch (e) {
    const nome = e instanceof DOMException ? e.name : "";
    if (nome === "AbortError") return "cancelado";
    if (nome === "NotAllowedError") return "toque";
    baixar(arquivo);
    return "ok";
  }
}

export function usePdfCompartilhavel() {
  const [gerando, setGerando] = useState(false);
  const [pronto, setPronto] = useState<File | null>(null);

  async function gerar(fn: () => Promise<ArquivoPdf>) {
    setGerando(true);
    setPronto(null);
    try {
      const arquivo = paraArquivo(await fn());
      if ((await entregar(arquivo)) === "toque") setPronto(arquivo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o PDF.");
    } finally {
      setGerando(false);
    }
  }

  async function compartilharPronto() {
    if (!pronto) return;
    const r = await entregar(pronto);
    if (r !== "toque") setPronto(null);
  }

  return { gerando, pronto, gerar, compartilharPronto };
}
