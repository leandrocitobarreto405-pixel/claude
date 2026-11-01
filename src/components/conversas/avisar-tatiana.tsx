import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, Chip } from "@/components/nexa";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  avisarTatianaFn,
  meusAvisosFn,
  type AvisoTela,
  type TipoAviso,
} from "@/lib/avisos-tatiana.functions";
import { dateBR } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX = 300;

/** Texto curto do que o aviso virou (para a pessoa e para o admin). */
export function rotuloVirou(a: AvisoTela): {
  texto: string;
  tom: "neutro" | "sucesso" | "problema";
} {
  if (a.virou.situacao === "aguardando") return { texto: "na próxima revisão", tom: "neutro" };
  if (a.virou.situacao === "sem_sugestao")
    return { texto: "revisado, sem sugestão", tom: "neutro" };
  if (a.virou.decisao === "aprovada") return { texto: "virou sugestão aprovada", tom: "sucesso" };
  if (a.virou.decisao === "recusada") return { texto: "virou sugestão recusada", tom: "problema" };
  return { texto: "virou sugestão (aguardando o dono)", tom: "neutro" };
}

/**
 * Diálogo "Avisar a Tatiana" da conversa: erro ou acerto + uma frase. Grava com a conversa e entra
 * na revisão semanal da Tatiana. Mostra os últimos avisos da própria pessoa e o que viraram.
 */
export function AvisarTatiana({
  conversaId,
  aberto,
  aoMudar,
}: {
  conversaId: string;
  aberto: boolean;
  aoMudar: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const avisar = useServerFn(avisarTatianaFn);
  const meus = useServerFn(meusAvisosFn);
  const [tipo, setTipo] = useState<TipoAviso>("erro");
  const [frase, setFrase] = useState("");
  const [enviando, setEnviando] = useState(false);
  const { data: ultimos } = useQuery({
    queryKey: ["meus-avisos-tatiana"],
    queryFn: () => meus(),
    enabled: aberto,
  });

  async function enviar() {
    setEnviando(true);
    try {
      await avisar({ data: { conversaId, tipo, frase } });
      toast.success("Aviso enviado à Tatiana. Ele entra na revisão da semana.");
      setFrase("");
      aoMudar(false);
      await qc.invalidateQueries({ queryKey: ["meus-avisos-tatiana"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar o aviso.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Avisar a Tatiana</DialogTitle>
          <DialogDescription>
            Conte em uma frase o que a Alice ou a equipe fez de errado ou de certo nesta conversa. O
            aviso vai junto com a conversa para a revisão semanal. Nada é enviado ao cliente.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="Tipo do aviso" className="grid grid-cols-2 gap-2">
            {(
              [
                ["erro", "Erro"],
                ["acerto", "Acerto"],
              ] as const
            ).map(([id, rotulo]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={tipo === id}
                onClick={() => setTipo(id)}
                className={cn(
                  "min-h-11 rounded-botao border px-3 text-sm font-semibold",
                  tipo === id ? "border-marca bg-marca text-marca-foreground" : "bg-card",
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="frase-aviso">O que aconteceu</Label>
            <Textarea
              id="frase-aviso"
              value={frase}
              maxLength={MAX}
              rows={3}
              placeholder={
                tipo === "erro"
                  ? "Ex.: A Alice pediu o nome, a foto e o CEP na mesma mensagem."
                  : "Ex.: A Alice comentou a foto antes de pedir o CEP e o cliente respondeu na hora."
              }
              onChange={(e) => setFrase(e.target.value)}
            />
            <span className="self-end text-xs text-muted-foreground tabular-nums">
              {frase.length}/{MAX}
            </span>
          </div>
          <Botao
            onClick={() => void enviar()}
            disabled={enviando || frase.trim().length < 3}
            className="self-start"
          >
            {enviando ? "Enviando…" : "Enviar aviso"}
          </Botao>
          {ultimos?.length ? (
            <div className="flex flex-col gap-1.5 border-t border-border pt-3">
              <span className="text-sm font-semibold">Seus últimos avisos</span>
              <ul className="flex flex-col gap-2">
                {ultimos.map((a) => {
                  const v = rotuloVirou(a);
                  return (
                    <li key={a.id} className="flex min-w-0 flex-col gap-1 text-sm">
                      <span className="min-w-0 break-words">
                        <span className="font-semibold">
                          {a.tipo === "erro" ? "Erro" : "Acerto"}:
                        </span>{" "}
                        {a.frase}
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {dateBR(a.criadoEm)}
                        <Chip tom={v.tom}>{v.texto}</Chip>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
