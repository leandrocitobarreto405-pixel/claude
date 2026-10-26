// Recurso fora do plano: cadeado, "Disponível no plano X" e "Quero mudar de plano" (só avisa a
// Nexa no sininho; não muda o plano nem cobra nada).
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Botao, Card } from "@/components/nexa";
import { brl } from "@/lib/format";
import { mensagemDeErro } from "@/lib/erros";
import { pedirMudancaPlanoFn } from "@/lib/plano.functions";
import { usePlanoDaEmpresa } from "@/lib/plano-empresa";
import { planoQueTem, rotuloRecurso, temRecurso, type Recurso } from "@/lib/recursos";

export function RecursoBloqueado({
  recurso,
  compacto = false,
}: {
  recurso: Recurso;
  compacto?: boolean;
}) {
  const { data: plano } = usePlanoDaEmpresa();
  const pedir = useServerFn(pedirMudancaPlanoFn);
  const [enviando, setEnviando] = useState(false);
  const [avisado, setAvisado] = useState(false);
  const alvo = planoQueTem(plano, recurso);

  async function quero() {
    setEnviando(true);
    try {
      await pedir({ data: { recurso, plano: alvo?.codigo ?? null } });
      setAvisado(true);
      toast.success("A Nexa foi avisada e vai falar com você sobre a mudança de plano.");
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não foi possível avisar a Nexa agora."));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Card
      className={compacto ? "gap-2" : "mx-auto w-full max-w-md items-center gap-3 py-8 text-center"}
    >
      <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
        <Lock className="size-5" aria-hidden />
      </span>
      <p className="text-[15px] font-bold">{rotuloRecurso(recurso)}</p>
      <p className="text-sm text-muted-foreground">
        {alvo
          ? `Disponível no plano ${alvo.nome}${alvo.preco_mensal ? ` (${brl(alvo.preco_mensal)}/mês)` : ""}.`
          : "Disponível em outro plano."}
        {plano?.plano_nome ? ` Seu plano: ${plano.plano_nome}.` : ""}
      </p>
      <Botao variante="contorno" disabled={enviando || avisado} onClick={() => void quero()}>
        {avisado ? "Nexa avisada" : enviando ? "Avisando…" : "Quero mudar de plano"}
      </Botao>
    </Card>
  );
}

/** Mostra o conteúdo só com o recurso no plano; sem ele, o cadeado. */
export function ComRecurso({ recurso, children }: { recurso: Recurso; children: React.ReactNode }) {
  const { data: plano } = usePlanoDaEmpresa();
  return temRecurso(plano, recurso) ? (
    <>{children}</>
  ) : (
    <RecursoBloqueado recurso={recurso} compacto />
  );
}
