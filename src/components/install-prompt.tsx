import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "turbine_install_dismissed";

export function InstallPrompt() {
  const [evento, setEvento] = useState<BeforeInstallPromptEvent | null>(null);
  const [mostrarIos, setMostrarIos] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;

    const instalado =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (instalado) return;

    const ua = window.navigator.userAgent;
    const iosSafari = /iPad|iPhone|iPod/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    const telaPequena = window.innerWidth < 1024;

    if (iosSafari && telaPequena) setMostrarIos(true);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      if (window.innerWidth < 1024) setEvento(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setEvento(null);
      setMostrarIos(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  function fechar() {
    localStorage.setItem(DISMISS_KEY, "1");
    setEvento(null);
    setMostrarIos(false);
  }

  async function instalar() {
    if (!evento) return;
    await evento.prompt();
    const escolha = await evento.userChoice;
    setEvento(null);
    if (escolha.outcome === "dismissed") localStorage.setItem(DISMISS_KEY, "1");
  }

  if (!evento && !mostrarIos) return null;

  return (
    <div className="card-surface mb-4 flex items-start gap-3 border-primary/25 p-4 lg:hidden">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
        {evento ? <Download className="size-4" /> : <Share className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-navy">Instalar o Turbine Clean</p>
        {evento ? (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Adicione o app à tela inicial para abrir mais rápido, em tela cheia.
            </p>
            <Button size="sm" className="mt-3 gap-2" onClick={instalar}>
              <Download className="size-4" />
              Instalar aplicativo
            </Button>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            No iPhone, toque em <strong>Compartilhar</strong> na barra do Safari e escolha{" "}
            <strong>Adicionar à Tela de Início</strong>.
          </p>
        )}
      </div>
      <Button variant="ghost" size="icon" aria-label="Fechar aviso de instalação" onClick={fechar}>
        <X className="size-4" />
      </Button>
    </div>
  );
}
