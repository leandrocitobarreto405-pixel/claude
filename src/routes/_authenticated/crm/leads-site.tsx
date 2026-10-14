import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { MessageCircle, Phone, Send, UserCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { AbasDeRota } from "@/components/nexa";
import { ABAS_DE_TELA } from "@/lib/menu";

import { Chip, type TomChip } from "@/components/nexa";
import { formatPhoneBR } from "@/lib/crm";
import { dateTimeBR } from "@/lib/format";
import {
  chamarLeadPeloModelo,
  listarLeadsSite,
  marcarLeadChamado,
  type LeadSite,
  type SituacaoLeadSite,
} from "@/lib/leads-site.functions";

export const Route = createFileRoute("/_authenticated/crm/leads-site")({
  head: () => ({
    meta: [
      { title: "Leads do site — Nexa OS" },
      {
        name: "description",
        content: "Quem se cadastrou nas landing pages e se já chamou no WhatsApp.",
      },
      { property: "og:title", content: "Leads do site — Nexa OS" },
      {
        property: "og:description",
        content: "Quem se cadastrou nas landing pages e se já chamou no WhatsApp.",
      },
    ],
  }),
  component: LeadsDoSite,
});

const SITUACAO: Record<SituacaoLeadSite, { texto: string; tom: TomChip }> = {
  nao_chamou: { texto: "Ainda não chamou", tom: "atencao" },
  chamou: { texto: "Chamou", tom: "sucesso" },
  invalido: { texto: "Número inválido", tom: "problema" },
  chamado_equipe: { texto: "Chamado pela equipe", tom: "neutro" },
};

const PERIODOS = [
  { valor: "hoje", texto: "Hoje" },
  { valor: "7d", texto: "7 dias" },
  { valor: "30d", texto: "30 dias" },
] as const;

const CHAVE = "leads_site";

function LeadsDoSite() {
  const listarFn = useServerFn(listarLeadsSite);
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]["valor"]>("hoje");
  const [filtro, setFiltro] = useState<SituacaoLeadSite | "todas">("todas");
  const q = useQuery({
    queryKey: [CHAVE, periodo],
    queryFn: () => listarFn({ data: { periodo } }),
    refetchInterval: 60_000,
  });
  const leads = useMemo(() => q.data?.leads ?? [], [q.data]);
  const contagem = useMemo(() => {
    const c: Record<SituacaoLeadSite, number> = {
      nao_chamou: 0,
      chamou: 0,
      invalido: 0,
      chamado_equipe: 0,
    };
    for (const l of leads) c[l.situacao]++;
    return c;
  }, [leads]);
  const visiveis = filtro === "todas" ? leads : leads.filter((l) => l.situacao === filtro);
  const comErro = (q.data?.planilhas ?? []).filter((p) => p.ativa && p.erro);

  return (
    <>
      <PageHeader
        title="Leads"
        description="Cadastros das landing pages e se a pessoa já chamou no WhatsApp."
      />
      <AbasDeRota abas={ABAS_DE_TELA.leads} rotulo="Leads" className="mb-4" />
      {comErro.map((p) => (
        <p
          key={p.nome}
          className="mb-3 rounded-md bg-problema px-3 py-2 text-sm text-problema-foreground"
        >
          Não deu para ler a planilha {p.nome}: {p.erro}
        </p>
      ))}
      {q.data && !q.data.planilhas.length ? (
        <p className="mb-3 rounded-md bg-atencao px-3 py-2 text-sm text-atencao-foreground">
          Nenhuma planilha configurada. O administrador cadastra em Configurações → Leads do site.
        </p>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-2">
        {PERIODOS.map((p) => (
          <Button
            key={p.valor}
            variant={periodo === p.valor ? "default" : "outline"}
            className="min-h-11"
            onClick={() => setPeriodo(p.valor)}
          >
            {p.texto}
          </Button>
        ))}
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        <FiltroBotao ativo={filtro === "todas"} onClick={() => setFiltro("todas")}>
          Todos ({leads.length})
        </FiltroBotao>
        {(Object.keys(SITUACAO) as SituacaoLeadSite[]).map((s) => (
          <FiltroBotao key={s} ativo={filtro === s} onClick={() => setFiltro(s)}>
            {SITUACAO[s].texto} ({contagem[s]})
          </FiltroBotao>
        ))}
      </div>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : q.isError ? (
        <p className="text-sm text-problema">
          {q.error instanceof Error ? q.error.message : "Não foi possível carregar."}
        </p>
      ) : !visiveis.length ? (
        <EmptyState title="Nenhum cadastro" description="Nada neste período com esse filtro." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {visiveis.map((l) => (
            <CartaoLead key={l.id} lead={l} />
          ))}
        </ul>
      )}
      {q.data?.envioLigado ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Envio automático do modelo {q.data.modelo} ligado (Configurações → Leads do site).
        </p>
      ) : null}
    </>
  );
}

