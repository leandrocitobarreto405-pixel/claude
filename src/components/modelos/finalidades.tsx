import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ListChecks } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Botao, Recolhido } from "@/components/nexa";
import { finalidadesFn, salvarFinalidadesFn } from "@/lib/modelos-mensagem.functions";
import { FINALIDADES } from "@/lib/modelos-mensagem";
import { cn } from "@/lib/utils";

const DIAS = [
  [1, "Seg"],
  [2, "Ter"],
  [3, "Qua"],
  [4, "Qui"],
  [5, "Sex"],
  [6, "Sáb"],
  [7, "Dom"],
] as const;

/** Qual modelo da Meta cada envio usa (por empresa) e os dias de disparo das campanhas. */
export function Finalidades({ aoSalvar }: { aoSalvar: () => void }) {
  const qc = useQueryClient();
  const lerFn = useServerFn(finalidadesFn);
  const salvarFn = useServerFn(salvarFinalidadesFn);
  const q = useQuery({ queryKey: ["modelos", "finalidades"], queryFn: () => lerFn() });
  const [modelos, setModelos] = useState<Record<string, string>>({});
  const [promocao, setPromocao] = useState("");
  const [dias, setDias] = useState<number[]>([]);
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setModelos(q.data.modelos);
    setPromocao(q.data.promocao);
    setDias(q.data.dias);
  }, [q.data]);

  async function salvar() {
    setSalvando(true);
    try {
      await salvarFn({ data: { modelos, promocao, dias } });
      await qc.invalidateQueries({ queryKey: ["modelos"] });
      aoSalvar();
      toast.success("Salvo. Os próximos envios usam estes modelos e dias.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Recolhido
      titulo="Qual modelo cada envio usa"
      icone={<ListChecks className="size-5 text-marca" aria-hidden />}
    >
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm text-muted-foreground">
          O nome tem que ser igual ao do modelo aprovado na conta do WhatsApp desta empresa. Cada
          empresa tem a própria conta, então os nomes não se misturam.
        </p>
        {FINALIDADES.map((f) => (
          <div key={f.chave} className="flex flex-col gap-1">
            <Label htmlFor={`fin-${f.chave}`}>{f.rotulo}</Label>
            <Input
              id={`fin-${f.chave}`}
              value={modelos[f.chave] ?? ""}
              placeholder={f.padrao}
              onChange={(e) => setModelos({ ...modelos, [f.chave]: e.target.value.trim() })}
            />
          </div>
        ))}
        <div className="flex flex-col gap-1">
          <Label htmlFor="fin-promocao">Promoção da agenda</Label>
          <Input
            id="fin-promocao"
            value={promocao}
            onChange={(e) => setPromocao(e.target.value.trim())}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold">Dias de disparo das campanhas</legend>
          <div className="flex flex-wrap gap-2">
            {DIAS.map(([n, rotulo]) => {
              const sel = dias.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={sel}
                  onClick={() =>
                    setDias(sel ? dias.filter((d) => d !== n) : [...dias, n].sort((a, b) => a - b))
                  }
                  className={cn(
                    "min-h-11 min-w-12 rounded-full border px-3 text-sm font-semibold",
                    sel
                      ? "border-marca bg-marca text-marca-foreground"
                      : "border-border bg-card text-foreground",
                  )}
                >
                  {rotulo}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Gatilhos (pós-venda, lembretes) e a promoção saem em qualquer dia, dentro do horário.
          </p>
        </fieldset>
        <Botao
          className="self-start"
          onClick={() => void salvar()}
          disabled={salvando || !dias.length}
        >
          {salvando ? "Salvando…" : "Salvar"}
        </Botao>
      </div>
    </Recolhido>
  );
}
