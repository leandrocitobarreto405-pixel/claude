// Aba Follow-ups › topo: "Recado da Tatiana" (frase do dia, resumo e acertos no app) e "Tarefas
// de hoje" em ordem de prioridade. A pessoa vê as dela; o admin vê todas, com filtro por pessoa e
// o que a Alice faria. Copiar e Abrir conversa não enviam nada: a pessoa decide e manda.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Check, Copy, MessageCircle, SkipForward } from "lucide-react";
import { toast } from "sonner";
import { Botao, Card, Chip, Recolhido } from "@/components/nexa";
import {
  concluirTarefaFn,
  hojeTatianaFn,
  pularTarefaFn,
  resolverAcertoFn,
  type Acerto,
  type HojeTatiana,
  type TarefaHoje,
} from "@/lib/tatiana.functions";
import { NOME_GERENTE } from "@/lib/comercial/tatiana";
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
        {d.modo === "teste" ? (
          <p className="text-xs text-muted-foreground">
            Em teste: as tarefas são sugestões da {NOME_GERENTE}; você decide o que fazer.
          </p>
        ) : null}
        {acertos.length ? <AcertosNoApp acertos={acertos} admin={d.admin} /> : null}
      </Card>

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

      <section className="flex min-w-0 flex-col gap-2">
        <h2 className="font-titulo text-lg font-bold">
          Tarefas de hoje <span className="text-muted-foreground">({tarefas.length})</span>
        </h2>
        {tarefas.length ? (
          tarefas.map((t, i) => <CartaoTarefa key={t.id} t={t} ordem={i + 1} admin={d.admin} />)
        ) : (
          <Card className="text-sm text-muted-foreground">
            Nenhuma tarefa da {NOME_GERENTE} para hoje.
          </Card>
        )}
      </section>

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

function CartaoTarefa({ t, ordem, admin }: { t: TarefaHoje; ordem: number; admin: boolean }) {
  const qc = useQueryClient();
  const feito = useServerFn(concluirTarefaFn);
  const pular = useServerFn(pularTarefaFn);
  const [pulando, setPulando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [salvando, setSalvando] = useState(false);
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
          {t.prioridade === 1 ? <Chip tom="problema">Prioridade</Chip> : null}
          <Chip tom="neutro">{hora(t.quando)}</Chip>
        </span>
      </div>
      {admin && t.responsavelNome ? (
        <p className="text-xs text-muted-foreground">Para {t.responsavelNome.split(" ")[0]}</p>
      ) : null}
      {t.motivo ? (
        <p className="text-sm">
          <span className="font-semibold">Por quê: </span>
          {t.motivo}
        </p>
      ) : null}
      {t.mensagem ? (
        <p className="whitespace-pre-wrap rounded-botao bg-background p-3 text-sm">{t.mensagem}</p>
      ) : null}
      {!t.dentroDaJanela && t.conversaId ? (
        <p className="text-xs text-atencao-foreground">
          Fora da janela de 24 h do WhatsApp: copie a mensagem ou use um modelo aprovado.
        </p>
      ) : null}
      {pulando ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={`pular-${t.id}`} className="text-xs font-semibold">
            Motivo (opcional)
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

function ItemAcerto({ a, admin }: { a: Acerto; admin: boolean }) {
  const qc = useQueryClient();
  const resolver = useServerFn(resolverAcertoFn);
  const [motivoAberto, setMotivoAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const link = linkDoAcerto(a);
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
      ) : (
        <div className="flex flex-wrap gap-2">
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
