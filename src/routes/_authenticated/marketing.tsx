import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bell, ChevronRight, Gift } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import {
  BlocoEscuro,
  CabecalhoDeTela,
  Card,
  CardEscuro,
  Chip,
  NumeroGrande,
  Recolhido,
} from "@/components/nexa";
import {
  CampanhaCard,
  CHAVE_MKT,
  RelatorioCampanha,
  type Campanha,
} from "@/components/marketing/campanha-card";
import { BaseContatos } from "@/components/marketing/base-contatos";
import { GatilhosHoje } from "@/components/marketing/gatilhos-hoje";
import { ConfigMarketing } from "@/components/marketing/config-marketing";
import { resumoIndicacoesFn, situacaoMarketing } from "@/lib/marketing.functions";
import { diaMesCurto, proximasCampanhas, resultadosDoMes } from "@/lib/marketing-tela";
import { haQuanto } from "@/lib/conversas";
import { currentMonth, monthLabelPT, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({
    meta: [
      { title: "Marketing — Nexa OS" },
      {
        name: "description",
        content: "Resultados do mês, campanhas para aprovar, calendário e indicações.",
      },
    ],
  }),
  component: Marketing,
});

const GATILHOS = [
  { campo: "gatilho_c1_ligado", nome: "Pós-venda", detalhe: "Avaliação e indicação, 1 dia após" },
  { campo: "gatilho_c2_ligado", nome: "Retorno 6 meses", detalhe: "Higienização há 6 meses" },
  {
    campo: "gatilho_c3_ligado",
    nome: "Renovação 13 meses",
    detalhe: "Impermeabilização há 13 meses",
  },
] as const;

