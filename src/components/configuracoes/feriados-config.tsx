// Configurações › Agenda › Feriados (02/11/2026): calendário da empresa por ano (nacionais,
// estado de SP e cidade de São Paulo já preenchidos), decisão "Vamos trabalhar / Não vamos" por
// feriado, feriados próprios (adicionar e remover). Sem decisão, o dia fica bloqueado: a Alice
// não oferece nem agenda, a Tatiana não cria tarefa e a agenda livre não conta o dia.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, Chip } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROTULO_ORIGEM, diaSemanaDe, type Feriado } from "@/lib/feriados";
import {
  adicionarFeriadoFn,
  decidirFeriadoFn,
  feriadosFn,
  removerFeriadoFn,
} from "@/lib/feriados.functions";

const CHAVE = (ano: number) => ["feriados", ano];
const curta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function FeriadosConfig() {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState(anoAtual);
  const fn = useServerFn(feriadosFn);
  const q = useQuery({ queryKey: CHAVE(ano), queryFn: () => fn({ data: { ano } }) });
  const qc = useQueryClient();
  const decidir = useServerFn(decidirFeriadoFn);
  const adicionar = useServerFn(adicionarFeriadoFn);
  const remover = useServerFn(removerFeriadoFn);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [novaData, setNovaData] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);

  async function rodar(id: string, acao: () => Promise<unknown>, ok: string) {
    setSalvando(id);
    try {
      await acao();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: ["feriados"] });
      await qc.invalidateQueries({ queryKey: ["tatiana-hoje"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setSalvando(null);
    }
  }

  const d = q.data;
  const admin = Boolean(d?.admin);
  return (
    <div className="flex min-w-0 flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Feriado sem decisão ou com "Não vamos" fica bloqueado: a Alice não oferece nem agenda, a
        Tatiana não cria tarefa e a agenda livre não conta o dia. Três semanas antes de cada feriado
        a Tatiana pergunta ao administrador; sem resposta até a véspera, vale "Não vamos".
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {[anoAtual, anoAtual + 1].map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setAno(a)}
            aria-pressed={ano === a}
            className={`min-h-9 rounded-full px-4 text-sm font-medium ${
              ano === a ? "bg-marca text-marca-foreground" : "bg-muted"
            }`}
          >
            {a}
          </button>
        ))}
      </div>
      {q.isLoading ? <p className="text-muted-foreground">Carregando…</p> : null}
      {q.error ? (
        <p className="text-destructive">
          {q.error instanceof Error ? q.error.message : "Não foi possível carregar."}
        </p>
      ) : null}
      {d ? (
        <ul className="flex min-w-0 flex-col gap-2">
          {d.feriados.map((f) => (
            <LinhaFeriado
              key={f.id}
              f={f}
              passado={f.data < hoje}
              admin={admin}
              ocupado={salvando === f.id}
              aoDecidir={(t) =>
                void rodar(
                  f.id,
                  () => decidir({ data: { id: f.id, trabalhamos: t } }),
                  t ? `${curta(f.data)}: dia normal na agenda.` : `${curta(f.data)}: bloqueado.`,
                )
              }
              aoRemover={() =>
                void rodar(
                  f.id,
                  () => remover({ data: { id: f.id } }),
                  `${curta(f.data)} removido.`,
                )
              }
            />
          ))}
        </ul>
      ) : null}
      {admin ? (
        <form
          className="flex min-w-0 flex-col gap-2 rounded-card bg-secondary/60 p-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void rodar(
              "novo",
              () => adicionar({ data: { data: novaData, nome: novoNome } }),
              "Feriado da empresa gravado (dia bloqueado).",
            ).then(() => {
              setNovaData("");
              setNovoNome("");
            });
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="feriado-data">Feriado da empresa</Label>
            <Input
              id="feriado-data"
              type="date"
              className="min-h-11"
              value={novaData}
              onChange={(e) => setNovaData(e.target.value)}
              required
            />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <Label htmlFor="feriado-nome">Nome</Label>
            <Input
              id="feriado-nome"
              className="min-h-11"
              value={novoNome}
              maxLength={80}
              placeholder="Ex.: Recesso de fim de ano"
              onChange={(e) => setNovoNome(e.target.value)}
              required
            />
          </div>
          <Botao type="submit" disabled={salvando === "novo"}>
            Adicionar
          </Botao>
        </form>
      ) : null}
    </div>
  );
}

function LinhaFeriado({
  f,
  passado,
  admin,
  ocupado,
  aoDecidir,
  aoRemover,
}: {
  f: Feriado;
  passado: boolean;
  admin: boolean;
  ocupado: boolean;
  aoDecidir: (trabalhamos: boolean) => void;
  aoRemover: () => void;
}) {
  const situacao =
    f.trabalhamos === true
      ? { texto: "Vamos trabalhar", tom: "sucesso" as const }
      : f.trabalhamos === false
        ? {
            texto: f.decididoOrigem === "padrao" ? "Não vamos (padrão)" : "Não vamos",
            tom: "neutro" as const,
          }
        : { texto: "Sem decisão: bloqueado", tom: "atencao" as const };
  return (
    <li
      className={`flex min-w-0 flex-col gap-2 rounded-card border border-border p-3 sm:flex-row sm:items-center sm:justify-between ${
        passado ? "opacity-60" : ""
      }`}
    >
      <div className="min-w-0">
        <p className="font-bold">
          {diaSemanaDe(f.data).slice(0, 3)} {curta(f.data)} · {f.nome}
        </p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Chip tom={situacao.tom}>{situacao.texto}</Chip>
          <span>{ROTULO_ORIGEM[f.origem]}</span>
        </p>
      </div>
      {admin && !passado ? (
        <div className="flex shrink-0 flex-wrap gap-2">
          {f.trabalhamos !== true ? (
            <Botao variante="contorno" disabled={ocupado} onClick={() => aoDecidir(true)}>
              Vamos trabalhar
            </Botao>
          ) : null}
          {f.trabalhamos !== false ? (
            <Botao disabled={ocupado} onClick={() => aoDecidir(false)}>
              Não vamos
            </Botao>
          ) : null}
          {f.origem === "manual" ? (
            <Botao variante="neutro" disabled={ocupado} onClick={aoRemover}>
              Remover
            </Botao>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
