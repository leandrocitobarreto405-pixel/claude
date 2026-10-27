import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BellOff, X } from "lucide-react";
import { situacaoPushFn } from "@/lib/push.functions";
import {
  ehAndroid,
  ehIOS,
  inscricaoAtual,
  instalada,
  permissao,
  suportaPush,
} from "@/lib/push-cliente";

const ADIADO = "nexa_aviso_notificacoes_adiado_ate";

/**
 * Aviso no topo do app (só no celular): este aparelho não recebe notificações. Some quando o
 * aparelho está inscrito, com permissão e confirmando o recebimento. "Agora não" esconde por 1 dia.
 */
export function AvisoNotificacoesAparelho() {
  const lerFn = useServerFn(situacaoPushFn);
  const q = useQuery({ queryKey: ["push", "situacao"], queryFn: () => lerFn(), staleTime: 60_000 });
  const [estado, setEstado] = useState<"ok" | "ios_instalar" | "ativar" | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !q.data) return;
    if (!ehIOS() && !ehAndroid()) return setEstado(null); // só no celular
    try {
      if (Number(localStorage.getItem(ADIADO) ?? 0) > Date.now()) return setEstado(null);
    } catch {
      /* sem localStorage: mostra */
    }
    if (ehIOS() && !instalada()) return setEstado("ios_instalar");
    if (!suportaPush() || permissao() !== "granted") return setEstado("ativar");
    void inscricaoAtual()
      .catch(() => null)
      .then((sub) => {
        const aqui = sub && q.data.celulares.find((c) => c.endpoint === sub.endpoint);
        // Inscrito, mas há vários envios sem o aparelho confirmar: trata como desligado.
        const semConfirmar = aqui && aqui.enviosSemRecibo >= 3 && !aqui.confirmadoEm;
        setEstado(aqui && !semConfirmar ? "ok" : "ativar");
      });
  }, [q.data]);

  if (!estado || estado === "ok") return null;
  const adiar = () => {
    try {
      localStorage.setItem(ADIADO, String(Date.now() + 86_400_000));
    } catch {
      /* ignora */
    }
    setEstado(null);
  };
  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground"
    >
      <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="font-bold">Este celular não recebe notificações</p>
        {estado === "ios_instalar" ? (
          <p>
            No iPhone, as notificações só funcionam com a Nexa aberta pelo ícone da Tela de Início
            (Safari → Compartilhar → Adicionar à Tela de Início). Abra por lá e toque em{" "}
            <Link to="/notificacoes" className="font-bold underline">
              Ativar
            </Link>
            .
          </p>
        ) : (
          <p>
            <Link to="/notificacoes" className="font-bold underline">
              Ativar
            </Link>{" "}
            para saber na hora quando um cliente estiver esperando.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={adiar}
        className="grid size-8 shrink-0 place-items-center rounded-full"
        aria-label="Agora não"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