/** "R$ 3.640" */
function reais(valor: number) {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function Marketing() {
  const situacaoFn = useServerFn(situacaoMarketing);
  const indicacoesFn = useServerFn(resumoIndicacoesFn);
  const q = useQuery({ queryKey: CHAVE_MKT, queryFn: () => situacaoFn(), refetchInterval: 60_000 });
  const ind = useQuery({ queryKey: ["marketing", "indicacoes"], queryFn: () => indicacoesFn() });
  const [aberta, setAberta] = useState<Campanha | null>(null);
  const d = q.data;
  const mes = currentMonth();
  const nomeDoMes = monthLabelPT(mes).split(" de ")[0] ?? "";

  if (!d) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <CabecalhoDeTela titulo="Marketing" />
        <p className="text-sm text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "Carregando…"}
        </p>
      </div>
    );
  }

  const calendario = d.campanhas.filter((c) => c.tipo === "calendario");
  const gatilhos = d.campanhas.filter((c) => c.tipo === "gatilho");
  const paraAprovar = calendario.filter((c) => c.status === "aguardando_aprovacao");
  const proximas = proximasCampanhas(d.campanhas, todayISO());
  const r = resultadosDoMes(d.relatorio, mes);
  const naoLidos = d.avisos.filter((a) => !a.lido_em).length;
  const cfg = d.config as Record<string, unknown> | null;
  const ligados = GATILHOS.filter((g) => cfg?.[g.campo]).map((g) =>
    g.campo.slice(8, 10).toUpperCase(),
  );
  const lotesDe = (c: Campanha) => d.lotes.filter((l) => l.campanha_id === c.id);
  const relatorioDe = (c: Campanha) => d.relatorio.find((x) => x.campanha_id === c.id);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <CabecalhoDeTela
        sobretitulo={`Campanhas automáticas · ${nomeDoMes}`}
        titulo="Marketing"
        acao={
          <Chip tom={d.config?.disparo_ligado ? "sucesso" : "neutro"}>
            {d.config?.disparo_ligado ? "Envio ligado" : "Envio desligado"}
          </Chip>
        }
      />

      {/* Resultado do mês. */}
      <CardEscuro aria-label={`Resultado de ${nomeDoMes}`}>
        <div className="grid grid-cols-2 gap-2">
          <BlocoEscuro>
            <NumeroGrande
              tamanho="pequeno"
              valor={r.enviados}
              legenda="mensagens enviadas"
              sobreEscuro
            />
          </BlocoEscuro>
          <BlocoEscuro>
            <NumeroGrande
              tamanho="pequeno"
              valor={r.respostas}
              legenda="clientes responderam"
              sobreEscuro
            />
          </BlocoEscuro>
          <BlocoEscuro>
            <NumeroGrande
              tamanho="pequeno"
              valor={r.vendas}
              legenda="serviços fechados"
              sobreEscuro
            />
          </BlocoEscuro>
          <BlocoEscuro>
            <NumeroGrande
              tamanho="pequeno"
              valor={reais(r.valor)}
              legenda="voltaram em serviços"
              sobreEscuro
            />
          </BlocoEscuro>
        </div>
      </CardEscuro>

      {naoLidos > 0 ? (
        <Link
          to="/avisos"
          className="flex min-h-12 items-center gap-3 rounded-card border border-border bg-card px-4 py-3 text-sm hover:border-marca/40"
        >
          <Bell className="size-5 text-atencao-foreground" aria-hidden />
          <span className="flex-1 font-semibold">
            {naoLidos === 1 ? "1 aviso das campanhas" : `${naoLidos} avisos das campanhas`}
          </span>
          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
        </Link>
      ) : null}

      {/* Esperando aprovação: o cartão completo, com prévia, aprovar e recusar. */}
      {paraAprovar.length > 0 ? (
        <section className="flex flex-col gap-2.5" aria-labelledby="mkt-aprovar">
          <h2 id="mkt-aprovar" className="font-titulo text-xl">
            Esperando sua aprovação
          </h2>
          {paraAprovar.map((c) => (
            <CampanhaCard
              key={c.id}
              campanha={c}
              admin={d.admin}
              lotes={lotesDe(c)}
              relatorio={relatorioDe(c)}
            />
          ))}
          {!d.admin ? (
            <p className="text-sm text-muted-foreground">
              Só o administrador aprova ou recusa campanhas.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Calendário: gatilhos de todo dia e as próximas campanhas. */}
      <section className="flex flex-col gap-2.5" aria-labelledby="mkt-calendario">
        <h2 id="mkt-calendario" className="font-titulo text-xl">
          Calendário
        </h2>
        <Card espaco="nenhum">
          <ul className="flex flex-col divide-y divide-border">
            {GATILHOS.map((g) => {
              const ligado = Boolean(cfg?.[g.campo]);
              return (
                <li key={g.campo} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                  <span className="w-14 shrink-0 rounded-chip bg-muted py-1 text-center text-xs font-bold text-muted-foreground">
                    todo dia
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-bold">{g.nome}</span>
                    <span className="truncate text-[13px] text-muted-foreground">{g.detalhe}</span>
                  </span>
                  <Chip tom={ligado ? "sucesso" : "neutro"}>{ligado ? "Ativo" : "Desligado"}</Chip>
                </li>
              );
            })}
            {proximas.map((p) => {
              const c = calendario.find((x) => x.id === p.id)!;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setAberta(c)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50"
                  >
                    <span className="w-14 shrink-0 rounded-chip bg-marca-claro py-1 text-center text-xs font-bold text-marca">
                      {diaMesCurto(p.data)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-bold">{p.nome}</span>
                      <span className="truncate text-[13px] text-muted-foreground">
                        {p.contatos !== null ? `${p.contatos} clientes` : "Contatos na preparação"}
                      </span>
                    </span>
                    <Chip tom={p.chip.tom}>{p.chip.rotulo}</Chip>
                  </button>
                </li>
              );
            })}
          </ul>
          {proximas.length === 0 ? (
            <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
              Nenhuma campanha nos próximos 60 dias.
            </p>
          ) : null}
        </Card>
      </section>

      {/* Indique e ganhe. */}
      <Card aria-label="Indique e ganhe">
        <div className="flex items-center gap-2">
          <Gift className="size-5 text-marca" aria-hidden />
          <span className="text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Indique e ganhe
          </span>
        </div>
        <NumeroGrande
          disposicao="ao-lado"
          valor={ind.data?.noMes ?? "–"}
          legenda={
            ind.data
              ? `${ind.data.noMes === 1 ? "indicação" : "indicações"} em ${nomeDoMes} · ${ind.data.viraramServicoNoMes} ${
                  ind.data.viraramServicoNoMes === 1 ? "virou serviço" : "viraram serviço"
                }`
              : "indicações no mês"
          }
        />
        {ind.data ? (
          <p className="text-sm text-muted-foreground">
            {ind.data.descontoIndicadoPct}% de desconto para quem foi indicado e{" "}
            {ind.data.creditoIndicadorPct}% no próximo serviço de quem indicou. A Alice registra as
            indicações nas conversas.
          </p>
        ) : null}
        {ind.data && ind.data.recentes.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border rounded-botao border border-border">
            {ind.data.recentes.slice(0, 5).map((i) => (
              <li key={i.id} className="flex min-h-12 items-center gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{i.indicado}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    indicado por {i.indicador} · {haQuanto(i.criadaEm)}
                  </span>
                </span>
                <Chip tom={i.virouServico ? "sucesso" : "neutro"}>
                  {i.virouServico ? "Virou serviço" : "Aguardando"}
                </Chip>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {/* O resto do que já existia, recolhido. */}
      <Recolhido titulo="Gatilhos de hoje">
        <div className={cn("flex flex-col gap-4 p-4")}>
          <GatilhosHoje admin={d.admin} ligados={ligados} />
          {gatilhos.map((g) => {
            const rel = relatorioDe(g);
            return rel ? (
              <div key={g.id}>
                <p className="mb-1 font-semibold">{g.nome}</p>
                <RelatorioCampanha r={rel} />
              </div>
            ) : null;
          })}
        </div>
      </Recolhido>

      <Recolhido titulo="Todas as campanhas">
        <div className="flex flex-col gap-3 p-4">
          {calendario.length ? (
            calendario.map((c) => (
              <CampanhaCard
                key={c.id}
                campanha={c}
                admin={d.admin}
                lotes={lotesDe(c)}
                relatorio={relatorioDe(c)}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma campanha no calendário. O calendário dos próximos 12 meses é cadastrado pela
              Nexa.
            </p>
          )}
        </div>
      </Recolhido>

      <Recolhido titulo="Base de contatos">
        <div className="p-4">
          <BaseContatos dados={d} />
        </div>
      </Recolhido>

      <Recolhido titulo="Configuração">
        <div className="p-4">
          <ConfigMarketing key={d.config?.updated_at ?? "novo"} dados={d} />
        </div>
      </Recolhido>

      <Sheet open={!!aberta} onOpenChange={(v) => !v && setAberta(null)}>
        <SheetContent
          side="bottom"
          className="max-h-[90vh] overflow-y-auto rounded-t-card-lg p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          <SheetTitle className="pr-12 font-titulo text-xl">{aberta?.nome}</SheetTitle>
          <div className="mx-auto w-full max-w-3xl pt-3">
            {aberta ? (
              <CampanhaCard
                campanha={aberta}
                admin={d.admin}
                lotes={lotesDe(aberta)}
                relatorio={relatorioDe(aberta)}
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