function FiltroBotao(props: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={`min-h-11 rounded-full border px-3 text-sm ${
        props.ativo
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground"
      }`}
    >
      {props.children}
    </button>
  );
}

function CartaoLead({ lead: l }: { lead: LeadSite }) {
  const qc = useQueryClient();
  const marcarFn = useServerFn(marcarLeadChamado);
  const chamarFn = useServerFn(chamarLeadPeloModelo);
  const [ocupado, setOcupado] = useState(false);
  const s = SITUACAO[l.situacao];

  async function executar(acao: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await acao();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: [CHAVE] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  const podeEnviar = Boolean(l.telefone) && !l.modeloEnviadoEm && l.situacao !== "chamou";

  return (
    <li className="card-surface grid gap-2 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold">{l.nome || "Sem nome"}</p>
          <p className="text-xs text-muted-foreground">{dateTimeBR(l.cadastradoEm)}</p>
        </div>
        <Chip tom={s.tom}>{s.texto}</Chip>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Telefone</dt>
        <dd className="break-all">{formatPhoneBR(l.telefone ?? l.telefoneDigitado)}</dd>
        <dt className="text-muted-foreground">LP</dt>
        <dd>{l.lp}</dd>
        <dt className="text-muted-foreground">Palavra</dt>
        <dd className="break-words">{l.utmTerm || "—"}</dd>
        {l.servico ? (
          <>
            <dt className="text-muted-foreground">Serviço</dt>
            <dd>{l.servico}</dd>
          </>
        ) : null}
      </dl>
      {l.chamouEm ? (
        <p className="text-xs text-muted-foreground">Chamou em {dateTimeBR(l.chamouEm)}</p>
      ) : null}
      {l.modeloEnviadoEm ? (
        <p className="text-xs text-muted-foreground">
          Mensagem enviada em {dateTimeBR(l.modeloEnviadoEm)}
        </p>
      ) : l.modeloErro && l.modeloErro !== "enviando" ? (
        <p className="text-xs text-problema">Mensagem não enviada: {l.modeloErro}</p>
      ) : null}
      {l.repetidos ? (
        <p className="text-xs text-muted-foreground">
          + {l.repetidos} {l.repetidos === 1 ? "cadastro repetido" : "cadastros repetidos"} em 30
          min
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {l.telefone || l.telefoneDigitado ? (
          <Button asChild variant="outline" className="min-h-11">
            <a href={`tel:${l.telefone ? `+${l.telefone}` : l.telefoneDigitado}`}>
              <Phone className="mr-2 size-4" />
              Ligar
            </a>
          </Button>
        ) : null}
        {l.conversaId ? (
          <Button asChild variant="outline" className="min-h-11">
            <Link to="/conversas/$conversaId" params={{ conversaId: l.conversaId }}>
              <MessageCircle className="mr-2 size-4" />
              Abrir conversa
            </Link>
          </Button>
        ) : podeEnviar ? (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={ocupado}
            onClick={() => {
              if (
                !window.confirm(
                  "Mandar a mensagem de boas-vindas (modelo aprovado) para este lead pelo WhatsApp da empresa?",
                )
              )
                return;
              void executar(() => chamarFn({ data: { id: l.id } }), "Mensagem enviada.");
            }}
          >
            <Send className="mr-2 size-4" />
            Chamar no WhatsApp
          </Button>
        ) : null}
        {l.situacao === "nao_chamou" || l.situacao === "invalido" ? (
          <Button
            variant="outline"
            className="min-h-11"
            disabled={ocupado}
            onClick={() =>
              void executar(
                () => marcarFn({ data: { id: l.id, chamado: true } }),
                "Marcado como chamado.",
              )
            }
          >
            <UserCheck className="mr-2 size-4" />
            Marcar como chamado
          </Button>
        ) : l.situacao === "chamado_equipe" ? (
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={ocupado}
            onClick={() =>
              void executar(() => marcarFn({ data: { id: l.id, chamado: false } }), "Desfeito.")
            }
          >
            <Undo2 className="mr-2 size-4" />
            Desfazer
          </Button>
        ) : null}
        {l.crmLeadId ? (
          <Button asChild variant="ghost" className="min-h-11">
            <Link to="/crm/lead/$leadId" params={{ leadId: l.crmLeadId }}>
              Ver no CRM
            </Link>
          </Button>
        ) : null}
      </div>
    </li>
  );
}
