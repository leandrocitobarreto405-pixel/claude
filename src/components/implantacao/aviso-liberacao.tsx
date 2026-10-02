import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useLiberada } from "@/lib/implantacao-cliente";
import { usePapel } from "@/lib/tenant";

/** Aviso ao lado das chaves da Alice e dos envios, enquanto a empresa não foi liberada. */
/** `oque`: o começo da frase, ex.: "A Alice fica desligada". */
export function AvisoNaoLiberada({ oque }: { oque: string }) {
  const liberada = useLiberada();
  const { papel } = usePapel();
  if (liberada) return null;
  return (
    <div className="flex items-start gap-2 rounded-botao bg-atencao p-3 text-sm text-atencao-foreground">
      <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        {oque} até terminar a configuração obrigatória da empresa e a Nexa liberar.{" "}
        {papel === "admin" ? (
          <Link to="/implantacao" className="font-bold underline">
            Ver o que falta
          </Link>
        ) : null}
      </p>
    </div>
  );
}
