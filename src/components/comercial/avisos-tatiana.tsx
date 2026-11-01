import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Card, Chip } from "@/components/nexa";
import { rotuloVirou } from "@/components/conversas/avisar-tatiana";
import { avisosTatianaFn, type AvisoTela } from "@/lib/avisos-tatiana.functions";
import { dateBR } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filtro = "todos" | "erro" | "acerto";

/** Aba "Avisos" da tela da Tatiana (só admin): o que a equipe avisou e o que cada aviso virou. */
export function AvisosTatiana({ dados }: { dados?: AvisoTela[] }) {
  const fn = useServerFn(avisosTatianaFn);
  const { data, isLoading } = useQuery({
    queryKey: ["avisos-tatiana"],
    queryFn: () => fn(),
    enabled: !dados,
  });
  const avisos = dados ?? data ?? [];
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const lista = avisos.filter((a) => filtro === "todos" || a.tipo === filtro);
  const erros = avisos.filter((a) => a.tipo === "erro").length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Avisos mandados pela equipe no botão "Avisar a Tatiana" da conversa, nos últimos 60 dias.
        Entram na revisão semanal como sinal forte; nada muda na Alice sem o seu OK.
      </p>
      <div role="radiogroup" aria-label="Filtrar avisos" className="flex flex-wrap gap-2">
        {(
          [
            ["todos", `Todos (${avisos.length})`],
            ["erro", `Erros (${erros})`],
            ["acerto", `Acertos (${avisos.length - erros})`],
          ] as const
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={filtro === id}
            onClick={() => setFiltro(id)}
            className={cn(
              "min-h-11 rounded-full border px-4 text-sm font-semibold",
              filtro === id ? "border-marca bg-marca text-marca-foreground" : "bg-card",
            )}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {isLoading && !dados ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length ? (
        <ul className="flex flex-col gap-2">
          {lista.map((a) => {
            const v = rotuloVirou(a);
            return (
              <li key={a.id}>
                <Card className="flex min-w-0 flex-col gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Chip tom={a.tipo === "erro" ? "problema" : "sucesso"}>
                      {a.tipo === "erro" ? "Erro" : "Acerto"}
                    </Chip>
                    <Chip tom={v.tom}>{v.texto}</Chip>
                  </span>
                  <p className="min-w-0 break-words">{a.frase}</p>
                  {a.virou.situacao === "sugestao" ? (
                    <p className="rounded-botao bg-background p-2 text-sm">
                      <span className="font-semibold">Sugestão: </span>
                      {a.virou.sugestao}
                    </p>
                  ) : null}
                  <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{dateBR(a.criadoEm)}</span>
                    <span>· {a.quem ?? "Sem nome"}</span>
                    {a.conversaId ? (
                      <Link
                        to="/conversas/$conversaId"
                        params={{ conversaId: a.conversaId }}
                        className="underline underline-offset-2"
                      >
                        · conversa{a.telefoneFinal ? ` do final ${a.telefoneFinal}` : ""}
                      </Link>
                    ) : null}
                  </span>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nenhum aviso neste filtro.</p>
      )}
    </div>
  );
}
