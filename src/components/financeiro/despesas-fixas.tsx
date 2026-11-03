// Despesas fixas (03/11): os modelos que geram uma despesa por mês. Editar muda só dali para frente
// (os meses já lançados ficam como estão); Encerrar para de gerar a partir do mês seguinte, sem
// apagar o que já foi lançado.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Botao, Chip } from "@/components/nexa";
import { supabase } from "@/integrations/supabase/client";
import { brl, currentMonth, dateBR, parseNumberBR } from "@/lib/format";
import { fimAoEncerrar } from "@/lib/recurring-core";

type Modelo = {
  id: string;
  name: string;
  category: string;
  default_amount: number;
  recurrence: string;
  due_day: number | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
};

export const CHAVE_DESPESAS_FIXAS = ["despesas_fixas"];

export function DespesasFixas({
  categorias,
  aoMudar,
}: {
  categorias: readonly string[];
  aoMudar?: () => void;
}) {
  const [verEncerradas, setVerEncerradas] = useState(false);
  const mes = currentMonth();
  const q = useQuery({
    queryKey: CHAVE_DESPESAS_FIXAS,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_expenses")
        .select(
          "id, name, category, default_amount, recurrence, due_day, start_date, end_date, active",
        )
        .neq("recurrence", "weekly")
        .order("name");
      if (error) throw error;
      return (data ?? []) as Modelo[];
    },
  });
  const encerrada = (m: Modelo) => !m.active || (m.end_date !== null && m.end_date < `${mes}-01`);
  const lista = (q.data ?? []).filter((m) => verEncerradas || !encerrada(m));
  const totalAtivo = (q.data ?? [])
    .filter((m) => !encerrada(m))
    .reduce((s, m) => s + Number(m.default_amount ?? 0), 0);

  async function atualizar(
    id: string,
    patch: {
      default_amount?: number;
      due_day?: number;
      category?: string;
      end_date?: string | null;
    },
    aviso = "Despesa fixa atualizada.",
  ) {
    const { error } = await supabase.from("recurring_expenses").update(patch).eq("id", id);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success(aviso);
    await q.refetch();
    aoMudar?.();
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">
        Cada despesa fixa gera um lançamento por mês, com o mesmo valor, categoria e dia. Mudar aqui
        vale só dali para frente; os meses já lançados não mudam. Total das ativas por mês:{" "}
        <span className="font-semibold text-foreground">{brl(totalAtivo)}</span>.
      </p>
      {!lista.length ? (
        <p className="text-sm text-muted-foreground">
          Nenhuma despesa fixa ativa. Para criar, use Nova despesa e marque "Repetir todo mês".
        </p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {lista.map((m) => (
            <li
              key={m.id}
              className="flex min-w-0 flex-col gap-2 rounded-botao border border-border bg-card p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.name}</span>
                {encerrada(m) ? (
                  <Chip tom="neutro">Encerrada</Chip>
                ) : (
                  <Chip tom="sucesso">Ativa</Chip>
                )}
                <span className="text-xs text-muted-foreground">
                  {m.start_date ? `desde ${dateBR(m.start_date).slice(3)}` : ""}
                  {m.end_date ? ` · até ${dateBR(m.end_date).slice(3)}` : " · sem fim"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Valor
                  <Input
                    defaultValue={Number(m.default_amount ?? 0)
                      .toFixed(2)
                      .replace(".", ",")}
                    disabled={encerrada(m)}
                    onBlur={(e) => {
                      const v = parseNumberBR(e.target.value);
                      if (v > 0 && v !== Number(m.default_amount))
                        void atualizar(m.id, { default_amount: v });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Dia do vencimento
                  <Input
                    defaultValue={m.due_day ?? ""}
                    inputMode="numeric"
                    disabled={encerrada(m)}
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      const dia = Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
                      if (dia && dia !== m.due_day) void atualizar(m.id, { due_day: dia });
                    }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Categoria
                  <select
                    defaultValue={m.category}
                    disabled={encerrada(m)}
                    onChange={(e) => void atualizar(m.id, { category: e.target.value })}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {[...new Set([m.category, ...categorias])].map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold">
                  Até (mês, opcional)
                  <Input
                    type="month"
                    defaultValue={m.end_date ? m.end_date.slice(0, 7) : ""}
                    disabled={encerrada(m)}
                    onBlur={(e) => {
                      const v = e.target.value;
                      const fim = v
                        ? `${v}-${String(new Date(Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`
                        : null;
                      if (fim && fim < `${mes}-01`) {
                        toast.error("Para parar agora, use Encerrar.");
                        return;
                      }
                      if (fim !== m.end_date) void atualizar(m.id, { end_date: fim });
                    }}
                  />
                </label>
              </div>
              {!encerrada(m) ? (
                <div className="flex flex-wrap gap-2">
                  <Botao
                    variante="contorno"
                    onClick={() =>
                      void atualizar(
                        m.id,
                        { end_date: fimAoEncerrar(mes, m.end_date) },
                        "Despesa fixa encerrada: não gera mais a partir do mês que vem.",
                      )
                    }
                  >
                    Encerrar
                  </Botao>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={verEncerradas}
          onChange={(e) => setVerEncerradas(e.target.checked)}
        />
        Mostrar as encerradas
      </label>
    </div>
  );
}
