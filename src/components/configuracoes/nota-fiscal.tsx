import { useState } from "react";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import { saveSetting, useInvalidate, useSetting } from "@/lib/data";
import {
  CHAVE_REGRA_NOTA,
  REGRAS_NOTA,
  REGRA_NOTA_PADRAO,
  regraNota,
  type RegraNota,
} from "@/lib/nota-fiscal-regra";
import { cn } from "@/lib/utils";

/** Configurações › Vendas › Nota fiscal: quando "Precisa de nota fiscal?" já vem marcado. */
export function RegraNotaFiscal() {
  const { data: salva } = useSetting<unknown>(CHAVE_REGRA_NOTA, REGRA_NOTA_PADRAO);
  const invalidar = useInvalidate();
  const [salvando, setSalvando] = useState<RegraNota | null>(null);
  const atual = regraNota(salva);

  async function escolher(regra: RegraNota) {
    if (regra === atual) return;
    setSalvando(regra);
    try {
      await saveSetting(CHAVE_REGRA_NOTA, regra);
      invalidar("app_settings");
      toast.success("Regra da nota fiscal salva.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Gerar pedido de nota ao concluir um serviço. O valor do pedido é sempre o total da OS (uma
        OS com mais de uma visita gera um pedido só).
      </p>
      <div role="radiogroup" aria-label="Gerar pedido de nota" className="flex flex-col gap-2">
        {REGRAS_NOTA.map((r) => {
          const ativo = atual === r.id;
          return (
            <Botao
              key={r.id}
              type="button"
              role="radio"
              aria-checked={ativo}
              variante={ativo ? "primario" : "contorno"}
              disabled={salvando !== null}
              onClick={() => void escolher(r.id)}
              className={cn("h-auto min-h-14 flex-col items-start gap-0.5 py-2 text-left")}
            >
              <span>{r.rotulo}</span>
              <span
                className={cn(
                  "text-xs font-normal",
                  ativo ? "text-marca-foreground/80" : "text-muted-foreground",
                )}
              >
                {r.descricao}
              </span>
            </Botao>
          );
        })}
      </div>
    </div>
  );
}
