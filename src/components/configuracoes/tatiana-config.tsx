import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, Chip, LinhaSwitch } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { tatianaConfigFn, tatianaLigarFn, tatianaTetoFn } from "@/lib/tatiana-config.functions";

const CHAVE = ["tatiana_config"];
const usd = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const dataBR = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });

/**
 * Configurações › Vendas › Tatiana (gerente comercial). O admin liga e desliga e vê o que ela fez;
 * custo, teto e projeção só aparecem para a equipe da Nexa.
 */
export function TatianaConfig() {
  const qc = useQueryClient();
  const ler = useServerFn(tatianaConfigFn);
  const ligarFn = useServerFn(tatianaLigarFn);
  const tetoFn = useServerFn(tatianaTetoFn);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => ler() });
  const [salvando, setSalvando] = useState(false);
  const [teto, setTeto] = useState("");

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (q.error)
    return (
      <p className="text-sm text-problema-foreground">
        {q.error instanceof Error ? q.error.message : "Não foi possível carregar."}
      </p>
    );
  const d = q.data;
  if (!d) return null;
  if (!d.liberada)
    return (
      <p className="text-sm text-muted-foreground">
        A Tatiana (gerente comercial) ainda não foi liberada nesta empresa. Fale com a Nexa.
      </p>
    );

  async function ligar(v: boolean) {
    setSalvando(true);
    try {
      await ligarFn({ data: { ligar: v } });
      await qc.invalidateQueries({ queryKey: CHAVE });
      toast.success(v ? "Tatiana ligada." : "Tatiana desligada. Ela não roda nas próximas noites.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  async function salvarTeto() {
    const v = Number(teto.replace(",", "."));
    setSalvando(true);
    try {
      await tetoFn({ data: { tetoUsd: v } });
      await qc.invalidateQueries({ queryKey: CHAVE });
      setTeto("");
      toast.success("Teto salvo.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  const n = d.ultimaNoite;
  const c = d.custos;
  return (
    <div className="flex flex-col gap-4">
      <LinhaSwitch
        id="tatiana-ligada"
        titulo="Tatiana ligada"
        descricao="Toda noite ela lê os atendimentos e monta as tarefas do dia seguinte para a equipe. Desligada, não roda nem cria tarefas."
        checked={d.ligada}
        disabled={salvando}
        onCheckedChange={(v) => void ligar(v)}
      />
      <div className="grid gap-1 rounded-card border border-border p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Última noite</span>
          {n ? (
            <Chip tom={n.status === "concluida" ? "sucesso" : "atencao"}>
              {n.status === "concluida" ? "Concluída" : n.status}
            </Chip>
          ) : null}
        </div>
        {n ? (
          <p className="text-muted-foreground">
            {dataBR(n.noite)}: leu {n.leads.toLocaleString("pt-BR")} atendimentos e criou{" "}
            {n.tarefas.toLocaleString("pt-BR")} tarefas.
          </p>
        ) : (
          <p className="text-muted-foreground">Nenhuma noite neste mês ainda.</p>
        )}
        <p className="text-muted-foreground">
          Tarefas criadas no mês: <strong>{d.tarefasNoMes.toLocaleString("pt-BR")}</strong>
        </p>
      </div>

      {c ? (
        <div className="grid gap-2 rounded-card border border-dashed border-border p-3 text-sm">
          <p className="font-semibold">Custo (só a Nexa vê)</p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Noites no mês (conta no teto)</dt>
            <dd className="text-right tabular-nums">{usd(c.noitesNoMesUsd)}</dd>
            <dt className="text-muted-foreground">Total da Tatiana no mês</dt>
            <dd className="text-right tabular-nums">{usd(c.totalNoMesUsd)}</dd>
            <dt className="text-muted-foreground">Última noite</dt>
            <dd className="text-right tabular-nums">
              {c.ultimaNoiteUsd === null ? "—" : usd(c.ultimaNoiteUsd)}
            </dd>
            <dt className="text-muted-foreground">Projeção até o fim do mês</dt>
            <dd
              className={
                c.projecaoUsd > c.tetoUsd
                  ? "text-right font-bold text-problema-foreground tabular-nums"
                  : "text-right tabular-nums"
              }
            >
              {usd(c.projecaoUsd)}
            </dd>
            <dt className="text-muted-foreground">Teto do mês</dt>
            <dd className="text-right font-semibold tabular-nums">{usd(c.tetoUsd)}</dd>
          </dl>
          {c.projecaoUsd > c.tetoUsd ? (
            <p className="text-xs text-problema-foreground">
              No ritmo atual passa do teto; quando bater, a noite para sozinha até o mês virar.
            </p>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="tatiana-teto">Novo teto (US$)</Label>
              <Input
                id="tatiana-teto"
                inputMode="decimal"
                className="w-32"
                placeholder={String(c.tetoUsd)}
                value={teto}
                onChange={(e) => setTeto(e.target.value)}
              />
            </div>
            <Botao
              variante="contorno"
              disabled={salvando || !teto.trim()}
              onClick={() => void salvarTeto()}
            >
              Salvar teto
            </Botao>
          </div>
        </div>
      ) : null}
    </div>
  );
}
