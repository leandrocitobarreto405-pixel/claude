// Configurações › Agenda › Agenda dos técnicos no WhatsApp. O envio nasce desligado e "Ativar" só
// libera com o modelo agenda_tecnico_dia aprovado no número da própria empresa.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Botao, Chip, LinhaSwitch, Switch, type TomChip } from "@/components/nexa";
import {
  CHAVE_AGENDA_TECNICOS,
  agendaTecnicosFn,
  cadastrarModeloAgendaFn,
  enviarAgendaTesteFn,
  recebeAgendaFn,
  salvarAgendaTecnicosFn,
  type EnvioTela,
} from "@/lib/agenda-tecnicos.functions";
import type { SituacaoModeloAgenda } from "@/lib/agenda-tecnicos";
import { dateBR } from "@/lib/format";

const TOM_MODELO: Record<SituacaoModeloAgenda, TomChip> = {
  sem_conexao: "problema",
  nao_cadastrado: "neutro",
  pendente: "atencao",
  aprovado: "sucesso",
  rejeitado: "problema",
  marketing: "problema",
  pausado: "problema",
};

const SITUACAO_ENVIO: Record<string, string> = {
  enviando: "enviando",
  aguardando: "modelo enviado, esperando o técnico tocar em “Ver agenda”",
  enviado: "agenda entregue",
  erro: "erro",
  sem_telefone: "sem telefone",
};

function resumoEnvio(e: EnvioTela) {
  const base = `${e.teste ? "Teste" : "Agenda"} de ${dateBR(e.dia)} (${e.servicos} atend.): ${
    SITUACAO_ENVIO[e.situacao] ?? e.situacao
  }`;
  return e.motivo ? `${base} — ${e.motivo}` : base;
}

function erroDe(e: unknown) {
  return e instanceof Error ? e.message : "Não foi possível concluir.";
}

