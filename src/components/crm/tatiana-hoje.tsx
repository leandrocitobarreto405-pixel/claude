// Aba Follow-ups › topo: "Recado da Tatiana" (frase do dia, resumo e acertos no app) e "Tarefas
// de hoje" em ordem de prioridade. A pessoa vê as dela; o admin vê todas, com filtro por pessoa e
// o que a Alice faria. Copiar e Abrir conversa não enviam nada: a pessoa decide e manda.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Archive,
  Bot,
  CalendarClock,
  Check,
  Copy,
  GraduationCap,
  MessageCircle,
  Phone,
  SkipForward,
} from "lucide-react";
import { toast } from "sonner";
import { Botao, Card, Chip, Recolhido } from "@/components/nexa";
import {
  concluirTarefaFn,
  desfazerAcaoFn,
  hojeTatianaFn,
  pularTarefaFn,
  resolverAcertoFn,
  type AcaoFeita,
  type Acerto,
  type HojeTatiana,
  type TarefaHoje,
} from "@/lib/tatiana.functions";
import { supabase } from "@/integrations/supabase/client";
import { completeVisit } from "@/lib/os";
import { concluirVisitaSemPagamento } from "@/lib/visita-acoes";
import { useSession } from "@/lib/session";
import { todayISO } from "@/lib/format";
import { textoSemanaEquipe } from "@/lib/comercial/equipe";
import { decidirFeriadoFn } from "@/lib/feriados.functions";
import type { FeriadoPendente } from "@/lib/tatiana.functions";
import { NOME_GERENTE } from "@/lib/comercial/tatiana";
import { chamarLeadPeloModelo, marcarLeadChamado } from "@/lib/leads-site.functions";
import { ROTULO_TAREFA } from "@/lib/comercial/furos";
import { seloDaQueVoltou } from "@/lib/comercial/sem-novidade";
import {
  contarPorNivel,
  nivelDaTarefa,
  prazoDaTarefa,
  tarefaAtrasada,
} from "@/lib/comercial/prioridade";
import {
  NOME_GRUPO_BASE,
  NOME_RECOMENDACAO,
  type DadosBaseParada,
  type Recomendacao,
} from "@/lib/comercial/base-parada";
import type { DadosNaoSoube } from "@/lib/comercial/alice-nao-soube";
import { dateTimeBR } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHAVE_TATIANA = ["tatiana-hoje"];

