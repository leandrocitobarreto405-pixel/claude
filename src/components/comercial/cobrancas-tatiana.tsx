// Tela da Tatiana › Cobranças (só admin): uma linha por cobrança, filtros, totais da semana por
// pessoa (com a semana anterior) e o resumo semanal (1ª resposta e preço). E › Noites e teste:
// custo por noite e no mês, e "padrão faria × Tatiana decidiu" da última noite.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, Chip } from "@/components/nexa";
import {
  COBRANCA,
  NOME_GERENTE,
  TIPOS_COBRANCA,
  tempoTexto,
  type TipoCobranca,
} from "@/lib/comercial/tatiana";
import { cobrancasTatianaFn, type PainelCobrancas } from "@/lib/tatiana.functions";
import { dateTimeBR } from "@/lib/format";
import { cn } from "@/lib/utils";

const usd = (v: number) => `US$ ${v.toFixed(2).replace(".", ",")}`;
const CHAVE = ["tatiana-cobrancas"];

function Seletor({
  rotulo,
  valor,
  onChange,
  opcoes,
}: {
  rotulo: string;
  valor: string;
  onChange: (v: string) => void;
  opcoes: Array<{ id: string; rotulo: string }>;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-semibold">
      {rotulo}
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="min-h-11 w-full min-w-0 rounded-botao border border-border bg-card px-2 text-sm font-normal"
      >
        {opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.rotulo}
          </option>
        ))}
      </select>
    </label>
  );
}

const SITUACAO: Record<string, { rotulo: string; tom: "atencao" | "sucesso" | "neutro" }> = {
  pendente: { rotulo: "Pendente", tom: "atencao" },
  resolvida: { rotulo: "Resolvida", tom: "sucesso" },
  ja_certo: { rotulo: "Já estava certo", tom: "neutro" },
};

