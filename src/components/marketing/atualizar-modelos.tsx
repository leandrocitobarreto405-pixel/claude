import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Botao } from "@/components/nexa";
import { atualizarSituacaoModelosFn } from "@/lib/modelos-mensagem.functions";
import { situacaoDoModelo } from "@/lib/modelos-mensagem";
import { fetchDireto } from "@/lib/enderecos";

/**
 * "Atualizar situação dos modelos": pede ao Chatwoot para buscar os modelos na Meta de novo e
 * confere direto na Meta o que ainda divergir. Depois recarrega as telas que usam os modelos.
 */
export function AtualizarModelos({
  chaves,
  larguraTotal,
}: {
  /** Consultas para recarregar depois (lista de modelos, conferência da campanha...). */
  chaves: ReadonlyArray<readonly unknown[]>;
  larguraTotal?: boolean;
}) {
  const qc = useQueryClient();
  const fn = useServerFn(atualizarSituacaoModelosFn);
  const [ocupado, setOcupado] = useState(false);

  async function atualizar() {
    setOcupado(true);
    try {
      const r = await fn({ fetch: fetchDireto });
      await Promise.all(chaves.map((k) => qc.invalidateQueries({ queryKey: [...k] })));
      const rotulo = (s: string | null) =>
        s ? situacaoDoModelo(s).rotulo.toLowerCase() : "não tem";
      if (r.divergentes.length) {
        toast.warning(
          `O Chatwoot ainda não atualizou ${r.divergentes
            .map((d) => `${d.nome} (lá: ${rotulo(d.chatwoot)}; na Meta: ${rotulo(d.meta)})`)
            .join(", ")}. O Nexa passa a usar a situação da Meta.`,
          { duration: 12000 },
        );
      } else if (r.erroMeta) {
        toast.warning(`Chatwoot atualizado, mas não deu para conferir na Meta: ${r.erroMeta}`);
      } else {
        toast.success(
          r.sincronizou
            ? `Situação dos modelos atualizada${r.conferiuMeta ? " e conferida na Meta" : ""}.`
            : "Situação conferida (o Chatwoot não aceitou o pedido de atualizar).",
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível atualizar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Botao variante="contorno" larguraTotal={larguraTotal} disabled={ocupado} onClick={atualizar}>
      <RefreshCw className={ocupado ? "animate-spin" : undefined} aria-hidden />
      {ocupado ? "Atualizando…" : "Atualizar situação dos modelos"}
    </Botao>
  );
}
