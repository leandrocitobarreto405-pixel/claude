import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dateTimeBR } from "@/lib/format";
import {
  ativarPosAtendimento,
  configPosAtendimento,
  salvarPosAtendimento,
  type ChavePos,
  type SituacaoModeloPos,
} from "@/lib/pos-atendimento.functions";

const CHAVE = ["alice_pos_atendimento"];

const SITUACAO: Record<SituacaoModeloPos, { texto: string; classe: string }> = {
  aprovado: { texto: "Modelo aprovado", classe: "bg-success text-success-foreground" },
  pendente: { texto: "Modelo pendente na Meta", classe: "bg-atencao text-atencao-foreground" },
  rejeitado: { texto: "Modelo rejeitado", classe: "bg-problema text-problema-foreground" },
  nao_existe: {
    texto: "Modelo não existe na Meta",
    classe: "bg-problema text-problema-foreground",
  },
  sem_nome: { texto: "Sem modelo", classe: "bg-muted text-muted-foreground" },
  "?": { texto: "Não deu para conferir", classe: "bg-muted text-muted-foreground" },
};

const TIPO: Record<string, string> = {
  confirmacao: "Confirmação",
  pos_venda: "Pós-venda",
  avaliacao: "Avaliação",
};

/** Confirmação na véspera, pós-venda e pedido de avaliação (tudo começa desligado). */
export function AlicePosAtendimento() {
  const qc = useQueryClient();
  const lerFn = useServerFn(configPosAtendimento);
  const salvarFn = useServerFn(salvarPosAtendimento);
  const ativarFn = useServerFn(ativarPosAtendimento);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => lerFn() });
  const [form, setForm] = useState({
    confirmacao_hora: "10:00",
    confirmacao_modelo: "",
    pos_venda_hora: "10:00",
    pos_venda_modelo: "",
    avaliacao_link: "",
    avaliacao_texto: "",
  });
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setForm({
      confirmacao_hora: q.data.confirmacao.hora,
      confirmacao_modelo: q.data.confirmacao.modelo ?? "",
      pos_venda_hora: q.data.pos_venda.hora,
      pos_venda_modelo: q.data.pos_venda.modelo ?? "",
      avaliacao_link: q.data.avaliacao.link ?? "",
      avaliacao_texto: q.data.avaliacao.texto,
    });
  }, [q.data]);

  async function executar(acao: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await acao();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  const d = q.data;
  if (!d) return null;
  const campo = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const alternar = (chave: ChavePos, ligada: boolean) =>
    void executar(
      async () => {
        await salvarFn({ data: form });
        await ativarFn({ data: { chave, ligada } });
      },
      ligada ? "Ativado." : "Desativado: nada mais sai por aqui.",
    );

  return (
    <section className="card-surface grid gap-4 p-5">
      <div>
        <h2 className="text-lg font-semibold">Depois do agendamento</h2>
        <p className="text-sm text-muted-foreground">
          Confirmação na véspera e pós-venda para todas as OS (da Alice e da equipe). Começa tudo
          desligado: nada é enviado antes de tocar em “Ativar”. Cliente com “IA desligada” ou com
          garantia em aberto não recebe nada.
        </p>
        {!d.aliceAtiva ? (
          <p className="mt-2 rounded-md bg-atencao px-3 py-2 text-sm text-atencao-foreground">
            A Alice está desligada na empresa: nada sai mesmo com as opções ativas.
          </p>
        ) : null}
      </div>

      <Bloco
        titulo="Confirmação na véspera"
        descricao="No dia anterior ao serviço (sábado confirma domingo e segunda). Cliente que escreveu nas últimas 24 h recebe texto livre; senão, o modelo."
        ligada={d.confirmacao.ligada}
        situacao={d.confirmacao.situacao}
        ocupado={ocupado}
        onAlternar={(v) => alternar("confirmacao", v)}
      >
        <Campo id="conf-hora" rotulo="Horário">
          <Input
            id="conf-hora"
            type="time"
            value={form.confirmacao_hora}
            onChange={(e) => campo("confirmacao_hora", e.target.value)}
          />
        </Campo>
        <Campo id="conf-modelo" rotulo="Modelo (sem botões)">
          <Input
            id="conf-modelo"
            value={form.confirmacao_modelo}
            onChange={(e) => campo("confirmacao_modelo", e.target.value)}
          />
        </Campo>
      </Bloco>

      <Bloco
        titulo="Pós-venda"
        descricao="No dia seguinte ao serviço concluído, com o link da pasta (fotos e vídeos), o nome do técnico e o estofado. Sem pasta: vai sem o link e a equipe recebe uma nota."
        ligada={d.pos_venda.ligada}
        situacao={d.pos_venda.situacao}
        ocupado={ocupado}
        onAlternar={(v) => alternar("pos_venda", v)}
      >
        <Campo id="pv-hora" rotulo="Horário">
          <Input
            id="pv-hora"
            type="time"
            value={form.pos_venda_hora}
            onChange={(e) => campo("pos_venda_hora", e.target.value)}
          />
        </Campo>
        <Campo id="pv-modelo" rotulo="Modelo (sem botões)">
          <Input
            id="pv-modelo"
            value={form.pos_venda_modelo}
            onChange={(e) => campo("pos_venda_modelo", e.target.value)}
          />
        </Campo>
      </Bloco>

      <Bloco
        titulo="Pedido de avaliação no Google"
        descricao="Só quando a cliente responde bem ao pós-venda, uma vez só, e nunca se a OS teve garantia ou reclamação."
        ligada={d.avaliacao.ligada}
        situacao={null}
        ocupado={ocupado}
        onAlternar={(v) => alternar("avaliacao", v)}
      >
        <Campo id="av-link" rotulo="Link de avaliação" largo>
          <Input
            id="av-link"
            inputMode="url"
            placeholder="https://g.page/r/…/review"
            value={form.avaliacao_link}
            onChange={(e) => campo("avaliacao_link", e.target.value)}
          />
        </Campo>
        <Campo id="av-texto" rotulo="Texto ({nome}, {empresa}, {link})" largo>
          <Textarea
            id="av-texto"
            rows={6}
            value={form.avaliacao_texto}
            onChange={(e) => campo("avaliacao_texto", e.target.value)}
          />
        </Campo>
      </Bloco>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="min-h-11"
          disabled={ocupado}
          onClick={() => void executar(() => salvarFn({ data: form }), "Salvo.")}
        >
          Salvar horários e textos
        </Button>
      </div>
      {d.erroModelos ? (
        <p className="text-xs text-muted-foreground">
          Situação dos modelos não conferida: {d.erroModelos}
        </p>
      ) : null}

      <div>
        <h3 className="text-sm font-semibold">Últimos envios</h3>
        {!d.recentes.length ? (
          <p className="text-sm text-muted-foreground">Nada enviado ainda.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {d.recentes.map((r, i) => (
              <li key={i} className="rounded-md border border-border p-2 text-xs">
                <span className="font-medium">
                  {TIPO[r.tipo] ?? r.tipo} · OS {r.os}
                </span>{" "}
                · {dateTimeBR(r.quando)} · {r.situacao}
                {r.via ? ` (${r.via})` : ""}
                {r.resposta ? ` · resposta: ${r.resposta}` : ""}
                {r.motivo ? <span className="block text-muted-foreground">{r.motivo}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Bloco(props: {
  titulo: string;
  descricao: string;
  ligada: boolean;
  situacao: SituacaoModeloPos | null;
  ocupado: boolean;
  onAlternar: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{props.titulo}</p>
          <p className="text-xs text-muted-foreground">{props.descricao}</p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            props.ligada ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {props.ligada ? "Ativo" : "Desligado"}
        </span>
      </div>
      {props.situacao ? (
        <span
          className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${SITUACAO[props.situacao].classe}`}
        >
          {SITUACAO[props.situacao].texto}
        </span>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">{props.children}</div>
      <Button
        className="min-h-11 w-fit"
        variant={props.ligada ? "outline" : "default"}
        disabled={props.ocupado}
        onClick={() => props.onAlternar(!props.ligada)}
      >
        {props.ligada ? "Desativar" : "Ativar"}
      </Button>
    </div>
  );
}

function Campo(props: { id: string; rotulo: string; largo?: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid gap-1 ${props.largo ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={props.id} className="text-xs">
        {props.rotulo}
      </Label>
      {props.children}
    </div>
  );
}
