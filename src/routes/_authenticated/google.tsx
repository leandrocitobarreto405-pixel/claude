import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CabecalhoDeTela, Card, Chip, NumeroGrande } from "@/components/nexa";
import { supabase } from "@/integrations/supabase/client";
import { brl, currentMonth, dateTimeBR, monthEnd, monthLabelPT, monthStart } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/google")({
  head: () => ({
    meta: [
      { title: "Google — Nexa OS" },
      {
        name: "description",
        content: "Leads do site, palavras-chave e conversões enviadas ao Google Ads no mês.",
      },
      { property: "og:title", content: "Google — Nexa OS" },
      {
        property: "og:description",
        content: "Leads do site, palavras-chave e conversões enviadas ao Google Ads no mês.",
      },
    ],
  }),
  component: Google,
});

const SITUACAO: Record<string, string> = {
  chamou: "Chamaram no WhatsApp",
  nao_chamou: "Não chamaram",
  chamado_equipe: "A equipe chamou",
  invalido: "Telefone inválido",
};

function useResumoGoogle(mes: string) {
  const de = monthStart(mes);
  const ate = monthEnd(mes);
  return useQuery({
    queryKey: ["google", mes],
    queryFn: async () => {
      const [leads, enviados, pendentes, exportacoes] = await Promise.all([
        supabase
          .from("leads_site")
          .select("situacao, utm_term, gclid, gbraid, lp")
          .gte("cadastrado_em", `${de}T00:00:00-03:00`)
          .lte("cadastrado_em", `${ate}T23:59:59-03:00`),
        supabase
          .from("ads_clicks")
          .select("id, enviado_google_em, crm_lead_id")
          .not("enviado_google_em", "is", null)
          .gte("enviado_google_em", `${de}T00:00:00-03:00`)
          .lte("enviado_google_em", `${ate}T23:59:59-03:00`),
        supabase.from("vw_conversoes_google_pendentes").select("ads_click_id, valor, conversao_em"),
        supabase
          .from("ads_eventos")
          .select("resultado, detalhe, created_at")
          .eq("tipo", "exportacao_google")
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      for (const r of [leads, enviados, pendentes, exportacoes]) if (r.error) throw r.error;

      const porSituacao = new Map<string, number>();
      const palavras = new Map<string, number>();
      const porLp = new Map<string, number>();
      let comClique = 0;
      for (const l of leads.data ?? []) {
        porSituacao.set(l.situacao, (porSituacao.get(l.situacao) ?? 0) + 1);
        const termo = (l.utm_term ?? "").trim().toLowerCase();
        if (termo) palavras.set(termo, (palavras.get(termo) ?? 0) + 1);
        porLp.set(l.lp, (porLp.get(l.lp) ?? 0) + 1);
        if (l.gclid || l.gbraid) comClique += 1;
      }
      const ordenar = (m: Map<string, number>) =>
        [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const pend = pendentes.data ?? [];
      const ultima = exportacoes.data?.[0] ?? null;
      return {
        leads: (leads.data ?? []).length,
        comClique,
        porSituacao: ordenar(porSituacao),
        palavras: ordenar(palavras).slice(0, 10),
        porLp: ordenar(porLp),
        enviadas: (enviados.data ?? []).length,
        pendentes: pend.length,
        valorPendente: pend.reduce((t, p) => t + Number(p.valor ?? 0), 0),
        ultimaExportacao: ultima
          ? {
              quando: ultima.created_at,
              resultado: ultima.resultado,
              novas: Number((ultima.detalhe as { novas?: number } | null)?.novas ?? 0),
            }
          : null,
      };
    },
  });
}

const RESULTADO: Record<string, string> = {
  enviado: "enviada",
  formatada: "planilha preparada",
  nada_novo: "nada novo para enviar",
  sem_planilha: "sem planilha configurada",
  erro: "com erro",
};

function Google() {
  const [mes, setMes] = useState(currentMonth());
  const { data: d, isLoading, error } = useResumoGoogle(mes);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Google"
        descricao="Leads que vieram do site, as palavras-chave que trouxeram e as conversões enviadas ao Google Ads."
        voltarPara="/inicio"
      />
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="mes">Mês</Label>
          <Input
            id="mes"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="w-[170px]"
          />
        </div>
      </div>
      {error ? (
        <Card className="text-sm text-problema-foreground">{(error as Error).message}</Card>
      ) : null}

      <Card aria-label="Leads do site">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">Leads do site em {monthLabelPT(mes)}</h2>
          <Link
            to="/crm/leads-site"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-bold text-success hover:text-marca"
          >
            Ver lista <ChevronRight className="size-4" aria-hidden />
          </Link>
        </div>
        <NumeroGrande
          valor={isLoading ? "…" : String(d?.leads ?? 0)}
          complemento={d ? `${d.comClique} com clique do Google (gclid/gbraid)` : undefined}
        />
        <ul className="flex flex-wrap gap-2">
          {(d?.porSituacao ?? []).map(([s, q]) => (
            <li key={s}>
              <Chip tom={s === "chamou" ? "sucesso" : s === "invalido" ? "problema" : "neutro"}>
                {SITUACAO[s] ?? s}: {q}
              </Chip>
            </li>
          ))}
        </ul>
        {d && d.porLp.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Por página: {d.porLp.map(([lp, q]) => `${lp} (${q})`).join(" · ")}
          </p>
        ) : null}
      </Card>

      <Card aria-label="Palavras-chave">
        <h2 className="text-sm font-bold">Palavras-chave (utm_term)</h2>
        {d && d.palavras.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma palavra-chave registrada nos leads do mês.
          </p>
        ) : (
          <ol className="flex flex-col divide-y divide-border">
            {(d?.palavras ?? []).map(([p, q]) => (
              <li key={p} className="flex min-h-11 items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{p}</span>
                <span className="font-bold tabular-nums">{q}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card aria-label="Conversões enviadas ao Google Ads">
        <h2 className="text-sm font-bold">Conversões enviadas ao Google Ads</h2>
        <div className="grid grid-cols-2 gap-3">
          <NumeroGrande
            tamanho="pequeno"
            valor={isLoading ? "…" : String(d?.enviadas ?? 0)}
            legenda="enviadas no mês"
          />
          <NumeroGrande
            tamanho="pequeno"
            valor={isLoading ? "…" : String(d?.pendentes ?? 0)}
            legenda={`a enviar · ${brl(d?.valorPendente ?? 0)}`}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {d?.ultimaExportacao
            ? `Última exportação ${dateTimeBR(d.ultimaExportacao.quando)}: ${RESULTADO[d.ultimaExportacao.resultado] ?? d.ultimaExportacao.resultado}${d.ultimaExportacao.novas ? ` (${d.ultimaExportacao.novas} nova(s))` : ""}.`
            : "Nenhuma exportação registrada ainda."}{" "}
          A exportação roda todo dia a partir das 5h; só vão vendas de OS ligadas a um lead com
          clique de até 90 dias antes.
        </p>
      </Card>
    </div>
  );
}
