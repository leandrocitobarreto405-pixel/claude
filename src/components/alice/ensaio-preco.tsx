// Configurações › Alice: ensaio da regra nº 1 (nunca preço antes de valor) e do colchão dupla face.
// A Alice responde a conversa de teste mensagem a mensagem (a da 7975, com nome e CEP trocados).
// Nada vai para o WhatsApp; o resultado fica guardado.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, Card, Chip } from "@/components/nexa";
import { ensaiarPrecoFn } from "@/lib/alice-ensaio.functions";
import type { EnsaioPreco } from "@/lib/alice/ensaio-preco.server";

export function EnsaioPrecoAlice() {
  const ensaiar = useServerFn(ensaiarPrecoFn);
  const [rodando, setRodando] = useState(false);
  const [r, setR] = useState<EnsaioPreco | null>(null);

  async function rodar() {
    setRodando(true);
    try {
      setR(await ensaiar());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "O ensaio não rodou.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <Card className="gap-3">
      <div className="grid gap-1">
        <h2 className="text-base font-bold">Ensaio: preço só depois do valor</h2>
        <p className="text-sm text-muted-foreground">
          Conversa de teste igual à do colchão queen (tudo numa mensagem, CEP, cupom e a pergunta
          das faces), respondida pela Alice mensagem a mensagem. Nada vai para o WhatsApp. Leva
          cerca de 1 minuto.
        </p>
      </div>
      <Botao className="self-start" disabled={rodando} onClick={() => void rodar()}>
        {rodando ? "Rodando…" : "Rodar o ensaio"}
      </Botao>
      {r ? (
        <div className="grid gap-3">
          <Chip tom={r.conferencia.passou ? "sucesso" : "atencao"}>
            {r.conferencia.passou ? "Passou" : `Atenção: ${r.conferencia.motivo}`}
          </Chip>
          {r.passos.map((p, i) => (
            <div key={i} className="grid gap-2 rounded-card border border-border bg-background p-3">
              <p className="text-sm">
                <span className="font-bold">Cliente:</span> {p.cliente}
              </p>
              {p.alice.map((t, j) => (
                <p key={j} className="whitespace-pre-wrap rounded-card bg-secondary p-2 text-sm">
                  <span className="font-bold">Alice:</span> {t}
                </p>
              ))}
              {p.retidos.length ? (
                <p className="text-xs text-muted-foreground">
                  Barrado pela trava (não iria ao cliente): {p.retidos.join(" · ")}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {p.travado ? "Preço travado nesta resposta. " : ""}
                Ferramentas: {p.ferramentas.map((f) => f.nome).join(", ") || "nenhuma"}
              </p>
              {p.erro ? <p className="text-xs text-destructive">{p.erro}</p> : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