const copiar = (texto: string) =>
  void navigator.clipboard
    .writeText(texto)
    .then(() => toast.success("Mensagem copiada."))
    .catch(() => toast.error("Não foi possível copiar."));

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TatianaHoje({ dados }: { dados?: HojeTatiana }) {
  const fn = useServerFn(hojeTatianaFn);
  const q = useQuery({ queryKey: CHAVE_TATIANA, queryFn: () => fn(), enabled: !dados });
  const d = dados ?? q.data;
  const [pessoa, setPessoa] = useState<string>("todas");
  const tarefas = useMemo(
    () =>
      (d?.tarefas ?? []).filter(
        (t) =>
          pessoa === "todas" || (pessoa === "sem" ? !t.responsavelId : t.responsavelId === pessoa),
      ),
    [d, pessoa],
  );
  const acertos = useMemo(
    () =>
      (d?.acertos ?? []).filter(
        (a) =>
          pessoa === "todas" ||
          d?.pessoas.find((p) => p.id === pessoa)?.nome === a.responsavelNome ||
          (pessoa === "sem" && !a.responsavelNome),
      ),
    [d, pessoa],
  );
  if (!d || d.modo === "desligado") return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Card className="min-w-0 gap-2 border-marca/30 bg-marca-claro">
        <p className="text-xs font-bold uppercase tracking-wide text-marca">
          Recado da {NOME_GERENTE}
        </p>
        <p className="font-titulo text-lg leading-snug">
          {d.recado?.frase ?? `Bom dia! Bora fazer acontecer hoje 💙`}
        </p>
        {d.recado?.resumo ? <p className="text-sm">{d.recado.resumo}</p> : null}
        {d.semana ? (
          <p className="text-xs text-muted-foreground">
            Semana da equipe: {textoSemanaEquipe(d.semana)}.
          </p>
        ) : null}
        {d.modo === "teste" ? (
          <p className="text-xs text-muted-foreground">
            Em teste: as tarefas são sugestões da {NOME_GERENTE}; você decide o que fazer.
          </p>
        ) : null}
        {acertos.length ? <AcertosNoApp acertos={acertos} admin={d.admin} /> : null}
        {d.feitas.length ? <FeitoPelaTatiana feitas={d.feitas} modo={d.modo} /> : null}
      </Card>

      {d.admin && d.baseParada ? <BaseParada b={d.baseParada} /> : null}

      {d.admin && d.aliceNaoSoube ? <AliceNaoSoube r={d.aliceNaoSoube} /> : null}

      {d.admin && d.feriados.length ? <FeriadosParaDecidir feriados={d.feriados} /> : null}

      {d.admin && d.pessoas.length ? (
        <div
          className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-muted p-1"
          role="radiogroup"
          aria-label="Pessoa"
        >
          {[{ id: "todas", nome: "Todas" }, ...d.pessoas, { id: "sem", nome: "Sem dono" }].map(
            (p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={pessoa === p.id}
                onClick={() => setPessoa(p.id)}
                className={cn(
                  "min-h-9 shrink-0 rounded-full px-3 text-sm font-semibold",
                  pessoa === p.id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {p.id === "todas" || p.id === "sem" ? p.nome : p.nome.split(" ")[0]}
              </button>
            ),
          )}
        </div>
      ) : null}

      <TarefasPorPrioridade tarefas={tarefas} admin={d.admin} />

      {d.admin && d.alice.length ? (
        <Recolhido
          titulo={`O que a Alice ${d.modo === "teste" ? "faria" : "vai mandar"}`}
          contagem={d.alice.length}
          icone={<Bot aria-hidden className="size-5" />}
        >
          <ul className="flex flex-col divide-y divide-border">
            {d.alice.map((a) => (
              <li key={a.leadId} className="flex min-w-0 flex-col gap-1 p-3 text-sm">
                <p className="font-semibold">
                  {a.leadNome}
                  {a.telefoneFinal ? (
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · final {a.telefoneFinal}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  {a.quando ? dateTimeBR(a.quando) : "amanhã"} · {a.motivo}
                </p>
                {a.mensagem ? (
                  <p className="rounded-botao bg-background p-2">{a.mensagem}</p>
                ) : null}
                {a.padraoFaria ? (
                  <p className="text-xs text-muted-foreground">Padrão faria: {a.padraoFaria}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </Recolhido>
      ) : null}
    </div>
  );
}

/**
 * Tarefas por prioridade (05/11): sem corte. P1 num bloco vermelho no topo, com contador e prazo
 * "hoje de manhã", que não some até ter Feito ou desfecho; depois P2 (hoje) e P3 (dia marcado).
 */
function TarefasPorPrioridade({ tarefas, admin }: { tarefas: TarefaHoje[]; admin: boolean }) {
  const hoje = todayISO();
  const c = contarPorNivel(tarefas, hoje);
  const grupo = (n: 1 | 2 | 3) => tarefas.filter((t) => nivelDaTarefa(t.prioridade) === n);
  const p1 = grupo(1);
  const p2 = grupo(2);
  const p3 = grupo(3);
  let ordem = 0;
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h2 className="font-titulo text-lg font-bold">
        Tarefas de hoje <span className="text-muted-foreground">({tarefas.length})</span>
      </h2>
      <div className="flex flex-wrap gap-2 text-sm">
        <Chip tom="problema">P1 urgente: {c.p1}</Chip>
        <Chip tom="sucesso">P2 hoje: {c.p2}</Chip>
        <Chip tom="neutro">P3: {c.p3}</Chip>
        {c.atrasadas ? <Chip tom="atencao">Atrasadas: {c.atrasadas}</Chip> : null}
      </div>
      {p1.length ? (
        <div className="flex min-w-0 flex-col gap-2 rounded-card border-2 border-problema-foreground/50 bg-problema/50 p-3">
          <p className="font-titulo text-base font-bold text-problema-foreground">
            URGENTE · fazer agora de manhã ({p1.length})
          </p>
          <p className="text-xs text-problema-foreground">
            Quase fechado: concorrente, preço, encaixe, retorno vencido ou cliente esperando. Fica
            aqui até ter Feito ou desfecho.
          </p>
          {p1.map((t) => (
            <CartaoTarefa key={t.id} t={t} ordem={++ordem} admin={admin} />
          ))}
        </div>
      ) : null}
      {p2.length ? (
        <>
          <h3 className="font-titulo text-base font-bold">
            P2 · Hoje <span className="text-muted-foreground">({p2.length})</span>
          </h3>
          {p2.map((t) => (
            <CartaoTarefa key={t.id} t={t} ordem={++ordem} admin={admin} />
          ))}
        </>
      ) : null}
      {p3.length ? (
        <>
          <h3 className="font-titulo text-base font-bold">
            P3 · No dia marcado <span className="text-muted-foreground">({p3.length})</span>
          </h3>
          {p3.map((t) => (
            <CartaoTarefa key={t.id} t={t} ordem={++ordem} admin={admin} />
          ))}
        </>
      ) : null}
      {!tarefas.length ? (
        <Card className="text-sm text-muted-foreground">
          Nenhuma tarefa da {NOME_GERENTE} para hoje.
        </Card>
      ) : null}
    </section>
  );
}

function CartaoTarefa({ t, ordem, admin }: { t: TarefaHoje; ordem: number; admin: boolean }) {
  const qc = useQueryClient();
  const feito = useServerFn(concluirTarefaFn);
  const pular = useServerFn(pularTarefaFn);
  const chamarSite = useServerFn(chamarLeadPeloModelo);
  const marcarSite = useServerFn(marcarLeadChamado);
  const [pulando, setPulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
  // Visita que passou da data (12/11): a tarefa pergunta "foi feita?" com Concluir e Remarcar.
  const vencida = t.visitaVencida;
  const [caminho, setCaminho] = useState<"pergunta" | "concluir" | "remarcar">("pergunta");
  const mostrarCorpo = !vencida || caminho === "remarcar";
  const { user } = useSession();
  const concluirVisita = async () => {
    setSalvando(true);
    try {
      const r = await concluirVisitaSemPagamento({
        visitId: vencida!.visitaId,
        userId: user?.id ?? null,
        nota: `Conclusão confirmada pela equipe na tarefa de visita vencida da ${NOME_GERENTE}.`,
      });
      await feito({ data: { id: t.id } });
      toast.success(`Visita concluída (R$ ${r.valor.toLocaleString("pt-BR")}) 💙`);
      await qc.invalidateQueries({ queryKey: CHAVE_TATIANA });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setSalvando(false);
    }
  };
  const agir = async (f: () => Promise<unknown>, msg: string) => {
    setSalvando(true);
    try {
      await f();
      toast.success(msg);
      await qc.invalidateQueries({ queryKey: CHAVE_TATIANA });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Card className="min-w-0 gap-2">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-titulo text-lg tabular-nums text-muted-foreground">{ordem}</span>
        {t.leadId ? (
          <Link
            to="/crm/lead/$leadId"
            params={{ leadId: t.leadId }}
            className="min-w-0 font-semibold underline-offset-2 hover:underline"
          >
            {t.leadNome}
          </Link>
        ) : (
          <span className="font-semibold">{t.leadNome}</span>
        )}
        {t.telefoneFinal ? (
          <span className="text-xs text-muted-foreground">final {t.telefoneFinal}</span>
        ) : null}
        <span className="ml-auto flex flex-wrap gap-1">
          {t.rotulo ? <Chip tom="sucesso">{t.rotulo}</Chip> : null}
          {vencida ? (
            <Chip tom="problema">Visita em aberto</Chip>
          ) : t.tipo !== "mensagem" ? (
            <Chip tom={t.tipo === "follow_up_esquecido" ? "problema" : "sucesso"}>
              {t.tipo === "ligar" ? <Phone aria-hidden className="size-3.5" /> : null}
              {ROTULO_TAREFA[t.tipo]}
            </Chip>
          ) : null}
          {t.adiamentos > 0 ? <Chip tom="atencao">{seloDaQueVoltou(t.adiamentos)}</Chip> : null}
          {tarefaAtrasada(t.quando, todayISO(), t.adiamentos) ? (
            <Chip tom="atencao">Atrasada</Chip>
          ) : null}
          <Chip tom={nivelDaTarefa(t.prioridade) === 1 ? "problema" : "neutro"}>
            Prazo: {prazoDaTarefa(nivelDaTarefa(t.prioridade), t.quando, todayISO())}
          </Chip>
          <Chip tom="neutro">{hora(t.quando)}</Chip>
        </span>
      </div>
      {t.telefone ? (
        <p className="text-sm">
          <span className="font-semibold">Telefone: </span>
          <a
            href={`tel:+${t.telefone.replace(/\D/g, "")}`}
            className="underline underline-offset-2"
          >
            {t.telefone}
          </a>
        </p>
      ) : null}
      {admin && t.responsavelNome ? (
        <p className="text-xs text-muted-foreground">Para {t.responsavelNome.split(" ")[0]}</p>
      ) : null}
      {vencida && t.motivo ? (
        <p className="text-[15px] font-semibold">{t.motivo}</p>
      ) : t.motivo ? (
        <p className="text-sm">
          <span className="font-semibold">Por quê: </span>
          {t.motivo}
        </p>
      ) : null}
      {vencida && caminho === "pergunta" ? (
        <div className="flex flex-wrap gap-2">
          <Botao disabled={salvando} onClick={() => setCaminho("concluir")}>
            <Check aria-hidden /> Concluir
          </Botao>
          <Botao variante="contorno" disabled={salvando} onClick={() => setCaminho("remarcar")}>
            <CalendarClock aria-hidden /> Remarcar
          </Botao>
        </div>
      ) : null}
      {vencida && caminho === "concluir" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs">
            Concluir a visita com o valor combinado, sem lançar pagamento? O pagamento pode ser
            lançado depois na OS.
          </p>
          <div className="flex flex-wrap gap-2">
            <Botao disabled={salvando} onClick={() => void concluirVisita()}>
              Confirmar conclusão
            </Botao>
            <Botao variante="neutro" onClick={() => setCaminho("pergunta")}>
              Voltar
            </Botao>
          </div>
        </div>
      ) : null}
      {vencida && caminho === "remarcar" ? (
        <button
          type="button"
          onClick={() => setCaminho("pergunta")}
          className="self-start text-xs font-semibold underline underline-offset-2"
        >
          Voltar à pergunta
        </button>
      ) : null}
      {mostrarCorpo && t.mensagem ? (
        <div className="flex flex-col gap-1">
          {t.tipo === "ligar" ? (
            <span className="text-xs font-semibold">O que dizer na ligação</span>
          ) : null}
          <p className="whitespace-pre-wrap rounded-botao bg-background p-3 text-sm">
            {t.mensagem}
          </p>
        </div>
      ) : null}
      {mostrarCorpo && !t.dentroDaJanela && t.conversaId ? (
        <p className="text-xs text-atencao-foreground">
          Fora da janela de 24 h do WhatsApp: copie a mensagem ou use um modelo aprovado.
        </p>
      ) : null}
      {!mostrarCorpo ? null : pulando ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`pular-${t.id}`} className="text-xs font-semibold">
            Recado para a Tatiana: por que não vai ser feita? (opcional)
          </label>
          <textarea
            id={`pular-${t.id}`}
            value={motivo}
            maxLength={300}
            onChange={(e) => setMotivo(e.target.value)}
            className="min-h-16 w-full rounded-botao border border-border bg-background p-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Botao
              disabled={salvando}
              onClick={() =>
                void agir(() => pular({ data: { id: t.id, motivo } }), "Tarefa pulada.")
              }
            >
              Confirmar
            </Botao>
            <Botao variante="neutro" onClick={() => setPulando(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : t.leadSiteId ? (
        <div className="flex flex-wrap gap-2">
          <Botao
            disabled={salvando}
            onClick={() =>
              void agir(
                () => chamarSite({ data: { id: t.leadSiteId! } }),
                "Modelo aprovado enviado ao lead do site.",
              )
            }
          >
            <MessageCircle aria-hidden /> Mandar modelo
          </Botao>
          <Botao
            variante="neutro"
            disabled={salvando}
            onClick={() =>
              void agir(
                () => marcarSite({ data: { id: t.leadSiteId!, chamado: true } }),
                "Marcado como chamado.",
              )
            }
          >
            <Check aria-hidden /> Já liguei
          </Botao>
          {t.mensagem ? (
            <Botao variante="contorno" onClick={() => copiar(t.mensagem!)}>
              <Copy aria-hidden /> Copiar
            </Botao>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {t.mensagem ? (
            <Botao variante="contorno" onClick={() => copiar(t.mensagem!)}>
              <Copy aria-hidden /> Copiar
            </Botao>
          ) : null}
          {t.conversaId ? (
            <Link
              to="/conversas/$conversaId"
              params={{ conversaId: t.conversaId }}
              search={t.dentroDaJanela && t.mensagem ? { texto: t.mensagem } : {}}
              className="inline-flex min-h-11 items-center gap-2 rounded-botao bg-background px-4 text-sm font-semibold hover:bg-muted"
            >
              <MessageCircle aria-hidden className="size-4" /> Abrir conversa
            </Link>
          ) : null}
          <Botao
            disabled={salvando}
            onClick={() => void agir(() => feito({ data: { id: t.id } }), "Feito! 💙")}
          >
            <Check aria-hidden /> Feito
          </Botao>
          <Botao variante="neutro" onClick={() => setPulando(true)}>
            <SkipForward aria-hidden /> Pular
          </Botao>
        </div>
      )}
    </Card>
  );
}

function linkDoAcerto(
  a: Acerto,
): { to: string; params?: Record<string, string>; search?: Record<string, string> } | null {
  switch (a.acao) {
    case "orcamento":
      return {
        to: "/orcamentos/$quoteId",
        params: { quoteId: "novo" },
        search: { lead: a.leadId, acerto: a.id },
      };
    case "os":
      return { to: "/nova-os", search: { lead: a.leadId } };
    case "remarcar":
    case "concluir":
      return a.osNumero
        ? { to: "/os/$osNumber", params: { osNumber: a.osNumero } }
        : { to: "/crm/lead/$leadId", params: { leadId: a.leadId } };
    case "cadastro":
      return { to: "/crm/lead/$leadId", params: { leadId: a.leadId } };
    default:
      return null;
  }
}

function AcertosNoApp({ acertos, admin }: { acertos: Acerto[]; admin: boolean }) {
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-2 border-t border-marca/20 pt-2">
      <p className="text-sm font-bold">Acertos no app ({acertos.length})</p>
      <p className="text-xs text-muted-foreground">
        Coisinhas que ficaram só na conversa. Um toque e o app fica em dia 💙
      </p>
      <ul className="flex min-w-0 flex-col gap-2">
        {acertos.map((a) => (
          <ItemAcerto key={a.id} a={a} admin={admin} />
        ))}
      </ul>
    </div>
  );
}

/** O que a Tatiana fez sozinha no app (modo ativo) ou faria (teste), com Desfazer em cada item. */
function FeitoPelaTatiana({ feitas, modo }: { feitas: AcaoFeita[]; modo: HojeTatiana["modo"] }) {
  const feitasMesmo = feitas.filter((f) => f.situacao !== "faria");
  const faria = feitas.filter((f) => f.situacao === "faria");
  return (
    <div className="mt-1 flex min-w-0 flex-col gap-2 border-t border-marca/20 pt-2">
      <p className="text-sm font-bold">
        {modo === "ativo" ? `Feito pela ${NOME_GERENTE}` : `A ${NOME_GERENTE} faria (modo teste)`} (
        {feitas.length})
      </p>
      <p className="text-xs text-muted-foreground">
        {modo === "ativo"
          ? "Ela fez sozinha pelo que leu na conversa. Nada foi enviado ao cliente. Se algo estiver errado, Desfazer volta como estava."
          : "Em modo ativo ela faria isto sozinha e avisaria aqui."}
      </p>
      <ul className="flex min-w-0 flex-col gap-2">
        {[...feitasMesmo, ...faria].map((f) => (
          <ItemFeito key={f.id} f={f} />
        ))}
      </ul>
    </div>
  );
}

function ItemFeito({ f }: { f: AcaoFeita }) {
  const qc = useQueryClient();
  const desfazer = useServerFn(desfazerAcaoFn);
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const tom =
    f.situacao === "feita"
      ? "sucesso"
      : f.situacao === "falhou"
        ? "problema"
        : f.situacao === "desfeita"
          ? "neutro"
          : "atencao";
  const rotulo =
    f.situacao === "feita"
      ? "Feito"
      : f.situacao === "falhou"
        ? "Não deu"
        : f.situacao === "desfeita"
          ? "Desfeito"
          : "Faria";
  const confirmar = async () => {
    setOcupado(true);
    try {
      await desfazer({ data: { id: f.id, motivo } });
      toast.success("Desfeito. A cobrança voltou para a lista da equipe.");
      await qc.invalidateQueries({ queryKey: CHAVE_TATIANA });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desfazer.");
    } finally {
      setOcupado(false);
      setAberto(false);
    }
  };
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-botao bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tom={tom}>{rotulo}</Chip>
        <span className="text-xs text-muted-foreground">
          {f.nome} · {dateTimeBR(f.feitaEm)}
        </span>
      </div>
      <p>{f.titulo}</p>
      {f.frase ? <p className="text-xs text-muted-foreground">Na conversa: {f.frase}</p> : null}
      {f.erro ? <p className="text-xs text-muted-foreground">Motivo: {f.erro}</p> : null}
      {f.osNumero && f.situacao === "feita" ? (
        <p className="text-xs">
          Vendedora na OS: <span className="font-semibold">{f.vendedora ?? "não definida"}</span>{" "}
          (vale para a comissão).{" "}
          <Link
            to="/os/$osNumber"
            params={{ osNumber: f.osNumero }}
            className="font-semibold text-marca underline underline-offset-2"
          >
            Trocar na OS {f.osNumero}
          </Link>
        </p>
      ) : null}
      {f.situacao === "feita" ? (
        aberto ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`feito-${f.id}`} className="text-xs font-semibold">
              Por que desfazer? (opcional)
            </label>
            <textarea
              id={`feito-${f.id}`}
              value={motivo}
              maxLength={300}
              onChange={(e) => setMotivo(e.target.value)}
              className="min-h-16 w-full rounded-botao border border-border bg-background p-2 text-sm"
            />
            <div className="flex flex-wrap gap-2">
              <Botao onClick={() => void confirmar()} disabled={ocupado}>
                Desfazer agora
              </Botao>
              <Botao variante="neutro" onClick={() => setAberto(false)}>
                Cancelar
              </Botao>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Botao variante="contorno" onClick={() => setAberto(true)}>
              Desfazer
            </Botao>
          </div>
        )
      ) : null}
    </li>
  );
}

/** Conclusão de visita (item 10): nunca sozinha; a equipe confirma com um toque, com a frase da conversa. */
async function concluirVisitaDoAcerto(a: Acerto): Promise<string> {
  if (!a.osId) throw new Error("Esse lead não tem OS ligada: conclua pela OS.");
  const { data, error } = await supabase
    .from("visits")
    .select("id, scheduled_date, scheduled_time, visit_value, final_value, status")
    .eq("work_order_id", a.osId)
    .neq("status", "Cancelado");
  if (error) throw error;
  const abertas = (data ?? []).filter((v) => v.status !== "Concluído");
  if (abertas.length !== 1)
    throw new Error(
      abertas.length
        ? "Essa OS tem mais de uma visita em aberto: conclua pela OS."
        : "Não há visita em aberto nessa OS.",
    );
  const v = abertas[0]!;
  const valor = Number(v.final_value ?? v.visit_value ?? 0);
  await completeVisit({
    visitId: v.id,
    workOrderId: a.osId,
    finalValue: valor,
    changeReason: null,
    completionDate: v.scheduled_date ?? todayISO(),
    completionTime: v.scheduled_time ?? "12:00",
    finalNotes: `Conclusão confirmada pela equipe no acerto da ${NOME_GERENTE}.`,
    payments: [],
    invoiceNeeded: false,
    invoiceIssued: false,
    invoiceNumber: null,
    userId: null,
  });
  return `${v.scheduled_date ? dateTimeBR(`${v.scheduled_date}T12:00:00-03:00`).slice(0, 5) : "visita"} · R$ ${valor.toLocaleString("pt-BR")}`;
}

function ItemAcerto({ a, admin }: { a: Acerto; admin: boolean }) {
  const qc = useQueryClient();
  const resolver = useServerFn(resolverAcertoFn);
  const [motivoAberto, setMotivoAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [concluirAberto, setConcluirAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const link = linkDoAcerto(a);
  const confirmarConclusao = async () => {
    setOcupado(true);
    try {
      const resumo = await concluirVisitaDoAcerto(a);
      await resolver({ data: { id: a.id, situacao: "resolvida", motivo: "" } });
      toast.success(`Visita concluída (${resumo}) 💙`);
      await qc.invalidateQueries({ queryKey: CHAVE_TATIANA });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setOcupado(false);
      setConcluirAberto(false);
    }
  };
  const enviar = async (situacao: "resolvida" | "ja_certo") => {
    try {
      await resolver({ data: { id: a.id, situacao, motivo } });
      toast.success(situacao === "ja_certo" ? "Anotado, obrigada!" : "Acerto feito 💙");
      await qc.invalidateQueries({ queryKey: CHAVE_TATIANA });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  };
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-botao bg-card p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip tom="atencao">{a.rotulo}</Chip>
        {a.anuncio ? <Chip tom="problema">Anúncio</Chip> : null}
      </div>
      <p>
        <span className="font-semibold">{a.leadNome}</span>
        {a.telefoneFinal ? (
          <span className="text-muted-foreground"> · final {a.telefoneFinal}</span>
        ) : null}
        {admin && a.responsavelNome ? (
          <span className="text-muted-foreground"> · {a.responsavelNome.split(" ")[0]}</span>
        ) : null}
      </p>
      <p>{a.texto}</p>
      {motivoAberto ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`acerto-${a.id}`} className="text-xs font-semibold">
            Por que já está certo? (opcional)
          </label>
          <textarea
            id={`acerto-${a.id}`}
            value={motivo}
            maxLength={300}
            onChange={(e) => setMotivo(e.target.value)}
            className="min-h-16 w-full rounded-botao border border-border bg-background p-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Botao onClick={() => void enviar("ja_certo")}>Confirmar</Botao>
            <Botao variante="neutro" onClick={() => setMotivoAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : concluirAberto ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs">
            Concluir a visita dessa OS com o valor combinado, sem lançar pagamento? A conversa diz:
            "{a.texto}"
          </p>
          <div className="flex flex-wrap gap-2">
            <Botao onClick={() => void confirmarConclusao()} disabled={ocupado}>
              Confirmar conclusão
            </Botao>
            <Botao variante="neutro" onClick={() => setConcluirAberto(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {a.tipo === "concluir_os" && a.osId ? (
            <Botao onClick={() => setConcluirAberto(true)}>Confirmar conclusão</Botao>
          ) : null}
          {link ? (
            <Link
              to={link.to as never}
              params={link.params as never}
              search={link.search as never}
              className="inline-flex min-h-11 items-center rounded-botao bg-marca px-4 text-sm font-semibold text-marca-foreground hover:bg-marca/90"
            >
              {a.botao}
            </Link>
          ) : (
            <Botao onClick={() => void enviar("resolvida")}>{a.botao}</Botao>
          )}
          {link ? (
            <Botao variante="contorno" onClick={() => void enviar("resolvida")}>
              Já fiz
            </Botao>
          ) : null}
          <Botao variante="neutro" onClick={() => setMotivoAberto(true)}>
            Já está certo
          </Botao>
        </div>
      )}
    </li>
  );
}

/** Feriados dos próximos dias sem decisão: "Vamos trabalhar" (dia normal) ou "Não vamos" (bloqueado). */
function FeriadosParaDecidir({ feriados }: { feriados: FeriadoPendente[] }) {
  const fn = useServerFn(decidirFeriadoFn);
  const qc = useQueryClient();
  const [salvando, setSalvando] = useState<string | null>(null);
  const curta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  const diaSemana = (iso: string) =>
    ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${iso}T12:00:00Z`).getUTCDay()];
  async function decidir(f: FeriadoPendente, trabalhamos: boolean) {
    setSalvando(f.id);
    try {
      const r = await fn({ data: { id: f.id, trabalhamos } });
      toast.success(
        trabalhamos
          ? `${curta(f.data)}: dia normal na agenda.`
          : `${curta(f.data)}: bloqueado${r.remarcar ? ` · ${r.remarcar} ${r.remarcar === 1 ? "atendimento vira tarefa de remarcar" : "atendimentos viram tarefas de remarcar"}` : ""}.`,
      );
      await qc.invalidateQueries({ queryKey: CHAVE_TATIANA });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setSalvando(null);
    }
  }
  return (
    <Card className="min-w-0 gap-2">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Feriados: vamos trabalhar?
      </p>
      <ul className="flex min-w-0 flex-col gap-2">
        {feriados.map((f) => (
          <li
            key={f.id}
            className="flex min-w-0 flex-col gap-2 rounded-card bg-secondary/60 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-bold">
                {diaSemana(f.data)} {curta(f.data)} · {f.nome}
              </p>
              <p className="text-xs text-muted-foreground">
                {f.diasAte === 0
                  ? "É hoje."
                  : f.diasAte === 1
                    ? "É amanhã."
                    : `Faltam ${f.diasAte} dias.`}{" "}
                Sem resposta até a véspera, o dia fica bloqueado (sem horário para a Alice e sem
                tarefas).
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Botao
                variante="contorno"
                disabled={salvando === f.id}
                onClick={() => void decidir(f, true)}
              >
                Vamos trabalhar
              </Botao>
              <Botao disabled={salvando === f.id} onClick={() => void decidir(f, false)}>
                Não vamos
              </Botao>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const TOM_RECOMENDACAO: Record<Recomendacao, "neutro" | "sucesso" | "atencao" | "problema"> = {
  guardar: "neutro",
  encerrar: "problema",
  tarefa: "sucesso",
  misto: "atencao",
};

/** Recado semanal da base parada (04/11): só leitura, sem botão de encerrar nem de enviar. */
function BaseParada({ b }: { b: DadosBaseParada & { criadoEm: string } }) {
  return (
    <Recolhido
      titulo={`Recado da ${NOME_GERENTE} · base parada (${b.total} leads)`}
      icone={<Archive aria-hidden className="size-5" />}
    >
      <div className="flex min-w-0 flex-col gap-3 px-4 pb-4 text-sm">
        <p className="text-xs text-muted-foreground">
          {dateTimeBR(b.criadoEm)} · {b.total} leads parados (sem mensagem há mais de 7 dias, sem
          toque, sem orçamento aberto e sem OS) · ela leu {b.lidos} conversas. São recomendações:
          nada foi encerrado nem enviado.
        </p>
        {b.resumo ? <p>{b.resumo}</p> : null}
        <ul className="flex min-w-0 flex-col gap-2">
          {b.grupos.map((g) => (
            <li
              key={g.grupo}
              className="flex min-w-0 flex-col gap-1 rounded-botao border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">
                  {NOME_GRUPO_BASE[g.grupo]}{" "}
                  <span className="font-normal text-muted-foreground">({g.leads})</span>
                </p>
                <Chip tom={TOM_RECOMENDACAO[g.recomendacao]}>
                  {NOME_RECOMENDACAO[g.recomendacao]}
                </Chip>
              </div>
              <p>{g.texto}</p>
              {g.exemplos.length ? (
                <p className="text-xs text-muted-foreground">
                  Exemplos: {g.exemplos.map((e) => `final ${e}`).join(", ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="flex min-w-0 flex-col gap-1 rounded-botao bg-marca-claro p-3">
          <p className="font-semibold">
            Campanha nova: {b.campanha.vale ? "vale a pena" : "não agora"}
          </p>
          {b.campanha.vale ? (
            <>
              {b.campanha.publico ? <p>Para quem: {b.campanha.publico}</p> : null}
              {b.campanha.oferta ? <p>Oferta: {b.campanha.oferta}</p> : null}
              {b.campanha.quando ? <p>Quando: {b.campanha.quando}</p> : null}
            </>
          ) : null}
          {b.campanha.porque ? (
            <p className="text-xs text-muted-foreground">{b.campanha.porque}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            A campanha só existe depois do seu Aprovar e Ativar no Marketing.
          </p>
        </div>
      </div>
    </Recolhido>
  );
}

/** O que a Alice não soube (05/11): lista semanal para ensinar a Alice. Só leitura, só o admin. */
function AliceNaoSoube({ r }: { r: DadosNaoSoube & { criadoEm: string } }) {
  return (
    <Recolhido
      titulo={`O que a Alice não soube (${r.total} ${r.total === 1 ? "caso" : "casos"})`}
      icone={<GraduationCap aria-hidden className="size-5" />}
    >
      <div className="flex min-w-0 flex-col gap-3 px-4 pb-4 text-sm">
        <p className="text-xs text-muted-foreground">
          {dateTimeBR(r.criadoEm)} · casos dos últimos 7 dias em que a Alice passou a conversa por
          não saber, ou disse que a equipe confirmaria. Nada foi salvo no roteiro da Alice: cada
          texto só entra depois do seu OK no antes e depois.
        </p>
        {r.resumo ? <p>{r.resumo}</p> : null}
        <ul className="flex min-w-0 flex-col gap-2">
          {r.grupos.map((g, i) => (
            <li
              key={`${g.assunto}-${i}`}
              className="flex min-w-0 flex-col gap-2 rounded-botao border border-border p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">
                  {g.assunto}{" "}
                  <span className="font-normal text-muted-foreground">({g.casos.length})</span>
                </p>
                {g.onde ? <Chip tom="neutro">{g.onde}</Chip> : null}
              </div>
              <ul className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
                {g.casos.slice(0, 3).map((c, j) => (
                  <li key={j} className="min-w-0 break-words">
                    <span className="font-medium text-foreground">
                      final {c.fim || "?"} · {c.dia}:
                    </span>{" "}
                    {c.pergunta || "-"}
                    {c.equipe ? <> → equipe: {c.equipe}</> : null}
                  </li>
                ))}
                {g.casos.length > 3 ? <li>e mais {g.casos.length - 3}</li> : null}
              </ul>
              {g.depois ? (
                <div className="flex min-w-0 flex-col gap-1">
                  {g.antes ? (
                    <>
                      <p className="text-xs font-semibold">Antes</p>
                      <p className="min-w-0 whitespace-pre-wrap break-words rounded-botao bg-muted p-2 text-xs">
                        {g.antes}
                      </p>
                    </>
                  ) : null}
                  <p className="text-xs font-semibold">{g.antes ? "Depois" : "Texto novo"}</p>
                  <p className="min-w-0 whitespace-pre-wrap break-words rounded-botao bg-marca-claro p-2 text-xs">
                    {g.depois}
                  </p>
                </div>
              ) : null}
              {g.pergunta_ao_dono ? (
                <p className="text-xs">
                  <span className="font-semibold">Falta decidir:</span> {g.pergunta_ao_dono}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </Recolhido>
  );
}
