// Painel Nexa › Alice: ensaio da regra do nome do cliente. Roda a Alice de verdade em 5 conversas
// inventadas (empresa ativa), com a regra nova só em memória: nada é enviado nem gravado.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, Card, Chip } from "@/components/nexa";
import { ensaiarNomeFn } from "@/lib/alice-ensaio.functions";
import type { ResultadoCenario } from "@/lib/alice/ensaio-nome.server";

export function EnsaioNome() {
  const ensaiar = useServerFn(ensaiarNomeFn);
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCenario[] | null>(null);

  async function rodar() {
    setRodando(true);
    try {
      setResultado(await ensaiar());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "O ensaio não rodou.");
    } finally {
      setRodando(false);
    }
  }

  return (
    <Card className="gap-3">
      <div className="grid gap-1">
        <h2 className="text-base font-bold">Ensaio: nome do cliente</h2>
        <p className="text-sm text-muted-foreground">
          A Alice responde 5 conversas inventadas com a regra nova do nome (empresa aberta agora).
          Nada vai para o WhatsApp e nada é gravado. Leva cerca de 1 minuto.
        </p>
      </div>
      <Botao className="self-start" disabled={rodando} onClick={() => void rodar()}>
        {rodando ? "Rodando…" : "Rodar o ensaio"}
      </Botao>
      {resultado ? (
        <div className="grid gap-3">
          <p className="text-sm font-semibold">
            {resultado.filter((r) => r.passou).length} de {resultado.length} como esperado
          </p>
          {resultado.map((r) => (
            <div
              key={r.id}
              className="grid gap-2 rounded-card border border-border bg-background p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Chip tom={r.passou ? "sucesso" : "problema"}>{r.passou ? "ok" : "ver"}</Chip>
                <span className="text-sm font-bold">{r.titulo}</span>
              </div>
              <p className="text-xs text-muted-foreground">Esperado: {r.esperado}</p>
              {!r.passou ? (
                <p className="text-xs text-problema-foreground">
                  {r.erro ? `Erro: ${r.erro}` : r.motivo}
                </p>
              ) : null}
              <div className="grid gap-1.5">
                {r.conversa.map((m, i) => (
                  <p
                    key={i}
                    className={
                      m.de === "cliente"
                        ? "mr-8 rounded-card border border-border bg-card px-3 py-2 text-sm whitespace-pre-wrap"
                        : "ml-8 rounded-card bg-marca-claro px-3 py-2 text-sm whitespace-pre-wrap"
                    }
                  >
                    {m.texto}
                  </p>
                ))}
                {r.resposta.map((t, i) => (
                  <p
                    key={`r${i}`}
                    className="ml-8 rounded-card border-2 border-marca bg-marca-claro px-3 py-2 text-sm whitespace-pre-wrap"
                  >
                    {t}
                  </p>
                ))}
              </div>
              {r.ferramentas.length ? (
                <p className="text-xs break-all text-muted-foreground">
                  Ferramentas: {r.ferramentas.map((f) => `${f.nome} ${f.entrada}`).join(" · ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
