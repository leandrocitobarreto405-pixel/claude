import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, Copy, MessageCircle, Settings, Tag } from "lucide-react";
import { Botao, CabecalhoDeTela, Card, Chip } from "@/components/nexa";
import { CHAVE_VAGAS, vagasAbertasFn } from "@/lib/vagas.functions";
import {
  GRUPOS_DA_VAGA,
  ROTULO_GRUPO,
  horaFalada,
  mensagemDaVaga,
  rotuloDoDia,
  tituloDaVaga,
  type CandidatoDaVaga,
  type Vaga,
} from "@/lib/vagas";

export const Route = createFileRoute("/_authenticated/vagas")({
  head: () => ({ meta: [{ title: "Vagas abertas — Nexa OS" }] }),
  component: VagasAbertas,
});

const chaveDaVaga = (v: Vaga) => `${v.data} ${v.hora} ${v.tecnicoId}`;

/**
 * Alarme de vaga na agenda: cada vaga aberta (hoje e os dois próximos dias de atendimento) com a
 * lista de quem chamar, na ordem, e a mensagem pronta para copiar. Nada é enviado sozinho.
 */
function VagasAbertas() {
  const ler = useServerFn(vagasAbertasFn);
  const q = useQuery({ queryKey: CHAVE_VAGAS, queryFn: () => ler(), refetchInterval: 120_000 });
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const d = q.data;
  const vaga = useMemo(
    () => d?.vagas.find((v) => chaveDaVaga(v) === escolhida) ?? d?.vagas[0] ?? null,
    [d, escolhida],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        sobretitulo="Agenda"
        titulo="Vagas abertas"
        descricao="Horário livre de técnico hoje e nos dois próximos dias de atendimento. Chame na ordem da lista; a vaga some daqui quando for preenchida."
      />
      {q.isLoading ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {q.error ? (
        <p className="text-sm text-problema-foreground">
          {q.error instanceof Error ? q.error.message : "Não foi possível carregar."}
        </p>
      ) : null}
      {d && !d.configurado ? (
        <Card className="gap-2 text-sm">
          <p className="font-semibold">O alarme de vaga ainda não está ligado nesta empresa.</p>
          <p className="text-muted-foreground">
            Ele liga sozinho quando os dias e horários de atendimento de cada técnico estão
            preenchidos em Configurações › Agenda (Horários base).
          </p>
          <Link to={"/agenda-config" as never} className="inline-flex items-center gap-1 underline">
            <Settings className="size-4" aria-hidden /> Preencher os horários dos técnicos
          </Link>
        </Card>
      ) : null}
      {d?.configurado && !d.vagas.length ? (
        <Card className="gap-1 text-sm">
          <p className="font-semibold">Nenhuma vaga aberta. Agenda cheia nos próximos dias. 👏</p>
        </Card>
      ) : null}

      {d?.vagas.length ? (
        <>
          <Card className="gap-3">
            <p className="text-sm font-bold">Qual vaga você vai preencher?</p>
            <div className="flex flex-wrap gap-2">
              {d.vagas.map((v) => {
                const k = chaveDaVaga(v);
                const ativa = vaga ? chaveDaVaga(vaga) === k : false;
                return (
                  <Botao
                    key={k}
                    variante={ativa ? "primario" : "contorno"}
                    aria-pressed={ativa}
                    onClick={() => setEscolhida(k)}
                  >
                    <CalendarClock /> {rotuloDoDia(v.data, d.hoje)} às {horaFalada(v.hora)}
                    {d.vagas.some((o) => o !== v && o.data === v.data && o.hora === v.hora)
                      ? ` · ${v.tecnico}`
                      : ""}
                  </Botao>
                );
              })}
            </div>
            {vaga ? (
              <div className="flex flex-wrap items-center gap-2">
                <Chip tom="problema">P1</Chip>
                <span className="text-[15px] font-bold">{tituloDaVaga(vaga, d.hoje)}</span>
                <span className="text-sm text-muted-foreground">· técnico {vaga.tecnico}</span>
              </div>
            ) : null}
          </Card>

          {vaga && !d.candidatos.length ? (
            <Card className="gap-2 text-sm">
              <p>
                Não achei ninguém nas listas de sempre (remarcar, negociação, serviço adiante,
                orçamento recente).
              </p>
              <Link to={"/promocao" as never} className="inline-flex items-center gap-1 underline">
                <Tag className="size-4" aria-hidden /> Ver a promoção da agenda
              </Link>
            </Card>
          ) : null}

          {vaga
            ? GRUPOS_DA_VAGA.map((g, i) => {
                const lista = d.candidatos.filter((c) => c.grupo === g);
                if (!lista.length) return null;
                return (
                  <Card key={g} className="gap-3">
                    <p className="text-sm font-bold">
                      {String.fromCharCode(97 + i)}) {ROTULO_GRUPO[g]}{" "}
                      <span className="font-normal text-muted-foreground">({lista.length})</span>
                    </p>
                    <ul className="flex flex-col gap-3">
                      {lista.map((c) => (
                        <Candidato key={c.chave} c={c} vaga={vaga} hoje={d.hoje} />
                      ))}
                    </ul>
                  </Card>
                );
              })
            : null}

          {vaga && d.candidatos.length ? (
            <p className="text-sm text-muted-foreground">
              Ninguém respondeu?{" "}
              <Link to={"/promocao" as never} className="underline">
                A promoção da agenda
              </Link>{" "}
              continua disponível (com o Aprovar de sempre).
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Candidato({ c, vaga, hoje }: { c: CandidatoDaVaga; vaga: Vaga; hoje: string }) {
  const mensagem = mensagemDaVaga({
    nome: c.nome,
    grupo: c.grupo,
    vaga,
    hoje,
    estofado: c.estofado,
  });
  async function copiar() {
    try {
      await navigator.clipboard.writeText(mensagem);
      toast.success("Mensagem copiada.");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie.");
    }
  }
  return (
    <li className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold">{c.nome || "Sem nome"}</span>
        <span className="text-sm text-muted-foreground">{c.detalhe}</span>
      </div>
      <p className="rounded-md bg-secondary px-3 py-2 text-sm">{mensagem}</p>
      <div className="flex flex-wrap gap-2">
        <Botao variante="contorno" onClick={() => void copiar()}>
          <Copy /> Copiar mensagem
        </Botao>
        {c.conversaId ? (
          <Botao asChild variante="neutro">
            <Link to="/conversas/$conversaId" params={{ conversaId: c.conversaId }}>
              <MessageCircle /> Abrir conversa
            </Link>
          </Botao>
        ) : c.leadId ? (
          <Botao asChild variante="neutro">
            <Link to="/crm/lead/$leadId" params={{ leadId: c.leadId }}>
              Abrir o lead
            </Link>
          </Botao>
        ) : null}
      </div>
    </li>
  );
}
