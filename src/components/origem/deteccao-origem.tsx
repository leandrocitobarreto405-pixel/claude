// Indicadores › "Detecção da origem": nas OS do período (a partir de 22/10/2026, quando a detecção
// começou), quantas vieram com a origem detectada, quantas a equipe manteve e quais foram trocadas
// (detectada → escolhida, por quem). Serve para ver quantas vezes a detecção errou.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/nexa";
import { useConfigOptions } from "@/lib/data";
import { dateBR } from "@/lib/format";
import { avisoDaDeteccao, resumoDeteccao, type LinhaDeteccao } from "@/lib/origem-venda";

const INICIO_DETECCAO = "2026-10-22";

export function DeteccaoDaOrigem({ de, ate }: { de: string; ate: string }) {
  const desde = de > INICIO_DETECCAO ? de : INICIO_DETECCAO;
  const { data: origens } = useConfigOptions("sales_origin", false);
  const { data, isLoading } = useQuery({
    queryKey: ["deteccao_origem", desde, ate],
    enabled: desde <= ate,
    queryFn: async () => {
      const { data: os, error } = await supabase
        .from("work_orders")
        .select(
          "id, os_number, created_at, sales_origin_id, origem_detectada_id, origem_detectada_como, origem_trocada_por",
        )
        .is("deleted_at", null)
        .eq("eh_teste", false)
        .gte("created_at", `${desde}T00:00:00-03:00`)
        .lte("created_at", `${ate}T23:59:59-03:00`)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const linhas: LinhaDeteccao[] = (os ?? []).map((w) => ({
        id: w.id,
        osNumber: w.os_number,
        criadaEm: w.created_at,
        escolhidaId: w.sales_origin_id,
        detectadaId: w.origem_detectada_id,
        como: w.origem_detectada_como,
        trocadaPor: w.origem_trocada_por,
      }));
      const ids = [...new Set(linhas.map((l) => l.trocadaPor).filter(Boolean))] as string[];
      const nomes = new Map<string, string>();
      if (ids.length) {
        const { data: perfis } = await supabase
          .from("users_profiles")
          .select("id, full_name")
          .in("id", ids);
        for (const p of perfis ?? []) if (p.full_name) nomes.set(p.id, p.full_name);
      }
      return { linhas, nomes };
    },
  });
  const nome = (id: string | null) => origens?.find((o) => o.id === id)?.name ?? "—";

  if (desde > ate) return null;
  const r = data ? resumoDeteccao(data.linhas) : null;
  return (
    <Card>
      <div>
        <h2 className="text-sm font-bold">Detecção da origem (OS)</h2>
        <p className="text-xs text-muted-foreground">
          Desde {dateBR(desde)}: a origem que o app detectou x a que ficou na OS.
        </p>
      </div>
      {isLoading || !r ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Numero rotulo="Detectadas" valor={String(r.detectadas)} />
            <Numero
              rotulo="Mantidas"
              valor={r.pctIguais === null ? "—" : `${r.iguais} (${r.pctIguais}%)`}
            />
            <Numero rotulo="Trocadas" valor={String(r.trocadas.length)} />
          </div>
          <p className="text-xs text-muted-foreground">
            Sem detecção (escolhida à mão): {r.semDeteccao}. Criadas pela Alice: {r.daAlice}.
          </p>
          {r.trocadas.length ? (
            <ul className="flex flex-col divide-y divide-border text-sm">
              {r.trocadas.map((t) => (
                <li key={t.id} className="py-2">
                  <p className="font-semibold">
                    OS {t.osNumber} · {dateBR(t.criadaEm.slice(0, 10))}
                  </p>
                  <p className="text-muted-foreground">
                    Detectada {nome(t.detectadaId)} ({avisoDaDeteccao(t.como) ?? "—"}) → escolhida{" "}
                    {nome(t.escolhidaId)}
                    {t.trocadaPor
                      ? ` por ${data?.nomes.get(t.trocadaPor) ?? "alguém da equipe"}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </Card>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-botao bg-muted px-2 py-2">
      <p className="text-base font-bold">{valor}</p>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
    </div>
  );
}
