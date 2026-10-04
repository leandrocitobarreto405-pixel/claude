import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CalendarClock, Car, Percent, Phone, Plus, Trash2, Users, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Botao, CabecalhoDeTela, Card, Chip, LinhaSwitch, Recolhido } from "@/components/nexa";
import {
  adicionarTecnico,
  CHAVE_AGENDA_CONFIG,
  ativarTecnico,
  desmarcarContatoInterno,
  excluirVeiculo,
  lerAgendaConfig,
  listarContatosInternos,
  marcarContatoInterno,
  salvarAgendaConfig,
  salvarHorariosTecnico,
  salvarVeiculo,
  type ConfigAgenda,
  type DadosAgendaConfig,
  type VeiculoAgenda,
} from "@/lib/agenda-config.functions";
import { descreverFiltros } from "@/lib/listas";
import { cn } from "@/lib/utils";

const CHAVE_INTERNOS = ["contatos-internos"] as const;

export const Route = createFileRoute("/_authenticated/agenda-config")({
  head: () => ({ meta: [{ title: "Agenda e promoção — Nexa OS" }] }),
  component: AgendaConfig,
});

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_RODIZIO = [1, 2, 3, 4, 5];
const SELECT =
  "min-h-11 w-full rounded-botao border border-input bg-card px-3 text-sm text-foreground disabled:opacity-60";

function erro(e: unknown, padrao: string) {
  toast.error(e instanceof Error ? e.message : padrao);
}

