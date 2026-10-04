import { useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Botao } from "@/components/nexa";
import { COMO_FUNCIONA, instrucoesDoModelo, MODELOS, type TipoModelo } from "@/lib/importacao-base";

/** Gera o .xlsx do modelo no próprio celular (sem servidor) e baixa. */
async function baixarModelo(tipo: TipoModelo) {
  const XLSX = await import("xlsx");
  const m = MODELOS[tipo];
  const wb = XLSX.utils.book_new();
  const dados = XLSX.utils.aoa_to_sheet([m.colunas, ...m.exemplos]);
  dados["!cols"] = m.colunas.map((c) => ({ wch: Math.max(16, c.length + 2) }));
  XLSX.utils.book_append_sheet(wb, dados, "Contatos");
  const ajuda = XLSX.utils.aoa_to_sheet(instrucoesDoModelo(tipo).map((l) => [l]));
  ajuda["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, ajuda, "Como preencher");
  XLSX.writeFile(wb, m.arquivo);
}

/** Os dois botões dos modelos de planilha e o texto de para onde cada pessoa vai. */
export function ModelosDePlanilha() {
  const [baixando, setBaixando] = useState<TipoModelo | null>(null);

  async function baixar(tipo: TipoModelo) {
    setBaixando(tipo);
    try {
      await baixarModelo(tipo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível gerar o modelo.");
    } finally {
      setBaixando(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(MODELOS) as TipoModelo[]).map((t) => (
          <Botao
            key={t}
            variante="contorno"
            disabled={baixando !== null}
            onClick={() => void baixar(t)}
          >
            <Download /> {MODELOS[t].rotulo}
          </Botao>
        ))}
      </div>
      <ul className="flex flex-col gap-1.5 text-sm text-muted-foreground">
        {COMO_FUNCIONA.map((t) => (
          <li key={t}>{t}</li>
        ))}
        <li>Apague as 2 linhas de exemplo antes de importar.</li>
      </ul>
    </div>
  );
}
