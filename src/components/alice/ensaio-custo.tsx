// Configurações › Alice: ensaio de custo (ideias de 26/10, uma por vez). A Alice responde 3
// conversas de teste mensagem a mensagem, no jeito de hoje e no novo; mostra o custo por conversa
// e a última resposta de cada uma. Nada vai para o WhatsApp; o resultado fica guardado.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, Card, Chip } from "@/components/nexa";
import { ensaiarCustoFn } from "@/lib/alice-ensaio.functions";
import type { EnsaioCusto, LadoEnsaio } from "@/lib/alice/ensaio-custo.server";

const usd = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 3 });

export function EnsaioCustoAlice() {
  const ensaiar = useServerFn(ensaiarCustoFn);
  const [rodando, setRodando] = useState(false);
  const [r, setR] = useState<EnsaioCusto | null>(null);

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

  const queda = r && r.mediaAntesUsd > 0 ? 1 - r.mediaDepoisUsd / r.mediaAntesUsd : null;
  return (
    <Card className="gap-3">
      <div className="grid gap-1">
        <h2 className="text-base font-bold">Ensaio de custo da Alice</h2>
        <p className="text-sm text-muted-foreground">
          3 conversas de teste, mensagem a mensagem, no jeito de hoje e no novo (ideia 2: cache do
          histórico). Nada vai para o WhatsApp. Custa cerca de US$ 2 e leva 2 a 3 minutos.
        </p>
      </div>
      <Botao className="self-start" disabled={rodando} onClick={() => void rodar()}>
        {rodando ? "Rodando…" : "Rodar o ensaio de custo"}
      </Botao>
      {r ? (
        <div className="grid gap-3">
          <p className="text-sm font-semibold">
            Por conversa: {usd(r.mediaAntesUsd)} hoje → {usd(r.mediaDepoisUsd)} no novo
            {queda !== null
              ? ` (${Math.round(queda * 100)}% ${queda >= 0 ? "menos" : "mais"})`
              : ""}
          </p>
          {r.cenarios.map((c) => (
            <div
              key={c.id}
              className="grid gap-2 rounded-card border border-border bg-background p-3"
            >
              <span className="text-sm font-bold">{c.titulo}</span>
              <p className="text-xs text-muted-foreground">
                Última do cliente: {c.ultimaDoCliente}
              </p>
              <Lado titulo="Hoje" l={c.antes} />
              <Lado titulo="Novo" l={c.depois} />
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function Lado({ titulo, l }: { titulo: string; l: LadoEnsaio }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{titulo}</span>
        <Chip>{usd(l.custoUsd)}</Chip>
        <span className="text-xs text-muted-foreground">
          {l.respostas} respostas · {l.rodadas} rodadas · cache gravado{" "}
          {l.uso.cacheEscrita.toLocaleString("pt-BR")} · lido{" "}
          {l.uso.cacheLeitura.toLocaleString("pt-BR")}
        </span>
      </div>
      {l.erro ? <p className="text-xs text-problema-foreground">Erro: {l.erro}</p> : null}
      {l.exemplo.map((t, i) => (
        <p
          key={i}
          className="ml-8 rounded-card border-2 border-marca bg-marca-claro px-3 py-2 text-sm whitespace-pre-wrap"
        >
          {t}
        </p>
      ))}
    </div>
  );
}
