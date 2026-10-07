import { Toaster as Sonner, toast } from "sonner";
import { mensagemParaTela } from "@/lib/erro-tela";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Erro fica na tela até a pessoa fechar (dá tempo de ler); atenção, 10 s. Vale para o app todo.
// Erro técnico em inglês (do navegador ou do código) aparece em português.
const erro = toast.error;
toast.error = ((mensagem, dados) =>
  erro(typeof mensagem === "string" ? mensagemParaTela(mensagem) : mensagem, {
    duration: Infinity,
    closeButton: true,
    ...dados,
  })) as typeof toast.error;
const atencao = toast.warning;
toast.warning = ((mensagem, dados) =>
  atencao(mensagem, { duration: 10_000, ...dados })) as typeof toast.warning;

// Abaixo da área segura do topo (barra do iPhone), com folga.
const DISTANCIA = { top: "calc(env(safe-area-inset-top, 0px) + 12px)" };

/**
 * Avisos do app: fundo sólido (cores em src/styles.css), texto grande e todos visíveis (sem a
 * pilha que deixava os de trás apagados).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-center"
      offset={DISTANCIA}
      mobileOffset={DISTANCIA}
      expand
      visibleToasts={4}
      richColors
      closeButton
      duration={5000}
      toastOptions={{
        classNames: {
          toast: "toast text-base leading-snug shadow-lg",
          title: "font-semibold",
          description: "text-[0.9375rem] leading-snug",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
