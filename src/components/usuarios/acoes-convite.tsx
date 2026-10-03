import { toast } from "sonner";
import { Copy, MessageCircle } from "lucide-react";
import { Botao } from "@/components/nexa";
import { linkWhatsAppConvite, mensagemConvite } from "@/lib/convite";
import type { Papel } from "@/lib/tenant";

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    toast.success("Mensagem copiada. É só colar onde quiser.");
  } catch {
    // Sem permissão para a área de transferência: mostra para copiar à mão.
    window.prompt("Copie a mensagem:", texto);
  }
}

/** "Enviar convite pelo WhatsApp" e "Copiar mensagem" (o Nexa não manda e-mail de convite). */
export function AcoesConvite({
  empresa,
  email,
  papel,
  reenviar = false,
}: {
  empresa: string;
  email: string;
  papel: Papel;
  /** Na lista de convites pendentes, os rótulos falam em reenviar. */
  reenviar?: boolean;
}) {
  const texto = () => mensagemConvite({ empresa, email, papel, endereco: window.location.origin });
  return (
    <div className="flex flex-wrap gap-2">
      <Botao asChild>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            window.open(linkWhatsAppConvite(texto()), "_blank", "noopener");
          }}
        >
          <MessageCircle /> {reenviar ? "Reenviar pelo WhatsApp" : "Enviar convite pelo WhatsApp"}
        </a>
      </Botao>
      <Botao variante="contorno" onClick={() => void copiar(texto())}>
        <Copy /> Copiar mensagem
      </Botao>
    </div>
  );
}