function AgendaConfig() {
  const lerFn = useServerFn(lerAgendaConfig);
  const q = useQuery({ queryKey: CHAVE_AGENDA_CONFIG, queryFn: () => lerFn() });
  const d = q.data;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <CabecalhoDeTela
        titulo="Agenda e promoção"
        descricao="Técnicos, veículos, horários base, rodízio, promoção para agenda vazia e contatos internos da equipe."
      />
      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : q.error || !d ? (
        <Card className="text-center text-sm">
          {q.error instanceof Error ? q.error.message : "Erro ao carregar."}
        </Card>
      ) : !d.admin ? (
        <Card className="text-center text-sm">Só o administrador muda estas opções.</Card>
      ) : (
        <>
          <TecnicosVeiculos d={d} />
          <HorariosBase d={d} />
          <Regras
            config={d.config}
            rodizioSeAplica={d.veiculos.some((v) => v.diaRodizio != null)}
          />
          <ContatosInternos />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- técnicos e veículos
function TecnicosVeiculos({ d }: { d: DadosAgendaConfig }) {
  const qc = useQueryClient();
  const addFn = useServerFn(adicionarTecnico);
  const ativoFn = useServerFn(ativarTecnico);
  const [novo, setNovo] = useState("");
  const recarregar = () => qc.invalidateQueries({ queryKey: CHAVE_AGENDA_CONFIG });

  async function adicionar() {
    try {
      await addFn({ data: { nome: novo } });
      setNovo("");
      await recarregar();
      toast.success("Técnico adicionado.");
    } catch (e) {
      erro(e, "Não foi possível adicionar.");
    }
  }

  return (
    <Recolhido
      titulo="Técnicos e veículos"
      icone={<Users className="size-5 text-marca" aria-hidden />}
      abertoInicial
    >
      <div className="flex flex-col gap-4 p-4">
        <ul className="flex flex-col gap-1">
          {d.tecnicos.map((t) => (
            <li key={t.id}>
              <LinhaSwitch
                id={`tec-${t.id}`}
                titulo={t.nome}
                descricao={t.ativo ? "Ativo" : "Inativo (fora da agenda e da promoção)"}
                checked={t.ativo}
                onCheckedChange={async (v) => {
                  try {
                    await ativoFn({ data: { id: t.id, ativo: v } });
                    await recarregar();
                  } catch (e) {
                    erro(e, "Não foi possível salvar.");
                  }
                }}
              />
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            aria-label="Nome do novo técnico"
            placeholder="Nome do novo técnico"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
          />
          <Botao variante="contorno" onClick={() => void adicionar()} disabled={!novo.trim()}>
            <Plus /> Adicionar
          </Botao>
        </div>

        <h3 className="mt-2 flex items-center gap-2 text-sm font-bold">
          <Car className="size-4 text-marca" aria-hidden /> Veículos e dia do rodízio
        </h3>
        {d.veiculos.map((v) => (
          <LinhaVeiculo key={v.id} v={v} d={d} />
        ))}
        <LinhaVeiculo v={null} d={d} />
      </div>
    </Recolhido>
  );
}

function LinhaVeiculo({ v, d }: { v: VeiculoAgenda | null; d: DadosAgendaConfig }) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(salvarVeiculo);
  const excluirFn = useServerFn(excluirVeiculo);
  const [nome, setNome] = useState(v?.nome ?? "");
  const [tecnicoId, setTecnicoId] = useState(v?.tecnicoId ?? "");
  const [dia, setDia] = useState(v?.diaRodizio ? String(v.diaRodizio) : "");
  const recarregar = () => qc.invalidateQueries({ queryKey: CHAVE_AGENDA_CONFIG });

  async function salvar() {
    try {
      await salvarFn({
        data: {
          id: v?.id ?? null,
          nome,
          tecnicoId: tecnicoId || null,
          diaRodizio: dia ? Number(dia) : null,
        },
      });
      if (!v) {
        setNome("");
        setTecnicoId("");
        setDia("");
      }
      await recarregar();
      toast.success("Veículo salvo.");
    } catch (e) {
      erro(e, "Não foi possível salvar o veículo.");
    }
  }

  async function excluir() {
    if (!v || !window.confirm(`Remover o veículo "${v.nome}"?`)) return;
    try {
      await excluirFn({ data: { id: v.id } });
      await recarregar();
    } catch (e) {
      erro(e, "Não foi possível remover.");
    }
  }

  const id = v?.id ?? "novo";
  return (
    <div className="grid gap-2 rounded-botao border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`v-nome-${id}`}>{v ? "Veículo" : "Novo veículo"}</Label>
        <Input
          id={`v-nome-${id}`}
          placeholder="Modelo ou placa"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`v-tec-${id}`}>Técnico</Label>
        <select
          id={`v-tec-${id}`}
          className={SELECT}
          value={tecnicoId}
          onChange={(e) => setTecnicoId(e.target.value)}
        >
          <option value="">Nenhum</option>
          {d.tecnicos.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nome}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`v-dia-${id}`}>Dia do rodízio</Label>
        <select
          id={`v-dia-${id}`}
          className={SELECT}
          value={dia}
          onChange={(e) => setDia(e.target.value)}
        >
          <option value="">Sem rodízio</option>
          {DIAS_RODIZIO.map((n) => (
            <option key={n} value={n}>
              {DIAS[n]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-end gap-2">
        <Botao
          variante={v ? "contorno" : "primario"}
          onClick={() => void salvar()}
          disabled={!nome.trim()}
        >
          {v ? "Salvar" : "Adicionar"}
        </Botao>
        {v ? (
          <Botao
            variante="neutro"
            tamanho="icone"
            aria-label={`Remover ${v.nome}`}
            onClick={() => void excluir()}
          >
            <Trash2 />
          </Botao>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- horários base
function HorariosBase({ d }: { d: DadosAgendaConfig }) {
  const ativos = d.tecnicos.filter((t) => t.ativo);
  return (
    <Recolhido
      titulo="Horários base"
      icone={<CalendarClock className="size-5 text-marca" aria-hidden />}
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-muted-foreground">
          Servem só de referência para a promoção: um horário base sem atendimento marcado conta
          como livre. Encaixes em outros horários não contam.
        </p>
        {ativos.length === 0 ? (
          <p className="text-sm">Nenhum técnico ativo.</p>
        ) : (
          ativos.map((t) => (
            <HorariosDoTecnico
              key={t.id}
              tecnicoId={t.id}
              nome={t.nome}
              iniciais={d.horarios.filter((h) => h.tecnicoId === t.id)}
            />
          ))
        )}
      </div>
    </Recolhido>
  );
}

function HorariosDoTecnico({
  tecnicoId,
  nome,
  iniciais,
}: {
  tecnicoId: string;
  nome: string;
  iniciais: { diaSemana: number; hora: string }[];
}) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(salvarHorariosTecnico);
  const [lista, setLista] = useState(iniciais);
  const [dia, setDia] = useState("1");
  const [hora, setHora] = useState("10:00");
  const [salvando, setSalvando] = useState(false);
  // Só recarrega quando os horários salvos mudam (não a cada nova leitura da tela).
  const salvos = JSON.stringify(iniciais);
  useEffect(() => setLista(JSON.parse(salvos) as typeof iniciais), [salvos]);

  function adicionar() {
    if (!hora) return;
    const n = Number(dia);
    if (lista.some((h) => h.diaSemana === n && h.hora === hora)) return;
    setLista([...lista, { diaSemana: n, hora }]);
  }

  async function salvar() {
    setSalvando(true);
    try {
      await salvarFn({ data: { tecnicoId, horarios: lista } });
      await qc.invalidateQueries({ queryKey: CHAVE_AGENDA_CONFIG });
      toast.success(`Horários de ${nome} salvos.`);
    } catch (e) {
      erro(e, "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const mudou =
    JSON.stringify([...lista].sort(ordenar)) !== JSON.stringify([...iniciais].sort(ordenar));

  return (
    <div className="flex flex-col gap-3 rounded-botao border border-border p-3">
      <p className="font-bold">{nome}</p>
      <ul className="flex flex-col gap-1.5">
        {[0, 1, 2, 3, 4, 5, 6].map((n) => {
          const horas = lista.filter((h) => h.diaSemana === n).sort(ordenar);
          if (!horas.length) return null;
          return (
            <li key={n} className="flex flex-wrap items-center gap-2">
              <span className="w-10 text-sm font-semibold">{DIAS[n]}</span>
              {horas.map((h) => (
                <button
                  key={h.hora}
                  type="button"
                  onClick={() =>
                    setLista(lista.filter((x) => !(x.diaSemana === n && x.hora === h.hora)))
                  }
                  aria-label={`Tirar ${DIAS[n]} ${h.hora}`}
                  className="inline-flex min-h-11 items-center gap-1 rounded-full bg-marca-claro px-3 text-sm font-semibold text-marca"
                >
                  {h.hora} <X className="size-4" aria-hidden />
                </button>
              ))}
            </li>
          );
        })}
        {lista.length === 0 ? (
          <li className="text-sm text-muted-foreground">Sem horários base.</li>
        ) : null}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`hb-dia-${tecnicoId}`}>Dia</Label>
          <select
            id={`hb-dia-${tecnicoId}`}
            className={cn(SELECT, "w-24")}
            value={dia}
            onChange={(e) => setDia(e.target.value)}
          >
            {DIAS.map((rotulo, n) => (
              <option key={rotulo} value={n}>
                {rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`hb-hora-${tecnicoId}`}>Hora</Label>
          <Input
            id={`hb-hora-${tecnicoId}`}
            type="time"
            className="min-h-11 w-36"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
          />
        </div>
        <Botao variante="contorno" onClick={adicionar}>
          <Plus /> Incluir
        </Botao>
        <Botao onClick={() => void salvar()} disabled={!mudou || salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </Botao>
      </div>
    </div>
  );
}

function ordenar(a: { diaSemana: number; hora: string }, b: { diaSemana: number; hora: string }) {
  return a.diaSemana - b.diaSemana || a.hora.localeCompare(b.hora);
}

// ---------------------------------------------------------------- rodízio e promoção
function Regras({
  config,
  rodizioSeAplica,
}: {
  config: ConfigAgenda;
  /** Algum veículo tem dia de rodízio (senão o rodízio não se aplica à empresa). */
  rodizioSeAplica: boolean;
}) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(salvarAgendaConfig);
  const [c, setC] = useState(config);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => setC(config), [config]);
  const muda = <K extends keyof ConfigAgenda>(k: K, v: ConfigAgenda[K]) => setC({ ...c, [k]: v });

  async function salvar() {
    setSalvando(true);
    try {
      await salvarFn({ data: c });
      await qc.invalidateQueries({ queryKey: CHAVE_AGENDA_CONFIG });
      toast.success("Configuração salva.");
    } catch (e) {
      erro(e, "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const campoHora = (k: keyof ConfigAgenda, rotulo: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`cfg-${k}`}>{rotulo}</Label>
      <Input
        id={`cfg-${k}`}
        type="time"
        className="min-h-11"
        value={String(c[k])}
        onChange={(e) => muda(k, e.target.value as never)}
      />
    </div>
  );
  const campoNumero = (k: keyof ConfigAgenda, rotulo: string, sufixo: string, passo = 1) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`cfg-${k}`}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`cfg-${k}`}
          type="number"
          inputMode="decimal"
          step={passo}
          className="min-h-11"
          value={String(c[k])}
          onChange={(e) => muda(k, Number(e.target.value) as never)}
        />
        <span className="text-sm text-muted-foreground">{sufixo}</span>
      </div>
    </div>
  );
  /** Campo que pode ficar em branco (sem limite). */
  const campoOpcional = (k: "margemMin" | "kmMax", rotulo: string, sufixo: string) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`cfg-${k}`}>{rotulo}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`cfg-${k}`}
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="sem limite"
          className="min-h-11"
          value={c[k] === null ? "" : String(c[k])}
          onChange={(e) => muda(k, e.target.value === "" ? null : Number(e.target.value))}
        />
        <span className="text-sm text-muted-foreground">{sufixo}</span>
      </div>
    </div>
  );
  const total = Number(c.descontoPct) + Number(c.pixPct);

  return (
    <>
      <Recolhido
        titulo="Rodízio"
        icone={<Car className="size-5 text-marca" aria-hidden />}
        extra={rodizioSeAplica ? null : <Chip>Não se aplica</Chip>}
      >
        <div className="flex flex-col gap-4 p-4">
          {rodizioSeAplica ? null : (
            <p className="rounded-botao bg-background p-3 text-sm">
              Nenhum veículo tem dia de rodízio, então a Agenda não dá avisos de rodízio. Para usar,
              cadastre o dia de rodízio no veículo (em Técnicos e veículos).
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            No dia do rodízio do veículo, a Agenda avisa (sem bloquear) quando o atendimento começa
            cedo demais ou quando o fim, somando a volta, passa do início do rodízio da tarde.
          </p>
          <div className="grid grid-cols-2 gap-3">
            {campoHora("rodizioManhaInicio", "Manhã: das")}
            {campoHora("rodizioManhaFim", "Manhã: até")}
            {campoHora("rodizioTardeInicio", "Tarde: das")}
            {campoHora("rodizioTardeFim", "Tarde: até")}
            {campoHora("comecarAPartir", "Começar a partir de")}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {campoNumero("duracaoMin", "Duração do atendimento", "min", 15)}
            {campoNumero("voltaMin", "Tempo de volta", "min", 5)}
          </div>
          <Botao onClick={() => void salvar()} disabled={salvando} className="self-start">
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
        </div>
      </Recolhido>

      <Recolhido
        titulo="Promoção de dia vago"
        icone={<Percent className="size-5 text-marca" aria-hidden />}
      >
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-muted-foreground">
            Nada é enviado sozinho: a chave só libera a promoção. Cada envio sai quando o admin toca
            em "Ativar", depois de conferir a lista, e com o "Envio ligado" do Marketing.
          </p>
          <LinhaSwitch
            id="cfg-promo-ligada"
            titulo="Promoção liberada"
            descricao="Desligada, ninguém consegue ativar a promoção."
            checked={c.promoLigada}
            onCheckedChange={(v) => muda("promoLigada", v)}
          />
          <p className="rounded-botao bg-background p-3 text-sm">
            <span className="block font-semibold">Quem recebe</span>
            {descreverFiltros(c.promoListas)}
            <span className="block text-xs text-muted-foreground">
              Para mudar as listas, toque em “Mudar” no cartão da promoção (Marketing ou Início).
            </span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            {campoNumero("diasAFrente", "Olhar a agenda de", "dia(s) à frente")}
            {campoNumero("descontoPct", "Desconto da promoção", "%", 0.5)}
            {campoNumero("pixPct", "Desconto a mais no Pix", "%", 0.5)}
          </div>
          {total > 25 ? (
            <p className="rounded-botao bg-problema px-3 py-2 text-sm text-problema-foreground">
              Promoção + Pix = {String(total).replace(".", ",")}%. O máximo é 25%.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Total com Pix: {String(total).replace(".", ",")}% (máximo 25%).
            </p>
          )}
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-bold">Margem e distância</h3>
            <p className="text-sm text-muted-foreground">
              Quem fica abaixo da margem mínima ou passa da distância máxima aparece desmarcado na
              lista, com o motivo (dá para marcar de novo). Em branco = sem limite.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {campoOpcional("margemMin", "Margem mínima", "R$")}
            {campoOpcional("kmMax", "Distância máxima (só a ida)", "km")}
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="text-[15px] font-bold">Custo médio de produto por serviço</h3>
            <p className="text-sm text-muted-foreground">
              Entra na margem estimada junto com o imposto e o deslocamento da ida (sem mão de
              obra).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {campoNumero("produtoHigienizacao", "Higienização", "R$", 0.5)}
            {campoNumero("produtoImpermeabilizacao", "Impermeabilização", "R$", 0.5)}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="cfg-template">Modelo aprovado na Meta</Label>
            <Input
              id="cfg-template"
              value={c.template}
              onChange={(e) => muda("template", e.target.value)}
            />
          </div>
          <Botao
            onClick={() => void salvar()}
            disabled={salvando || total > 25}
            className="self-start"
          >
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
        </div>
      </Recolhido>
    </>
  );
}

// ---------------------------------------------------------------- contatos internos
function ContatosInternos() {
  const qc = useQueryClient();
  const listarFn = useServerFn(listarContatosInternos);
  const marcarFn = useServerFn(marcarContatoInterno);
  const desmarcarFn = useServerFn(desmarcarContatoInterno);
  const q = useQuery({ queryKey: CHAVE_INTERNOS, queryFn: () => listarFn() });
  const [telefone, setTelefone] = useState("");
  const [nome, setNome] = useState("");
  const recarregar = () => qc.invalidateQueries({ queryKey: CHAVE_INTERNOS });

  async function marcar() {
    try {
      await marcarFn({ data: { telefone, nome } });
      setTelefone("");
      setNome("");
      await recarregar();
      // O cartão dos avisos no WhatsApp volta a aceitar o número.
      await qc.invalidateQueries({ queryKey: ["avisos", "whatsapp"] });
      toast.success("Marcado como contato interno.");
    } catch (e) {
      erro(e, "Não foi possível marcar.");
    }
  }

  async function desmarcar(id: string, rotulo: string) {
    if (!window.confirm(`Desmarcar ${rotulo}? O número volta a ser tratado como cliente.`)) return;
    try {
      await desmarcarFn({ data: { id } });
      await recarregar();
      await qc.invalidateQueries({ queryKey: ["avisos", "whatsapp"] });
    } catch (e) {
      erro(e, "Não foi possível desmarcar.");
    }
  }

  const lista = q.data ?? [];
  return (
    <Recolhido
      titulo="Contatos internos da equipe"
      icone={<Phone className="size-5 text-marca" aria-hidden />}
      extra={<Chip tom="neutro">{lista.length}</Chip>}
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-muted-foreground">
          Número marcado como interno recebe os avisos da equipe e sai de todas as campanhas,
          promoções, gatilhos e follow-ups de cliente.
        </p>
        <ul className="flex flex-col gap-2">
          {lista.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-3 rounded-botao border border-border p-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.nome ?? "Sem nome"}</p>
                <p className="text-sm text-muted-foreground">{formatarFone(c.telefone)}</p>
              </div>
              <Botao
                variante="neutro"
                tamanho="icone"
                aria-label={`Desmarcar ${c.nome ?? c.telefone}`}
                onClick={() => void desmarcar(c.id, c.nome ?? formatarFone(c.telefone))}
              >
                <Trash2 />
              </Botao>
            </li>
          ))}
          {!q.isLoading && lista.length === 0 ? (
            <li className="text-sm text-muted-foreground">Nenhum número marcado.</li>
          ) : null}
        </ul>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div className="flex flex-col gap-1">
            <Label htmlFor="int-fone">Celular</Label>
            <Input
              id="int-fone"
              inputMode="tel"
              placeholder="11 98888-7777"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="int-nome">Nome</Label>
            <Input
              id="int-nome"
              placeholder="Ex.: Leandro"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />
          </div>
          <Botao
            className="self-end"
            onClick={() => void marcar()}
            disabled={telefone.replace(/\D/g, "").length < 10}
          >
            Marcar
          </Botao>
        </div>
      </div>
    </Recolhido>
  );
}

function formatarFone(t: string) {
  const d = t.replace(/\D/g, "").replace(/^55/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}
