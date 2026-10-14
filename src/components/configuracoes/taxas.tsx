// Seção de Configurações (veio da antiga tela de abas).
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { usePaymentRates } from "@/lib/data";
import { parseNumberBR } from "@/lib/format";

export function Taxas() {
  const { data: rates } = usePaymentRates(false);

  async function atualizar(id: string, valor: string) {
    const pct = parseNumberBR(valor);
    const { error } = await supabase
      .from("payment_rates")
      .update({ rate_percent: pct })
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível atualizar a taxa.");
      return;
    }
    toast.success("Taxa atualizada. Novos pagamentos usarão o novo valor.");
  }

  return (
    <section className="card-surface overflow-x-auto">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-secondary text-left">
          <tr>
            <th className="px-4 py-3 font-medium">Canal</th>
            <th className="px-4 py-3 font-medium">Forma</th>
            <th className="px-4 py-3 font-medium">Parcelas</th>
            <th className="px-4 py-3 font-medium">Taxa (%)</th>
          </tr>
        </thead>
        <tbody>
          {(rates ?? []).map((r) => (
            <tr key={r.id} className="border-t border-border">
              <td className="px-4 py-3">{r.channel}</td>
              <td className="px-4 py-3">{r.payment_type}</td>
              <td className="px-4 py-3">{r.installments}x</td>
              <td className="px-4 py-3">
                <Input
                  defaultValue={String(r.rate_percent).replace(".", ",")}
                  onBlur={(e) => atualizar(r.id, e.target.value)}
                  className="w-[120px]"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
