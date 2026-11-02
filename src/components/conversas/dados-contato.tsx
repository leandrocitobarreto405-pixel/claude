// Dados do contato (toque no nome, na barra da conversa): nome, telefone, nome do perfil (só
// referência), etiquetas, "Recebe marketing" (descadastro), por que a Alice passou para a equipe
// e o lead no CRM.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Botao } from "@/components/nexa";
import { LinhaSwitch } from "@/components/nexa/switch";
import { alterarMarketingFn } from "@/lib/descadastro.functions";
import { ROTULO_ORIGEM_DESCADASTRO, type OrigemDescadastro } from "@/lib/descadastro";
import { Avatar, EtiquetasConversa } from "@/components/conversas/cartao-conversa";
import type { ConversaCompleta } from "@/lib/conversas.functions";
import { STATUS_ORCAMENTO, tituloHistorico, type HistoricoContato } from "@/lib/historico-contato";

export function DadosContato({
  c,
  aberto,
  aoMudar,
}: {
  c: ConversaCompleta;
  aberto: boolean;
  aoMudar: (v: boolean) => void;
}) {
  return (
    <Sheet open={aberto} onOpenChange={aoMudar}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] overflow-y-auto rounded-t-card pb-[max(env(safe-area-inset-bottom),1rem)] lg:mx-auto lg:max-w-lg"
      >
        <SheetHeader className="items-center text-center">
          <Avatar nome={c.nome} className="size-16 text-lg" />
          <SheetTitle className="text-lg">{c.nome}</SheetTitle>
          <SheetDescription>{c.telefone ?? "Sem telefone"}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 grid gap-3">
          {c.nomePerfil ? (
            <p className="text-center text-sm text-muted-foreground">
              Perfil no WhatsApp: {c.nomePerfil}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-1.5">
            <EtiquetasConversa c={c} />
          </div>
          <RecebeMarketing c={c} />
          {c.historico ? <Historico h={c.historico} /> : null}
          {c.passagem?.resumo ? (
            <div className="rounded-botao bg-atencao px-3 py-2.5 text-sm text-atencao-foreground">
              <p className="font-bold">A Alice passou para a equipe: {c.passagem.motivo}</p>
              <p className="mt-0.5">{c.passagem.resumo}</p>
            </div>
          ) : null}
          {c.leadId ? (
            <Botao asChild variante="contorno" larguraTotal>
              <Link to="/crm/lead/$leadId" params={{ leadId: c.leadId }}>
                Ver o lead no CRM
              </Link>
            </Botao>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

const dataHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

/** "Recebe marketing": desligado, o contato fica fora de campanhas, promoções e listas. */
function RecebeMarketing({ c }: { c: ConversaCompleta }) {
  const qc = useQueryClient();
  const alterar = useServerFn(alterarMarketingFn);
  const [ocupado, setOcupado] = useState(false);
  const recebe = !c.marketingSaiuEm;
  const origem = c.marketingOrigem as OrigemDescadastro | null;

  async function mudar(v: boolean) {
    setOcupado(true);
    try {
      await alterar({ data: { conversaId: c.id, recebe: v } });
      toast.success(v ? "Voltou a receber marketing." : "Não recebe mais marketing.");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["conversas", "uma", c.id] }),
        qc.invalidateQueries({ queryKey: ["conversas", "lista"] }),
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível mudar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="rounded-botao border px-3 py-1.5">
      <LinhaSwitch
        id={`marketing-${c.id}`}
        titulo="Recebe marketing"
        descricao={
          recebe
            ? "Campanhas e promoções. Atendimento, confirmação e pós-venda não dependem disto."
            : `Fora desde ${dataHora(c.marketingSaiuEm)}${
                origem && ROTULO_ORIGEM_DESCADASTRO[origem]
                  ? ` (${ROTULO_ORIGEM_DESCADASTRO[origem]})`
                  : ""
              }. Atendimento, confirmação e pós-venda continuam.`
        }
        checked={recebe}
        disabled={ocupado}
        onCheckedChange={(v) => void mudar(v)}
      />
    </div>
  );
}

const dataCurta = (iso: string | null | undefined) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—";
const brl0 = (v: number) =>
  `R$ ${Math.round(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;

/** Histórico completo do contato com a empresa (antes desta conversa). */
function Historico({ h }: { h: HistoricoContato }) {
  return (
    <div className="rounded-botao border px-3 py-2.5 text-sm">
      <p className="font-bold">{tituloHistorico(h)}</p>
      {h.vazio ? (
        <p className="mt-0.5 text-muted-foreground">
          Nenhuma conversa, orçamento, serviço ou campanha anterior com este telefone.
        </p>
      ) : (
        <div className="mt-1.5 grid gap-2">
          {h.primeiroContato ? (
            <p className="text-xs text-muted-foreground">
              Primeiro contato em {dataCurta(h.primeiroContato)}.
            </p>
          ) : null}
          {h.servicos.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Serviços ({h.servicos.length})
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {h.servicos.slice(0, 5).map((s, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {dataCurta(s.data)}
                      {s.servico ? ` · ${s.servico}` : ""}
                      {s.osNumero ? ` · OS ${s.osNumero}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {brl0(s.total)}
                      {s.status ? ` · ${s.status}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {h.orcamentos.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Orçamentos ({h.orcamentos.length})
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {h.orcamentos.slice(0, 5).map((o, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {dataCurta(o.data)}
                      {o.numero ? ` · nº ${o.numero}` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {brl0(o.total)} ·{" "}
                      {o.fechou ? "virou OS" : (STATUS_ORCAMENTO[o.status] ?? o.status)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {h.conversas.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Conversas anteriores ({h.conversas.length})
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {h.conversas.slice(0, 5).map((cv) => (
                  <li key={cv.id} className="flex justify-between gap-2">
                    <Link
                      to="/conversas/$conversaId"
                      params={{ conversaId: cv.id }}
                      className="min-w-0 truncate text-marca underline-offset-2 hover:underline"
                    >
                      {dataCurta(cv.inicio)}
                      {cv.fim ? ` a ${dataCurta(cv.fim)}` : ""}
                    </Link>
                    <span className="shrink-0 text-muted-foreground">{cv.resumo ?? ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {h.campanhas.length ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Campanhas recebidas ({h.campanhas.length})
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {h.campanhas.map((k, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">
                      {dataCurta(k.data)} · {k.nome}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {k.respondeu ? "respondeu" : "sem resposta"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
