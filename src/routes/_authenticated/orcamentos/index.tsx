import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FileText, PlusCircle, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/app-shell";
import { brl, dateBR, pct } from "@/lib/format";
import { STATUS_CLASS, STATUS_LABEL, resumoDoMes, useQuotes, type QuoteStatus } from "@/lib/quotes";

export const Route = createFileRoute("/_authenticated/orcamentos/")({
  head: () => ({
    meta: [
      { title: "Orçamentos — Nexa OS" },
      {
        name: "description",
        content:
          "Crie orçamentos de higienização e impermeabilização, acompanhe a conversão em OS.",
      },
      { property: "og:title", content: "Orçamentos — Nexa OS" },
      {
        property: "og:description",
        content:
          "Crie orçamentos de higienização e impermeabilização, acompanhe a conversão em OS.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Orcamentos,
});

function mesAtual() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }).slice(0, 7);
}

const STATUS: Array<QuoteStatus | "todos"> = [
  "todos",
  "rascunho",
  "enviado",
  "aprovado",
  "recusado",
  "convertido",
];

function Orcamentos() {
  const [mes, setMes] = useState(mesAtual());
  const [status, setStatus] = useState<QuoteStatus | "todos">("todos");
  const [busca, setBusca] = useState("");
  const { data, isLoading } = useQuotes(mes);

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (data ?? []).filter(
      (q) =>
        (status === "todos" || q.status === status) &&
        (!termo || q.cliente_nome.toLowerCase().includes(termo)),
    );
  }, [data, status, busca]);

  const resumo = resumoDoMes(data ?? []);

  return (
    <>
      <PageHeader
        title="Orçamentos"
        description="Monte o orçamento, envie pelo WhatsApp e transforme em OS quando o cliente aprovar."
      />

      <div className="mb-4">
        <Button asChild size="lg">
          <Link to="/orcamentos/$quoteId" params={{ quoteId: "novo" }}>
            <PlusCircle className="mr-2 h-4 w-4" /> Novo orçamento
          </Link>
        </Button>
      </div>

      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="card-surface p-4">
          <p className="text-xs text-muted-foreground">Orçamentos no mês</p>
          <p className="mt-1 text-2xl font-semibold">{resumo.quantidade}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-xs text-muted-foreground">Valor orçado</p>
          <p className="mt-1 text-2xl font-semibold">{brl(resumo.total)}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-xs text-muted-foreground">Viraram OS</p>
          <p className="mt-1 text-2xl font-semibold">{resumo.convertidos}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-xs text-muted-foreground">Valor convertido</p>
          <p className="mt-1 text-2xl font-semibold">{brl(resumo.valorConvertido)}</p>
        </div>
        <div className="card-surface p-4">
          <p className="text-xs text-muted-foreground">Taxa de conversão</p>
          <p className="mt-1 text-2xl font-semibold">{pct(resumo.conversao, 0)}</p>
        </div>
      </section>

      <section className="card-surface mb-4 flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="text-xs text-muted-foreground" htmlFor="mes">
            Mês
          </label>
          <Input
            id="mes"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground" htmlFor="status">
            Situação
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as QuoteStatus | "todos")}
            className="flex h-9 w-44 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
          >
            {STATUS.map((s) => (
              <option key={s} value={s}>
                {s === "todos" ? "Todas" : STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-48 flex-1">
          <label className="text-xs text-muted-foreground" htmlFor="busca">
            Cliente
          </label>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pelo nome"
              className="pl-8"
            />
          </div>
        </div>
      </section>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando orçamentos…</p>
      ) : !lista.length ? (
        <div className="card-surface p-8 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Nenhum orçamento neste filtro.</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {lista.map((q) => (
            <li key={q.id}>
              <Link
                to="/orcamentos/$quoteId"
                params={{ quoteId: q.id }}
                className="card-surface flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-primary/40"
              >
                <div>
                  <p className="font-medium">{q.cliente_nome}</p>
                  <p className="text-xs text-muted-foreground">
                    Criado em {dateBR(q.created_at.slice(0, 10))}
                    {q.data_servico ? ` · Serviço em ${dateBR(q.data_servico)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-semibold">{brl(q.total)}</span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_CLASS[q.status]}`}
                  >
                    {STATUS_LABEL[q.status]}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
