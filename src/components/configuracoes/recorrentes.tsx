// Seção de Configurações (veio da antiga tela de abas).
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { brl, parseNumberBR } from "@/lib/format";

type TemplateRow = {
  id: string;
  name: string;
  beneficiary: string | null;
  category: string;
  default_amount: number;
  recurrence: string;
  due_day: number | null;
  weekday: number | null;
  active: boolean;
};

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function Recorrentes() {
  const query = useQuery({
    queryKey: ["recurring_expenses_admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recurring_expenses")
        .select(
          "id, name, beneficiary, category, default_amount, recurrence, due_day, weekday, active",
        )
        .order("category")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as TemplateRow[];
    },
  });

  async function atualizar(id: string, patch: Partial<TemplateRow>) {
    const { error } = await supabase.from("recurring_expenses").update(patch).eq("id", id);
    if (error) {
      toast.error(`Não foi possível salvar: ${error.message}`);
      return;
    }
    toast.success("Despesa recorrente atualizada.");
    query.refetch();
  }

  const lista = query.data ?? [];
  const totalMensal = lista
    .filter((t) => t.active && t.recurrence !== "weekly")
    .reduce((sum, t) => sum + Number(t.default_amount ?? 0), 0);

  return (
    <div className="card-surface overflow-x-auto p-4">
      <h2 className="mb-1 text-lg font-semibold">Despesas recorrentes</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Estes modelos geram automaticamente as despesas de cada mês. Total mensal fixo:{" "}
        {brl(totalMensal)}.
      </p>
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-secondary text-left">
          <tr>
            <th className="px-3 py-2 font-medium">Nome</th>
            <th className="px-3 py-2 font-medium">Beneficiário</th>
            <th className="px-3 py-2 font-medium">Categoria</th>
            <th className="px-3 py-2 font-medium">Recorrência</th>
            <th className="px-3 py-2 font-medium">Vencimento</th>
            <th className="px-3 py-2 font-medium">Valor padrão</th>
            <th className="px-3 py-2 font-medium">Ativa</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((t) => (
            <tr key={t.id} className="border-t border-border">
              <td className="px-3 py-2">{t.name}</td>
              <td className="px-3 py-2">
                <Input
                  defaultValue={t.beneficiary ?? ""}
                  className="w-[150px]"
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (t.beneficiary ?? null)) atualizar(t.id, { beneficiary: v });
                  }}
                />
              </td>
              <td className="px-3 py-2">{t.category}</td>
              <td className="px-3 py-2">
                {t.recurrence === "weekly" ? `Semanal (${DIAS_SEMANA[t.weekday ?? 1]})` : "Mensal"}
              </td>
              <td className="px-3 py-2">
                {t.recurrence === "weekly" ? (
                  <span className="text-muted-foreground">Toda {DIAS_SEMANA[t.weekday ?? 1]}</span>
                ) : (
                  <Input
                    defaultValue={t.due_day ?? ""}
                    placeholder="Dia"
                    className="w-[90px]"
                    onBlur={(e) => {
                      const n = Number(e.target.value);
                      const dia = Number.isFinite(n) && n >= 1 && n <= 31 ? n : null;
                      if (dia !== t.due_day) atualizar(t.id, { due_day: dia });
                    }}
                  />
                )}
              </td>
              <td className="px-3 py-2">
                <Input
                  defaultValue={String(Number(t.default_amount ?? 0).toFixed(2)).replace(".", ",")}
                  className="w-[130px]"
                  onBlur={(e) => {
                    const valor = parseNumberBR(e.target.value);
                    if (valor !== Number(t.default_amount))
                      atualizar(t.id, { default_amount: valor });
                  }}
                />
              </td>
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={t.active}
                  onChange={(e) => atualizar(t.id, { active: e.target.checked })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
