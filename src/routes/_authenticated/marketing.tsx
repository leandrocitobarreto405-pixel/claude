import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState, PageHeader, SectionCard } from "@/components/app-shell";
import { CampanhaCard, CHAVE_MKT, RelatorioCampanha } from "@/components/marketing/campanha-card";
import { BaseContatos } from "@/components/marketing/base-contatos";
import { GatilhosHoje } from "@/components/marketing/gatilhos-hoje";
import { ConfigMarketing } from "@/components/marketing/config-marketing";
import { marcarAvisosLidosFn, situacaoMarketing } from "@/lib/marketing.functions";
import { dateTimeBR } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({
    meta: [
      { title: "Campanhas WhatsApp — Nexa OS" },
      {
        name: "description",
        content: "Calendário de campanhas, aprovação, gatilhos do dia e base de marketing.",
      },
    ],
  }),
  component: Marketing,
});

function Marketing() {
  const qc = useQueryClient();
  const situacaoFn = useServerFn(situacaoMarketing);
  const lidosFn = useServerFn(marcarAvisosLidosFn);
  const q = useQuery({ queryKey: CHAVE_MKT, queryFn: () => situacaoFn(), refetchInterval: 60_000 });
  const d = q.data;

  if (!d) {
    return (
      <>
        <PageHeader title="Campanhas WhatsApp" />
        <p className="text-sm text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "Carregando…"}
        </p>
      </>
    );
  }

  const calendario = d.campanhas.filter((c) => c.tipo === "calendario");
  const gatilhos = d.campanhas.filter((c) => c.tipo === "gatilho");
  const naoLidos = d.avisos.filter((a) => !a.lido_em);
  const paraAprovar = calendario.filter((c) => c.status === "aguardando_aprovacao").length;
  const ligados = [
    d.config?.gatilho_c1_ligado ? "C1" : null,
    d.config?.gatilho_c2_ligado ? "C2" : null,
    d.config?.gatilho_c3_ligado ? "C3" : null,
  ].filter((x): x is string => Boolean(x));

  return (
    <>
      <PageHeader
        title="Campanhas WhatsApp"
        description={`Você só aprova ou recusa: o Nexa prepara cada campanha 10 dias antes e envia nas datas, com as travas de segurança. Disparo ${
          d.config?.disparo_ligado ? "ligado" : "desligado (nada sai)"
        }.`}
      />

      {naoLidos.length > 0 && (
        <div className="mb-4">
          <SectionCard
            icon={Bell}
            title={`Avisos (${naoLidos.length})`}
            accent="warning"
            actions={
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  await lidosFn();
                  await qc.invalidateQueries({ queryKey: CHAVE_MKT });
                }}
              >
                Marcar como lidos
              </Button>
            }
          >
            <ul className="grid gap-2 text-sm">
              {naoLidos.slice(0, 8).map((a) => (
                <li key={a.id}>
                  <span className="font-medium">{a.titulo}:</span> {a.mensagem}{" "}
                  <span className="text-xs text-muted-foreground">{dateTimeBR(a.created_at)}</span>
                </li>
              ))}
            </ul>
          </SectionCard>
        </div>
      )}

      <Tabs defaultValue="campanhas">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="campanhas">
            Campanhas{paraAprovar ? ` (${paraAprovar} para aprovar)` : ""}
          </TabsTrigger>
          <TabsTrigger value="gatilhos">Gatilhos</TabsTrigger>
          <TabsTrigger value="base">Base</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>

        <TabsContent value="campanhas">
          {!calendario.length ? (
            <EmptyState
              icon={CalendarDays}
              title="Nenhuma campanha no calendário."
              description="O calendário dos próximos 12 meses é cadastrado pela Nexa."
            />
          ) : (
            <div className="grid gap-3">
              {calendario.map((c) => (
                <CampanhaCard
                  key={c.id}
                  campanha={c}
                  admin={d.admin}
                  lotes={d.lotes.filter((l) => l.campanha_id === c.id)}
                  relatorio={d.relatorio.find((r) => r.campanha_id === c.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="gatilhos">
          <div className="grid gap-4">
            <GatilhosHoje admin={d.admin} ligados={ligados} />
            {gatilhos.length > 0 && (
              <SectionCard title="Resultado dos gatilhos por mês">
                <div className="grid gap-4">
                  {gatilhos.map((g) => {
                    const r = d.relatorio.find((x) => x.campanha_id === g.id);
                    return r ? (
                      <div key={g.id}>
                        <p className="mb-1 font-medium">{g.nome}</p>
                        <RelatorioCampanha r={r} />
                      </div>
                    ) : null;
                  })}
                </div>
              </SectionCard>
            )}
          </div>
        </TabsContent>

        <TabsContent value="base">
          <BaseContatos dados={d} />
        </TabsContent>

        <TabsContent value="config">
          <ConfigMarketing key={d.config?.updated_at ?? "novo"} dados={d} />
        </TabsContent>
      </Tabs>
    </>
  );
}
