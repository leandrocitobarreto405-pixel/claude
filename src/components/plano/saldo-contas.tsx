// Painel Nexa › Consumo: saldo estimado da conta da IA (a Nexa anota a carga; o app desconta o custo
// medido das respostas e avisa em 30% e 10%) e créditos da ElevenLabs no ciclo do plano.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao, Card } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { saldoElevenFn } from "@/lib/paradas-ia.functions";

type SaldoIa = {
  carregado_usd: number;
  carregado_em: string;
  consumido_usd: number;
  restante_usd: number;
  pct_restante: number;
} | null;

const usd = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const dataBR = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });

function cor(pct: number) {
  return pct <= 10 ? "text-destructive" : pct <= 30 ? "text-atencao-foreground" : "text-foreground";
}

export function SaldoContas() {
  const qc = useQueryClient();
  const lerEleven = useServerFn(saldoElevenFn);
  const ia = useQuery({
    queryKey: ["nexa_saldo_ia"],
    queryFn: async (): Promise<SaldoIa> => {
      const { data, error } = await supabase.rpc("ia_saldo_estimado");
      if (error) throw error;
      return (data as SaldoIa) ?? null;
    },
  });
  const eleven = useQuery({ queryKey: ["nexa_saldo_eleven"], queryFn: () => lerEleven() });
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState("");
  const [data, setData] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const v = Number(valor.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0 || v > 100000) {
      toast.error("Informe o valor carregado em US$.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      toast.error("Informe a data da carga.");
      return;
    }
    setSalvando(true);
    const agora = new Date().toISOString();
    const { error } = await supabase.from("configuracoes_plataforma").upsert([
      {
        chave: "ia_credito_carregado_usd",
        valor: Math.round(v * 100) / 100,
        descricao: "Crédito carregado na conta da IA (US$), para o saldo estimado",
        updated_at: agora,
      },
      {
        chave: "ia_credito_carregado_em",
        valor: data,
        descricao: "Data da última carga de crédito na conta da IA",
        updated_at: agora,
      },
    ]);
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível salvar.");
      return;
    }
    toast.success("Carga anotada.");
    setEditando(false);
    await qc.invalidateQueries({ queryKey: ["nexa_saldo_ia"] });
  }

  const s = ia.data;
  const e = eleven.data;
  const pctEleven = e ? Math.round(e.restante * 1000) / 10 : 0;
  return (
    <Card className="gap-3">
      <h2 className="text-base font-bold">Saldo das contas</h2>
      <div className="grid gap-1 text-sm">
        <p className="font-semibold">Conta da IA (estimado)</p>
        {ia.isLoading ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : s ? (
          <>
            <p>
              Restam <strong className={cor(s.pct_restante)}>{usd(s.restante_usd)}</strong> (
              {s.pct_restante.toLocaleString("pt-BR")}%) de {usd(s.carregado_usd)} carregados em{" "}
              {dataBR(s.carregado_em)}.
            </p>
            <p className="text-xs text-muted-foreground">
              Consumo medido desde a carga: {usd(s.consumido_usd)}. É uma estimativa: a conta da IA
              não informa o saldo pela chave.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">Anote a última carga para ver o saldo estimado.</p>
        )}
        {editando ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <div className="grid gap-1">
              <Label htmlFor="carga-usd">Crédito carregado (US$)</Label>
              <Input
                id="carga-usd"
                inputMode="decimal"
                className="min-h-11"
                value={valor}
                onChange={(ev) => setValor(ev.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="carga-em">Em</Label>
              <Input
                id="carga-em"
                type="date"
                className="min-h-11"
                value={data}
                onChange={(ev) => setData(ev.target.value)}
              />
            </div>
            <Botao disabled={salvando} onClick={() => void salvar()}>
              {salvando ? "Salvando…" : "Salvar"}
            </Botao>
          </div>
        ) : (
          <Botao
            variante="neutro"
            className="mt-2 w-fit"
            onClick={() => {
              setValor(s ? String(s.carregado_usd).replace(".", ",") : "");
              setData(s?.carregado_em?.slice(0, 10) ?? new Date().toISOString().slice(0, 10));
              setEditando(true);
            }}
          >
            Anotar carga
          </Botao>
        )}
      </div>
      <div className="grid gap-1 text-sm">
        <p className="font-semibold">ElevenLabs (voz)</p>
        {eleven.isLoading ? (
          <p className="text-muted-foreground">Carregando…</p>
        ) : e ? (
          <>
            <p>
              Restam{" "}
              <strong className={cor(pctEleven)}>
                {Math.max(0, e.limite - e.usados).toLocaleString("pt-BR")} créditos
              </strong>{" "}
              ({pctEleven.toLocaleString("pt-BR")}%) de {e.limite.toLocaleString("pt-BR")}
              {e.plano ? ` · plano ${e.plano}` : ""}
              {e.renovaEm
                ? ` · renova em ${new Date(e.renovaEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                : ""}
              .
            </p>
          </>
        ) : (
          <p className="text-muted-foreground">Não foi possível consultar a ElevenLabs agora.</p>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        A Nexa recebe notificação quando qualquer uma das duas chega a 30% e a 10%.
      </p>
    </Card>
  );
}
