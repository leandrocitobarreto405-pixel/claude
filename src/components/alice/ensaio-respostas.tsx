// Configurações › Alice, leads e marketing (e Painel Nexa › Alice): ensaio das regras de 26/10
// (não perguntar duas vezes; tecido não identificado). Duas conversas reproduzidas, antes e depois,
// com as regras novas só em memória: nada é enviado nem gravado.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, Card, Chip } from "@/components/nexa";
import { ensaiarRespostasFn } from "@/lib/alice-ensaio.functions";
import type { ResultadoRespostas, Versao } from "@/lib/alice/ensaio-respostas.server";

export function EnsaioRespostas() {
  const ensaiar = useServerFn(ensaiarRespostasFn);
  const [rodando, setRodando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoRespostas[] | null>(null);

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
        <h2 className="text-base font-bold">Ensaio: respostas do cliente e tecido</h2>
        <p className="text-sm text-muted-foreground">
          A Alice responde 2 conversas reproduzidas (finais 3615 e 7010, sem nome nem endereço
          reais) como hoje e com as regras novas (empresa aberta agora, tecido padrão B). Nada vai
          para o WhatsApp e nada é gravado. Leva cerca de 1 minuto.
        </p>
      </div>
      <Botao className="self-start" disabled={rodando} onClick={() => void rodar()}>
        {rodando ? "Rodando…" : "Rodar o ensaio"}
      </Botao>
      {resultado ? (
        <div className="grid gap-3">
          <p className="text-sm font-semibold">
            Regras novas: {resultado.filter((r) => r.depois.passou).length} de {resultado.length}{" "}
            como esperado
          </p>
          {resultado.map((r) => (
            <div
              key={r.id}
              className="grid gap-2 rounded-card border border-border bg-background p-3"
            >
              <span className="text-sm font-bold">{r.titulo}</span>
              <p className="text-xs text-muted-foreground">Esperado: {r.esperado}</p>
              <details>
                <summary className="min-h-11 cursor-pointer py-2 text-sm">
                  Conversa até aqui ({r.conversa.length} mensagens)
                </summary>
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
                </div>
              </details>
              <BlocoVersao titulo="Antes (como é hoje)" v={r.antes} mostrarSituacao={false} />
              <BlocoVersao titulo="Depois (regras novas)" v={r.depois} mostrarSituacao />
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function BlocoVersao({
  titulo,
  v,
  mostrarSituacao,
}: {
  titulo: string;
  v: Versao;
  mostrarSituacao: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{titulo}</span>
        {mostrarSituacao ? (
          <Chip tom={v.passou ? "sucesso" : "problema"}>{v.passou ? "ok" : "ver"}</Chip>
        ) : null}
      </div>
      {v.erro || (mostrarSituacao && !v.passou) ? (
        <p className="text-xs text-problema-foreground">{v.erro ? `Erro: ${v.erro}` : v.motivo}</p>
      ) : null}
      {v.resposta.map((t, i) => (
        <p
          key={i}
          className="ml-8 rounded-card border-2 border-marca bg-marca-claro px-3 py-2 text-sm whitespace-pre-wrap"
        >
          {t}
        </p>
      ))}
      {v.ferramentas.length ? (
        <p className="text-xs break-all text-muted-foreground">
          Ferramentas: {v.ferramentas.map((f) => `${f.nome} ${f.entrada}`).join(" · ")}
        </p>
      ) : null}
    </div>
  );
}