export function AgendaTecnicos() {
  const queryClient = useQueryClient();
  const lerFn = useServerFn(agendaTecnicosFn);
  const salvarFn = useServerFn(salvarAgendaTecnicosFn);
  const recebeFn = useServerFn(recebeAgendaFn);
  const cadastrarFn = useServerFn(cadastrarModeloAgendaFn);
  const testeFn = useServerFn(enviarAgendaTesteFn);
  const q = useQuery({ queryKey: CHAVE_AGENDA_TECNICOS, queryFn: () => lerFn() });
  const [ocupado, setOcupado] = useState(false);
  const [tecnicoTeste, setTecnicoTeste] = useState("");
  const [contatoTeste, setContatoTeste] = useState("");
  const [diaTeste, setDiaTeste] = useState("");

  const recarregar = () => queryClient.invalidateQueries({ queryKey: CHAVE_AGENDA_TECNICOS });
  async function fazer(acao: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await acao();
      toast.success(ok);
      await recarregar();
    } catch (e) {
      toast.error(erroDe(e));
    } finally {
      setOcupado(false);
    }
  }

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (q.error || !q.data) return <p className="text-sm text-muted-foreground">{erroDe(q.error)}</p>;
  const d = q.data;

  if (d.modelo.situacao === "sem_conexao")
    return (
      <p role="status" className="rounded-md bg-atencao px-4 py-3 text-sm text-atencao-foreground">
        Conecte o WhatsApp da empresa para usar a agenda
      </p>
    );

  const daEquipe = d.tecnicos.filter((t) => !t.parceiro && t.ativo);
  const testeDia = diaTeste || d.amanha;

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-muted-foreground">
        Na véspera, cada técnico recebe no WhatsApp a “Mensagem de amanhã” só com os serviços dele
        (sem OS de teste nem cancelada). Fora das 24 h, vai um aviso curto com o botão “Ver agenda”
        e a agenda sai quando ele toca ou responde. Não usa IA. As mensagens saem pelo WhatsApp da
        empresa e o custo da Meta fica com a conta dela.
      </p>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold">Modelo agenda_tecnico_dia</span>
          <Chip tom={TOM_MODELO[d.modelo.situacao]}>{d.modelo.texto}</Chip>
        </div>
        {d.modelo.motivo ? (
          <p className="text-sm text-muted-foreground">Motivo da Meta: {d.modelo.motivo}</p>
        ) : null}
        {d.modelo.erro ? <p className="text-sm text-muted-foreground">{d.modelo.erro}</p> : null}
        <div className="flex flex-wrap gap-2">
          {d.modelo.situacao === "nao_cadastrado" ? (
            <Botao
              disabled={ocupado}
              onClick={() => void fazer(() => cadastrarFn(), "Modelo enviado para a Meta aprovar.")}
            >
              Cadastrar modelo na Meta
            </Botao>
          ) : null}
          <Botao variante="neutro" disabled={ocupado} onClick={() => void recarregar()}>
            Atualizar situação
          </Botao>
        </div>
      </div>

      <LinhaSwitch
        id="agenda-tecnicos-ativo"
        titulo="Ativar envio automático"
        descricao={
          d.podeAtivar || d.ativo
            ? `Todo dia às ${d.hora} (horário de São Paulo), para os técnicos marcados abaixo.`
            : "Libera quando o modelo estiver aprovado no WhatsApp da empresa."
        }
        checked={d.ativo}
        disabled={ocupado || (!d.ativo && !d.podeAtivar)}
        onCheckedChange={(v) =>
          void fazer(
            () => salvarFn({ data: { ativo: v, hora: d.hora } }),
            v ? "Agenda dos técnicos ligada." : "Agenda dos técnicos desligada.",
          )
        }
      />

      <div className="flex flex-col gap-1">
        <Label htmlFor="agenda-tecnicos-hora">Horário do envio</Label>
        <Input
          id="agenda-tecnicos-hora"
          type="time"
          className="min-h-11 w-36"
          defaultValue={d.hora}
          disabled={ocupado}
          onBlur={(e) => {
            const hora = e.target.value;
            if (hora && hora !== d.hora)
              void fazer(() => salvarFn({ data: { ativo: d.ativo, hora } }), "Horário salvo.");
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold">Técnicos</p>
        <ul className="flex flex-col divide-y divide-border rounded-card border border-border">
          {d.tecnicos
            .filter((t) => t.ativo)
            .map((t) => (
              <li key={t.id} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex min-h-11 items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold">{t.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t.parceiro
                        ? "Parceiro terceirizado: fora da agenda"
                        : t.telefone
                          ? `WhatsApp final ${t.telefone.slice(-4)} · amanhã: ${t.servicosAmanha} atend.`
                          : "Sem telefone — não vai receber a agenda (preencha em Empresa › Equipe)"}
                    </span>
                  </span>
                  {t.parceiro ? null : (
                    <Switch
                      aria-label={`${t.nome} recebe a agenda`}
                      checked={t.recebe}
                      disabled={ocupado}
                      onCheckedChange={(v) =>
                        void fazer(
                          () => recebeFn({ data: { tecnicoId: t.id, recebe: v } }),
                          v ? `${t.nome} recebe a agenda.` : `${t.nome} não recebe a agenda.`,
                        )
                      }
                    />
                  )}
                </div>
                {t.ultimo ? (
                  <span className="text-xs text-muted-foreground">{resumoEnvio(t.ultimo)}</span>
                ) : null}
              </li>
            ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3 rounded-card border border-dashed border-border p-4">
        <p className="text-sm font-bold">Enviar agenda de teste</p>
        <p className="text-sm text-muted-foreground">
          Manda a agenda de um técnico só para um contato interno da equipe (nunca para cliente).
          Funciona com o envio automático desligado.
        </p>
        {d.contatosInternos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Marque um contato interno em Agenda e promoção › Contatos internos.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <Label htmlFor="teste-tecnico">Agenda de</Label>
              <select
                id="teste-tecnico"
                className="min-h-11 rounded-botao border border-input bg-card px-3 text-sm"
                value={tecnicoTeste}
                onChange={(e) => setTecnicoTeste(e.target.value)}
              >
                <option value="">Escolha o técnico</option>
                {daEquipe.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nome}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="teste-contato">Enviar para</Label>
              <select
                id="teste-contato"
                className="min-h-11 rounded-botao border border-input bg-card px-3 text-sm"
                value={contatoTeste}
                onChange={(e) => setContatoTeste(e.target.value)}
              >
                <option value="">Escolha o contato interno</option>
                {d.contatosInternos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {(c.nome ?? "Contato interno") + ` · final ${c.final}`}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="teste-dia">Dia dos serviços</Label>
              <Input
                id="teste-dia"
                type="date"
                className="min-h-11 w-44"
                value={testeDia}
                onChange={(e) => setDiaTeste(e.target.value)}
              />
            </div>
            <Botao
              variante="contorno"
              disabled={ocupado || !tecnicoTeste || !contatoTeste}
              onClick={() =>
                void fazer(
                  () =>
                    testeFn({
                      data: { tecnicoId: tecnicoTeste, contatoId: contatoTeste, dia: testeDia },
                    }),
                  "Agenda de teste enviada.",
                )
              }
            >
              Enviar agenda de teste
            </Botao>
          </>
        )}
      </div>
    </div>
  );
}
