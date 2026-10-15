import { MessageCircle } from "lucide-react";
import { BadgeAlerta, BlocoEscuro, Botao, CardEscuro, NumeroGrande } from "@/components/nexa";
import type { resumoAliceHoje } from "@/lib/alice.functions";

type ResumoAliceHoje = Awaited<ReturnType<typeof resumoAliceHoje>>;
import { cn } from "@/lib/utils";

/** O que a Alice está fazendo agora e o que precisa da equipe (topo de Conversas). */
export function CartaoAlice({
  a,
  aoVerPrecisam,
}: {
  a: ResumoAliceHoje | undefined;
  aoVerPrecisam: () => void;
}) {
  const precisam = a?.esperandoEquipe ?? 0;
  return (
    <CardEscuro aria-label="Alice">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <span
            aria-hidden
            className={cn("size-2 rounded-full", a?.ligada ? "bg-destaque" : "bg-desligado")}
          />
          {a ? (a.ligada ? "Alice online" : "Alice desligada") : "Alice"}
        </span>
      </div>
      <NumeroGrande
        tamanho="grande"
        disposicao="ao-lado"
        valor={a?.comAlice ?? "–"}
        legenda={a?.comAlice === 1 ? "conversa com a Alice agora" : "conversas com a Alice agora"}
        sobreEscuro
      />
      <div className="grid grid-cols-3 gap-2">
        <BlocoEscuro>
          <NumeroGrande
            tamanho="pequeno"
            valor={a?.respostasHoje ?? "–"}
            legenda="respostas hoje"
            sobreEscuro
          />
        </BlocoEscuro>
        <BlocoEscuro>
          <NumeroGrande
            tamanho="pequeno"
            valor={a?.passagensHoje ?? "–"}
            legenda="passou para a equipe"
            sobreEscuro
          />
        </BlocoEscuro>
        <BlocoEscuro>
          <NumeroGrande
            tamanho="pequeno"
            valor={a ? precisam : "–"}
            legenda="esperando a equipe"
            sobreEscuro
          />
        </BlocoEscuro>
      </div>
      <Botao variante="claro" tamanho="grande" larguraTotal onClick={aoVerPrecisam}>
        {precisam > 0 ? (
          <>
            <BadgeAlerta numero={precisam} />
            {precisam === 1
              ? "1 conversa precisa de você"
              : `${precisam} conversas precisam de você`}
          </>
        ) : (
          <>
            <MessageCircle /> Ver quem precisa da equipe
          </>
        )}
      </Botao>
    </CardEscuro>
  );
}
