import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarPlus, Check, MessageCircle, Pause, Play, Settings } from "lucide-react";
import { Botao, CabecalhoDeTela, Card, Chip, type TomChip } from "@/components/nexa";
import { CHAVE_HORARIOS_LIVRES } from "@/components/agenda/faixa-horarios-livres";
import { pausarFn } from "@/lib/marketing.functions";
import { ativarPromocaoFn, situacaoPromocaoFn } from "@/lib/promocao.functions";
import { pct } from "@/lib/promocao";
import { addDaysISO, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHAVE = ["promocao", "situacao"] as const;

export const Route = createFileRoute("/_authenticated/promocao")({
  head: () => ({ meta: [{ title: "Promoção — Nexa OS" }] }),
  component: Promocao,
});

const SITUACAO: Record<string, { rotulo: string; tom: TomChip }> = {
  aprovada: { rotulo: "Na fila", tom: "atencao" },
  enviando: { rotulo: "Enviando", tom: "sucesso" },
  pausada: { rotulo: "Desligada", tom: "neutro" },
  concluida: { rotulo: "Concluída", tom: "sucesso" },
};

function dia(data: string) {
  if (data === addDaysISO(todayISO(), 1)) return "amanhã";
  return new Date(`${data}T12:00:00`).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  });
}

