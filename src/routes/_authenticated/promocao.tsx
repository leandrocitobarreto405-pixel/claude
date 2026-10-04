import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarPlus, Check, MessageCircle, Pause, Play, Settings } from "lucide-react";
import { Botao, CabecalhoDeTela, Card, Chip, type TomChip } from "@/components/nexa";
import { EscolherListasPromocao } from "@/components/promocao/listas-promocao";
import { salvarPromocaoRapidaFn } from "@/lib/agenda-config.functions";
import { pausarFn } from "@/lib/marketing.functions";
import { ativarPromocaoFn, situacaoPromocaoFn } from "@/lib/promocao.functions";
import {
  CHAVE_RESUMO_PROMOCAO,
  CHAVE_SITUACAO_PROMOCAO as CHAVE,
  pct,
  type DestinatarioPromocao,
} from "@/lib/promocao";
import { descreverFiltros, type Filtros } from "@/lib/listas";
import { addDaysISO, brl, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";

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

const km = (n: number) => `${String(n).replace(".", ",")} km`;
const dias = (n: number) => (n === 0 ? "hoje" : n === 1 ? "há 1 dia" : `há ${n} dias`);

/** Linhas de detalhe de cada pessoa: de onde veio, valores, distância e margem. */
function detalhes(d: DestinatarioPromocao): string[] {
  const linhas: string[] = [];
  const origem: string[] = [];
  if (d.diasOrcamento !== null && d.familias.includes("orcamento"))
    origem.push(`orçamento ${dias(d.diasOrcamento)}`);
  if (d.diasConversa !== null && d.familias.includes("conversa"))
    origem.push(`conversa ${dias(d.diasConversa)}`);
  if (d.familias.includes("clientes")) origem.push("cliente");
  if (d.familias.includes("perdido_preco")) origem.push("perdido por preço");
  if (origem.length) linhas.push(origem.join(" · "));
  if (d.valor !== null && d.valorPromo !== null && d.valorPix !== null)
    linhas.push(
      `${brl(d.valor)} → ${brl(d.valorPromo)} com a promoção · ${brl(d.valorPix)} no Pix`,
    );
  if (d.km !== null) {
    const dist = d.kmAproximado ? `~${km(d.km)} (aproximado)` : km(d.km);
    const quem = d.tecnico ? ` do ${d.tecnico}` : "";
    const horario = d.hora ? ` · horário das ${d.hora}` : "";
    linhas.push(
      d.partida === "orcamento"
        ? `${dist} da base (pelo orçamento)`
        : d.partida === "servico"
          ? `${dist} do serviço anterior${quem}${horario}`
          : `${dist} da base${quem}${horario}`,
    );
  }
  if (d.margem)
    linhas.push(
      `Margem estimada ${brl(d.margem.valor)} (imposto ${brl(d.margem.imposto)}${
        d.margem.deslocamento !== null ? ` · deslocamento ${brl(d.margem.deslocamento)}` : ""
      } · produto ${brl(d.margem.produto)})`,
    );
  return linhas;
}

function Promocao() {
  const qc = useQueryClient();
  const lerFn = useServerFn(situacaoPromocaoFn);
  const ativarFn = useServerFn(ativarPromocaoFn);
  const pausar = useServerFn(pausarFn);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => lerFn(), refetchInterval: 60_000 });
  const s = q.data;
  const salvarFn = useServerFn(salvarPromocaoRapidaFn);
  /** Quem o usuário mudou à mão (marcou ou desmarcou), por cima da marcação inicial. */
  const [trocados, setTrocados] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState(false);
  const [listasAbertas, setListasAbertas] = useState(false);
  const assinatura = (s?.destinatarios ?? []).map((d) => d.chave).join(",");
  useEffect(() => setTrocados(new Set()), [assinatura]);

  const dentro = (d: DestinatarioPromocao) => d.podeEnviar && d.marcado !== trocados.has(d.chave);
  const escolhidos = useMemo(
    () =>
      (s?.destinatarios ?? []).filter((d) => d.podeEnviar && d.marcado !== trocados.has(d.chave)),
    [s, trocados],
  );

  async function recarregar() {
    await Promise.all([
      qc.invalidateQueries({ queryKey: CHAVE }),
      qc.invalidateQueries({ queryKey: CHAVE_RESUMO_PROMOCAO }),
    ]);
  }

  async function salvarListas(listas: Filtros) {
    try {
      await salvarFn({ data: { listas } });
      toast.success("Listas da promoção salvas.");
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
      throw e;
    }
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
              Quem escreveu nas últimas 24 h recebe uma mensagem comum, com o texto da tela Modelos
              de mensagem (sem aprovação).
            </p>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-[15px] font-bold">Quem vai receber</h2>
              <Chip tom="neutro">
                {escolhidos.length} de {s.destinatarios.length}
              </Chip>
            </div>
            <div className="flex items-start gap-3">
              <p className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold">
                  {descreverFiltros(s.config.promoListas)}
                </span>
                <span className="block text-muted-foreground">
                  {s.totalNaLista} na lista, {s.destinatarios.length}{" "}
                  {s.destinatarios.length === 1 ? "pode" : "podem"} receber agora
                </span>
              </p>
              {s.admin ? (
                <Botao variante="contorno" onClick={() => setListasAbertas(true)}>
                  Mudar
                </Botao>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">
              Confira e toque para tirar ou devolver alguém. Quem passa da distância máxima ou fica
              abaixo da margem mínima começa desmarcado, com o motivo. Opt-out, contatos internos,
              clientes sem pós-venda, quem tem serviço marcado e quem recebeu marketing nos últimos{" "}
              {s.limiteMarketingDias} dias já estão fora.
            </p>
            {!s.custoKmConfigurado ? (
              <p className="rounded-botao bg-atencao px-3 py-2 text-xs text-atencao-foreground">
                O custo por km não está configurado: a margem usa o padrão dos orçamentos, R$ 0,57
                por km. Configure em Configurações → Meta e custos.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Km pelas ruas, só a ida: do serviço anterior do técnico no dia ou, se não houver, da
              base dele. Se o mapa não responder, linha reta × 1,3 (aproximado). Margem no Pix:
              valor − imposto − deslocamento da ida − produto, sem mão de obra.
            </p>
            {s.destinatarios.length === 0 ? (
              <p className="text-sm">Ninguém para receber agora.</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {s.destinatarios.map((d) => {
                  const marcado = dentro(d);
                  const destaque = !d.marcado && d.podeEnviar;
                  return (
                    <li key={d.chave}>
                      <button
                        type="button"
                        aria-pressed={marcado}
                        disabled={!d.podeEnviar}
                        onClick={() => {
                          const n = new Set(trocados);
                          if (n.has(d.chave)) n.delete(d.chave);
                          else n.add(d.chave);
                          setTrocados(n);
                        }}
                        className={cn(
                          "flex min-h-14 w-full items-start gap-3 rounded-botao border px-3 py-2.5 text-left disabled:cursor-not-allowed",
                          marcado
                            ? "border-marca bg-card"
                            : destaque
                              ? "border-atencao-foreground/40 bg-atencao"
                              : "border-border bg-muted opacity-70",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border",
                            marcado
                              ? "border-marca bg-marca text-marca-foreground"
                              : "border-border bg-card",
                          )}
                        >
                          {marcado ? <Check className="size-4" /> : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate font-semibold">{d.nome || d.telefone}</span>
                            {d.avisos.map((a) => (
                              <Chip key={a} tom="neutro">
                                {a}
                              </Chip>
                            ))}
                          </span>
                          {detalhes(d).map((l) => (
                            <span key={l} className="block text-xs text-muted-foreground">
                              {l}
                            </span>
                          ))}
                          {d.motivo ? (
                            <span className="block text-xs font-semibold text-atencao-foreground">
                              {d.motivo}
                            </span>
                          ) : null}
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
                  !s.config.promoLigada ||
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
          {s.admin && !s.config.promoLigada ? (
            <p className="text-sm text-muted-foreground">
              A promoção está desligada. Ligue a chave “Promoção liberada” no Início ou no Marketing
              para poder ativar.
            </p>
          ) : null}
          <EscolherListasPromocao
            aberto={listasAbertas}
            fechar={() => setListasAbertas(false)}
            listas={s.config.promoListas}
            salvar={salvarListas}
          />
        </>
      )}
    </div>
  );
}
