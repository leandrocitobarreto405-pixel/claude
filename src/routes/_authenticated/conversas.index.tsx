import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle, Search, X } from "lucide-react";
import { BadgeAlerta, Botao, CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { CartaoAlice } from "@/components/conversas/cartao-alice";
import { CartaoConversa } from "@/components/conversas/cartao-conversa";
import { EncerrarParadas } from "@/components/conversas/encerrar-paradas";
import { useEncerrarConversas } from "@/lib/conversas-encerrar";
import { useContextoTenant, usePapel } from "@/lib/tenant";
import { useTrocarEmpresa } from "@/lib/documentos-hooks";
import { resumoAliceHoje } from "@/lib/alice.functions";
import type { GrupoConversa } from "@/lib/conversas";
import { listarConversas, type ConversaResumo } from "@/lib/conversas.functions";
import { useTempoRealConversas } from "@/lib/conversas-tempo-real";
import { cn } from "@/lib/utils";

export const CHAVE_CONVERSAS = ["conversas", "lista"] as const;

/** Abas: os grupos da conversa mais "Minhas" (as que eu assumi, em qualquer grupo aberto). */
type Aba = GrupoConversa | "minhas";

const ABAS: { id: Aba; rotulo: string; vazio: string }[] = [
  {
    id: "precisam",
    rotulo: "Precisam",
    vazio: "Nenhum cliente esperando a equipe. A Alice está dando conta.",
  },
  {
    id: "minhas",
    rotulo: "Minhas",
    vazio: "Nenhuma conversa assumida por você. Toque em Assumir dentro de uma conversa.",
  },
  { id: "alice", rotulo: "Alice", vazio: "Nenhuma conversa com a Alice agora." },
  { id: "equipe", rotulo: "Equipe", vazio: "Nenhuma conversa com a equipe nos últimos 7 dias." },
  {
    id: "finalizadas",
    rotulo: "Encerradas",
    vazio: "Nenhuma conversa encerrada nos últimos 7 dias.",
  },
];

export const Route = createFileRoute("/_authenticated/conversas/")({
  validateSearch: (search: Record<string, unknown>) => {
    const aba = String(search["aba"] ?? "");
    return {
      aba: ABAS.some((a) => a.id === aba) ? (aba as Aba) : undefined,
    };
  },
  head: () => ({ meta: [{ title: "Conversas — Nexa OS" }] }),
  component: Conversas,
});

function Conversas() {
  const search = Route.useSearch();
  const listarFn = useServerFn(listarConversas);
  const resumoFn = useServerFn(resumoAliceHoje);
  const q = useQuery({
    queryKey: CHAVE_CONVERSAS,
    queryFn: () => listarFn(),
    // Tempo real pelo Realtime; o refetch é só garantia (e para quem tem várias empresas).
    refetchInterval: 60_000,
  });
  useTempoRealConversas();
  const alice = useQuery({
    queryKey: ["alice_resumo_hoje"],
    queryFn: () => resumoFn(),
    refetchInterval: 60_000,
  });
  const [busca, setBusca] = useState("");
  const porGrupo = useMemo(() => {
    const m = new Map<Aba, ConversaResumo[]>();
    // Em toda aba, a conversa com mensagem mais recente primeiro.
    const ordenadas = [...(q.data ?? [])].sort((a, b) =>
      (b.ultimaEm ?? "").localeCompare(a.ultimaEm ?? ""),
    );
    for (const c of ordenadas) {
      m.set(c.grupo, [...(m.get(c.grupo) ?? []), c]);
      if (c.minha) m.set("minhas", [...(m.get("minhas") ?? []), c]);
    }
    return m;
  }, [q.data]);
  // Busca por nome ou telefone (só dígitos), em todas as abas de uma vez.
  const encontradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return null;
    const digitos = termo.replace(/\D/g, "");
    return [...(q.data ?? [])]
      .filter(
        (c) =>
          c.nome.toLowerCase().includes(termo) ||
          (digitos.length >= 3 && (c.telefone ?? "").replace(/\D/g, "").includes(digitos)),
      )
      .sort((a, b) => (b.ultimaEm ?? "").localeCompare(a.ultimaEm ?? ""));
  }, [q.data, busca]);

  const precisam = porGrupo.get("precisam")?.length ?? 0;
  const [aba, setAba] = useState<Aba>(
    search.aba ?? (precisam > 0 || !q.data ? "precisam" : "alice"),
  );
  const atual = ABAS.find((a) => a.id === aba)!;
  // Encerradas: por tempo (rotina) ou pela equipe (botão).
  const [filtroEncerradas, setFiltroEncerradas] = useState<"todas" | "tempo" | "equipe">("todas");
  const itensDaAba = encontradas ?? porGrupo.get(aba) ?? [];
  const itens =
    aba === "finalizadas" && filtroEncerradas !== "todas"
      ? itensDaAba.filter((c) => c.encerradaPorTempo === (filtroEncerradas === "tempo"))
      : itensDaAba;
  const agora = new Date();
  const { papel } = usePapel();
  const { data: tenant } = useContextoTenant();
  const trocarEmpresa = useTrocarEmpresa();
  const empresaAberta = tenant?.ativa?.empresa ?? null;
  const outrasEmpresas = (tenant?.empresas ?? []).filter((v) => v.empresa.id !== empresaAberta?.id);
  const a = alice.data;
  const podeEncerrar = papel === "admin" || papel === "atendente";
  // Modo de seleção (só em "Precisam"): marcar várias e encerrar só as marcadas.
  const [selecionando, setSelecionando] = useState(false);
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set());
  const { encerrar, encerrando } = useEncerrarConversas();
  const emSelecao = selecionando && aba === "precisam";
  const marcadasVisiveis = itens.filter((c) => marcadas.has(c.id)).map((c) => c.id);
  function sairDaSelecao() {
    setSelecionando(false);
    setMarcadas(new Set());
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Conversas"
        sobretitulo={empresaAberta ? empresaAberta.nome : undefined}
        descricao="Responda por aqui; o Chatwoot fica como plano B."
      />

      {/* A Alice: veio do Início. */}
      <CartaoAlice
        a={a}
        aoVerPrecisam={() => {
          setAba("precisam");
          sairDaSelecao();
        }}
      />

      {papel === "admin" ? <EncerrarParadas /> : null}

      <label className="relative block">
        <span className="sr-only">Buscar por nome ou telefone</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          type="search"
          inputMode="search"
          placeholder="Buscar por nome ou telefone"
          value={busca}
          onChange={(ev) => setBusca(ev.target.value)}
          className="min-h-11 w-full rounded-[22px] border border-input bg-card pr-10 pl-9 text-base focus-visible:ring-2 focus-visible:ring-marca focus-visible:outline-none"
        />
        {busca ? (
          <button
            type="button"
            aria-label="Limpar busca"
            onClick={() => setBusca("")}
            className="absolute top-1/2 right-1 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground"
          >
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </label>

      <div
        role="tablist"
        aria-label="Conversas"
        className="grid grid-cols-5 gap-1 rounded-botao bg-muted p-1"
      >
        {ABAS.map((t) => {
          const sel = t.id === aba;
          const lista = porGrupo.get(t.id) ?? [];
          // Contador da aba: quantas conversas têm mensagem não lida (o total de mensagens fica
          // só na bolinha do cartão).
          const n = lista.filter((c) => c.naoLidas > 0).length;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={sel}
              onClick={() => {
                setAba(t.id);
                sairDaSelecao();
              }}
              className={cn(
                "relative flex min-h-11 items-center justify-center gap-1 rounded-[0.625rem] px-0.5 text-[12px] leading-tight",
                sel
                  ? "bg-card font-bold text-marca shadow-sm"
                  : "font-medium text-muted-foreground",
              )}
            >
              {t.rotulo}
              {n > 0 ? (
                <BadgeAlerta numero={n} rotulo={`${n} conversas com mensagem não lida`} />
              ) : null}
            </button>
          );
        })}
      </div>

      {aba === "finalizadas" && !encontradas ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtro das encerradas">
          {(
            [
              ["todas", "Todas"],
              ["tempo", "Por tempo"],
              ["equipe", "Pela equipe"],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filtroEncerradas === id}
              onClick={() => setFiltroEncerradas(id)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm",
                filtroEncerradas === id
                  ? "border-marca bg-marca-claro font-bold text-marca"
                  : "border-border bg-card text-muted-foreground",
              )}
            >
              {rotulo}
            </button>
          ))}
        </div>
      ) : null}

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : q.error ? (
        <Card className="text-center">
          <p className="text-sm">
            {q.error instanceof Error ? q.error.message : "Erro ao carregar."}
          </p>
        </Card>
      ) : itens.length === 0 ? (
        <Card className="items-center py-8 text-center">
          <span className="grid size-12 place-items-center rounded-full bg-marca-claro text-marca">
            <MessageCircle className="size-6" aria-hidden />
          </span>
          <p className="max-w-xs text-sm text-muted-foreground">
            {encontradas
              ? "Nenhuma conversa dos últimos 7 dias com esse nome ou telefone."
              : atual.vazio}
          </p>
          {empresaAberta && outrasEmpresas.length ? (
            <div className="flex flex-col items-center gap-2 pt-2">
              <p className="text-xs text-muted-foreground">
                Você está vendo as conversas da <strong>{empresaAberta.nome}</strong>.
              </p>
              {outrasEmpresas.map((v) => (
                <Botao
                  key={v.empresa.id}
                  variante="contorno"
                  onClick={() => trocarEmpresa(v.empresa.id, "/conversas")}
                >
                  Ver as conversas da {v.empresa.nome}
                </Botao>
              ))}
            </div>
          ) : null}
        </Card>
      ) : (
        <>
          {podeEncerrar && aba === "precisam" ? (
            emSelecao ? (
              <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-card border border-marca bg-card p-2 shadow-sm">
                <span className="flex-1 px-2 text-sm font-semibold">
                  {marcadasVisiveis.length} {marcadasVisiveis.length === 1 ? "marcada" : "marcadas"}
                </span>
                <Botao
                  disabled={!marcadasVisiveis.length || encerrando}
                  onClick={() =>
                    void encerrar(marcadasVisiveis, "o cliente").then((ok) => ok && sairDaSelecao())
                  }
                >
                  {encerrando ? "Encerrando…" : `Encerrar ${marcadasVisiveis.length || ""}`.trim()}
                </Botao>
                <Botao variante="neutro" onClick={sairDaSelecao}>
                  Cancelar
                </Botao>
              </div>
            ) : (
              <Botao variante="neutro" className="self-start" onClick={() => setSelecionando(true)}>
                Selecionar para encerrar
              </Botao>
            )
          ) : null}
          <ul className="flex flex-col gap-2.5" aria-label={atual.rotulo}>
            {itens.map((c) => (
              <CartaoConversa
                key={c.id}
                c={c}
                agora={agora}
                encerravel={podeEncerrar}
                selecao={
                  emSelecao
                    ? {
                        marcada: marcadas.has(c.id),
                        alternar: () => {
                          const n = new Set(marcadas);
                          if (n.has(c.id)) n.delete(c.id);
                          else n.add(c.id);
                          setMarcadas(n);
                        },
                      }
                    : undefined
                }
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