export function CobrancasTatiana({ dados }: { dados?: PainelCobrancas }) {
  const fn = useServerFn(cobrancasTatianaFn);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => fn(), enabled: !dados });
  const d = dados ?? q.data;
  const [pessoa, setPessoa] = useState("todas");
  const [tipo, setTipo] = useState("todos");
  const [situacao, setSituacao] = useState("todas");
  const [periodo, setPeriodo] = useState("7");
  const linhas = useMemo(() => {
    if (!d) return [];
    const corte = Date.now() - Number(periodo) * 86_400_000;
    return d.linhas.filter(
      (l) =>
        (pessoa === "todas" || (pessoa === "sem" ? !l.pessoaId : l.pessoaId === pessoa)) &&
        (tipo === "todos" || l.tipo === tipo) &&
        (situacao === "todas" || l.situacao === situacao) &&
        Date.parse(l.criadaEm) >= corte,
    );
  }, [d, pessoa, tipo, situacao, periodo]);
  if (q.isLoading) return <Card className="text-sm">Carregando…</Card>;
  if (!d) return <Card className="text-sm">Não foi possível carregar.</Card>;
  const pessoas = [
    ...new Map(
      d.linhas.filter((l) => l.pessoaId).map((l) => [l.pessoaId!, l.pessoa ?? "Sem nome"]),
    ).entries(),
  ];
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="min-w-0">
        <h2 className="font-bold">Semana por pessoa</h2>
        <p className="text-xs text-muted-foreground">
          Últimos 7 dias, com a semana anterior entre parênteses. Tempos médios das conversas
          assumidas na semana.
        </p>
        {d.semana.length ? (
          <ul className="flex flex-col divide-y divide-border">
            {d.semana.map((s) => (
              <li key={s.pessoa} className="flex min-w-0 flex-col gap-1 py-2 text-sm">
                <div className="flex min-w-0 items-baseline justify-between gap-2">
                  <span className="min-w-0 font-semibold">{s.pessoa}</span>
                  <span className="shrink-0 tabular-nums">
                    {s.semana} <span className="text-muted-foreground">({s.anterior})</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Chip tom="sucesso">
                    {s.resolvidas} {s.resolvidas === 1 ? "resolvida" : "resolvidas"}
                  </Chip>
                  <Chip tom={s.pendentes ? "atencao" : "neutro"}>
                    {s.pendentes} {s.pendentes === 1 ? "pendente" : "pendentes"}
                  </Chip>
                  {s.horasMedias !== null ? (
                    <Chip tom="neutro">resolve em ~{Math.round(s.horasMedias)} h</Chip>
                  ) : null}
                  {s.primeiraRespostaMin !== null ? (
                    <Chip tom="neutro">1ª resposta {tempoTexto(s.primeiraRespostaMin)}</Chip>
                  ) : null}
                  {s.precoMin !== null ? (
                    <Chip tom="neutro">preço em {tempoTexto(s.precoMin)}</Chip>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma cobrança nos últimos 14 dias.</p>
        )}
      </Card>

      <div className="grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4">
        <Seletor
          rotulo="Pessoa"
          valor={pessoa}
          onChange={setPessoa}
          opcoes={[
            { id: "todas", rotulo: "Todas" },
            ...pessoas.map(([id, nome]) => ({ id, rotulo: nome })),
            { id: "sem", rotulo: "Sem dono" },
          ]}
        />
        <Seletor
          rotulo="Tipo"
          valor={tipo}
          onChange={setTipo}
          opcoes={[
            { id: "todos", rotulo: "Todos" },
            ...TIPOS_COBRANCA.map((t) => ({ id: t, rotulo: COBRANCA[t].rotulo })),
          ]}
        />
        <Seletor
          rotulo="Situação"
          valor={situacao}
          onChange={setSituacao}
          opcoes={[
            { id: "todas", rotulo: "Todas" },
            { id: "pendente", rotulo: "Pendentes" },
            { id: "resolvida", rotulo: "Resolvidas" },
            { id: "ja_certo", rotulo: "Já estava certo" },
          ]}
        />
        <Seletor
          rotulo="Período"
          valor={periodo}
          onChange={setPeriodo}
          opcoes={[
            { id: "1", rotulo: "Hoje" },
            { id: "7", rotulo: "7 dias" },
            { id: "30", rotulo: "30 dias" },
            { id: "60", rotulo: "60 dias" },
          ]}
        />
      </div>

      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="font-titulo text-lg font-bold">
          Cobranças <span className="text-muted-foreground">({linhas.length})</span>
        </h2>
        {linhas.length ? (
          <ul className="flex min-w-0 flex-col gap-2">
            {linhas.map((l) => (
              <li key={l.id}>
                <Card className="min-w-0 gap-1.5 text-sm">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip tom={SITUACAO[l.situacao]!.tom}>
                      {SITUACAO[l.situacao]!.rotulo}
                      {l.situacao === "resolvida" && l.horasParaResolver !== null
                        ? ` em ${l.horasParaResolver} h`
                        : ""}
                    </Chip>
                    <Chip tom="neutro">{COBRANCA[l.tipo as TipoCobranca].rotulo}</Chip>
                    {l.anuncio ? <Chip tom="problema">Anúncio</Chip> : null}
                  </div>
                  <p>{l.texto}</p>
                  <p className="text-xs text-muted-foreground">
                    {dateTimeBR(l.criadaEm)} · {l.pessoa ?? "Sem dono"} ·{" "}
                    <Link
                      to="/crm/lead/$leadId"
                      params={{ leadId: l.leadId }}
                      className="underline"
                    >
                      lead final {l.telefoneFinal ?? "—"}
                    </Link>
                  </p>
                  {l.motivo ? (
                    <p className="text-xs text-muted-foreground">Motivo: {l.motivo}</p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>
        ) : (
          <Card className="text-sm text-muted-foreground">Nenhuma cobrança com esses filtros.</Card>
        )}
      </section>
    </div>
  );
}

export function NoitesTatiana({ dados }: { dados?: PainelCobrancas }) {
  const fn = useServerFn(cobrancasTatianaFn);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => fn(), enabled: !dados });
  const d = dados ?? q.data;
  if (q.isLoading) return <Card className="text-sm">Carregando…</Card>;
  if (!d) return <Card className="text-sm">Não foi possível carregar.</Card>;
  const pct = d.tetoMensalUsd ? Math.min(100, (d.gastoMesUsd / d.tetoMensalUsd) * 100) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="min-w-0 gap-2">
        <h2 className="font-bold">Custo da {NOME_GERENTE} no mês</h2>
        <p className="text-sm">
          {usd(d.gastoMesUsd)} de {usd(d.tetoMensalUsd)} (teto mensal)
        </p>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              pct >= 80 ? "bg-problema-foreground/70" : "bg-marca",
            )}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        </div>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {d.noites.map((n) => (
            <li
              key={`${n.noite}-${n.modo}`}
              className="flex min-w-0 items-baseline justify-between gap-2 py-1.5"
            >
              <span className="min-w-0">
                {n.noite.split("-").reverse().join("/")} ·{" "}
                {n.modo === "conferencia" ? "conferência" : n.modo} · {n.leads} leads
                {n.status !== "concluida" ? ` · ${n.status}` : ""}
              </span>
              <span className="shrink-0 tabular-nums">{usd(n.custoUsd)}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="min-w-0 gap-2">
        <h2 className="font-bold">Padrão faria × {NOME_GERENTE} decidiu (última noite)</h2>
        {d.comparacao.length ? (
          <ul className="flex flex-col divide-y divide-border text-sm">
            {d.comparacao.map((c) => (
              <li key={c.leadId} className="flex min-w-0 flex-col gap-0.5 py-2">
                <Link
                  to="/crm/lead/$leadId"
                  params={{ leadId: c.leadId }}
                  className="font-semibold underline-offset-2 hover:underline"
                >
                  Lead final {c.telefoneFinal ?? "—"}
                </Link>
                <span className="text-muted-foreground">Padrão: {c.padrao ?? "nada marcado"}</span>
                <span>
                  {NOME_GERENTE}: {c.decidiu}
                  {c.responsavel ? ` · ${c.responsavel === "alice" ? "Alice" : "equipe"}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Ainda não houve noite.</p>
        )}
      </Card>
    </div>
  );
}