function Promocao() {
  const qc = useQueryClient();
  const lerFn = useServerFn(situacaoPromocaoFn);
  const ativarFn = useServerFn(ativarPromocaoFn);
  const pausar = useServerFn(pausarFn);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => lerFn(), refetchInterval: 60_000 });
  const s = q.data;
  const [fora, setFora] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => setFora(new Set()), [s?.destinatarios.length]);

  const escolhidos = useMemo(
    () => (s?.destinatarios ?? []).filter((d) => !fora.has(d.chave)),
    [s, fora],
  );

  async function recarregar() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: CHAVE }),
      qc.invalidateQueries({ queryKey: CHAVE_HORARIOS_LIVRES }),
    ]);
  }

  async function ativar() {
    if (!s) return;
    const n = escolhidos.length;
    const aviso = s.envioLigado
      ? `Enviar a promoção para ${n} ${n === 1 ? "pessoa" : "pessoas"}? Os envios começam em seguida (a partir das 9h).`
      : `Criar a promoção para ${n} ${n === 1 ? "pessoa" : "pessoas"}? O "Envio ligado" do Marketing está desligado: nada sai até ligar.`;
    if (!window.confirm(aviso)) return;
    setOcupado(true);
    try {
      const r = await ativarFn({ data: { chaves: escolhidos.map((d) => d.chave) } });
      toast.success(
        r.ignorados
          ? `Promoção ativada para ${r.envios}. ${r.ignorados} ficaram de fora (saíram das ofertas ou sem nome).`
          : `Promoção ativada para ${r.envios} ${r.envios === 1 ? "pessoa" : "pessoas"}.`,
      );
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ativar.");
    } finally {
      setOcupado(false);
    }
  }

  async function desligar(retomar: boolean) {
    if (!s?.promocaoDeHoje) return;
    if (!retomar && !window.confirm("Desligar a promoção? Os envios que faltam param.")) return;
    setOcupado(true);
    try {
      await pausar({ data: { campanhaId: s.promocaoDeHoje.id, retomar } });
      toast.success(retomar ? "Promoção religada." : "Promoção desligada.");
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível mudar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        voltarPara="/inicio"
        titulo="Promoção"
        descricao="Para preencher os horários vagos da agenda."
        acao={
          s?.admin ? (
            <Botao asChild variante="neutro" tamanho="icone" aria-label="Configurar">
              <Link to="/agenda-config">
                <Settings />
              </Link>
            </Botao>
          ) : null
        }
      />

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : q.error || !s ? (
        <Card className="text-center text-sm">
          {q.error instanceof Error ? q.error.message : "Erro ao carregar."}
        </Card>
      ) : (
        <>
          <Card>
            <h2 className="flex items-center gap-2 text-[15px] font-bold">
              <CalendarPlus className="size-5 text-marca" aria-hidden />
              Horários livres {dia(s.horarios.data)}
            </h2>
            {!s.horarios.configurado ? (
              <p className="text-sm text-muted-foreground">
                Cadastre os horários base dos técnicos em Agenda e promoção.
              </p>
            ) : s.horarios.livres.length === 0 ? (
              <p className="text-sm text-muted-foreground">Agenda cheia. Nenhum horário vago.</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {s.horarios.livres.map((l) => (
                  <li
                    key={`${l.tecnicoId}-${l.hora}`}
                    className="rounded-full bg-marca-claro px-3 py-2 text-sm font-semibold text-marca"
                  >
                    {l.hora} · {l.tecnico}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {s.promocaoDeHoje ? (
            <Card>
              <div className="flex items-center gap-2">
                <h2 className="flex-1 text-[15px] font-bold">Promoção de hoje</h2>
                <Chip tom={SITUACAO[s.promocaoDeHoje.status]?.tom ?? "neutro"}>
                  {SITUACAO[s.promocaoDeHoje.status]?.rotulo ?? s.promocaoDeHoje.status}
                </Chip>
              </div>
              <p className="text-sm">
                {s.promocaoDeHoje.enviados} enviadas · {s.promocaoDeHoje.pendentes} na fila
                {s.promocaoDeHoje.erros ? ` · ${s.promocaoDeHoje.erros} com erro` : ""}
                {s.promocaoDeHoje.cancelados ? ` · ${s.promocaoDeHoje.cancelados} canceladas` : ""}
              </p>
              {s.admin && s.promocaoDeHoje.status === "pausada" ? (
                <Botao
                  variante="contorno"
                  className="self-start"
                  disabled={ocupado}
                  onClick={() => void desligar(true)}
                >
                  <Play /> Religar
                </Botao>
              ) : s.admin && ["aprovada", "enviando"].includes(s.promocaoDeHoje.status) ? (
                <Botao
                  variante="contorno"
                  className="self-start"
                  disabled={ocupado}
                  onClick={() => void desligar(false)}
                >
                  <Pause /> Desligar
                </Botao>
              ) : null}
            </Card>
          ) : null}

          {!s.envioLigado ? (
            <p className="rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground">
              O "Envio ligado" do Marketing está desligado. A promoção pode ser ativada, mas nada é
              enviado até ligar.
            </p>
          ) : null}

          <Card>
            <h2 className="flex items-center gap-2 text-[15px] font-bold">
              <MessageCircle className="size-5 text-marca" aria-hidden />
              {pct(s.config.descontoPct)} de desconto + {pct(s.config.pixPct)} no Pix
            </h2>
            <p className="rounded-card bg-marca-claro p-3 text-sm leading-relaxed">{s.previa}</p>
            <p className="text-xs text-muted-foreground">
              Modelo {s.config.template}, com os botões "Quero reservar" e "Não quero mais ofertas".
              Quem escreveu nas últimas 24 h recebe o mesmo texto como mensagem comum.
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-[15px] font-bold">Quem vai receber</h2>
              <Chip tom="neutro">
                {escolhidos.length} de {s.destinatarios.length}
              </Chip>
            </div>
            <p className="text-sm text-muted-foreground">
              Orçamentos em aberto dos últimos {s.config.orcamentoDias} dias sem agendamento
              {s.config.conversasNovas ? " e conversas novas de hoje" : ""}. Toque para tirar ou
              devolver alguém. Contatos internos e quem saiu das ofertas já estão fora.
            </p>
            {s.destinatarios.length === 0 ? (
              <p className="text-sm">Ninguém para receber agora.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {s.destinatarios.map((d) => {
                  const dentro = !fora.has(d.chave);
                  return (
                    <li key={d.chave}>
                      <button
                        type="button"
                        aria-pressed={dentro}
                        onClick={() => {
                          const n = new Set(fora);
                          if (dentro) n.add(d.chave);
                          else n.delete(d.chave);
                          setFora(n);
                        }}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 rounded-botao border px-3 text-left",
                          dentro ? "border-marca bg-card" : "border-border bg-muted opacity-70",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "grid size-6 shrink-0 place-items-center rounded-md border",
                            dentro
                              ? "border-marca bg-marca text-marca-foreground"
                              : "border-border bg-card",
                          )}
                        >
                          {dentro ? <Check className="size-4" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{d.nome}</span>
                          <span className="block text-xs text-muted-foreground">
                            {d.origem === "orcamento" ? "Orçamento" : "Conversa nova"} ·{" "}
                            {new Date(d.desde).toLocaleDateString("pt-BR")}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {s.admin ? (
            <div>
              <Botao
                tamanho="grande"
                larguraTotal
                disabled={
                  ocupado ||
                  escolhidos.length === 0 ||
                  Boolean(s.promocaoDeHoje && s.promocaoDeHoje.pendentes > 0)
                }
                onClick={() => void ativar()}
              >
                {ocupado
                  ? "Ativando…"
                  : `Ativar para ${escolhidos.length} ${escolhidos.length === 1 ? "pessoa" : "pessoas"}`}
              </Botao>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Só o administrador ativa a promoção.</p>
          )}
        </>
      )}
    </div>
  );
}
