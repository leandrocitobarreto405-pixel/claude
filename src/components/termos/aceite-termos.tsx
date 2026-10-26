// "Li e aceito" (decisão C): aparece para quem ainda não aceitou a versão vigente dos termos.
// Não fecha sem aceitar. Sem versão definida pela Nexa, não aparece.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import { CHAVE_TERMOS, aceitarTermosFn, termosPendentesFn } from "@/lib/termos.functions";

export function AceiteTermos() {
  const queryClient = useQueryClient();
  const pendentesFn = useServerFn(termosPendentesFn);
  const aceitarFn = useServerFn(aceitarTermosFn);
  const q = useQuery({
    queryKey: CHAVE_TERMOS,
    queryFn: () => pendentesFn(),
    staleTime: 10 * 60_000,
  });
  const [marcado, setMarcado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const pendente = q.data;
  if (!pendente) return null;

  async function aceitar() {
    if (!pendente) return;
    setEnviando(true);
    try {
      await aceitarFn({ data: { versao: pendente.versao } });
      await queryClient.invalidateQueries({ queryKey: CHAVE_TERMOS });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível registrar o aceite.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="termos-titulo"
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
    >
      <div className="flex w-full max-w-md flex-col gap-4 rounded-card bg-card p-5 shadow-lg">
        <h2 id="termos-titulo" className="text-lg font-bold">
          Termos de uso e privacidade
        </h2>
        <p className="text-sm text-muted-foreground">
          Para continuar usando o Nexa OS, leia e aceite os termos de uso e a política de
          privacidade (versão {pendente.versao}).
        </p>
        {pendente.url ? (
          <a
            href={pendente.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center text-sm font-bold text-marca underline"
          >
            Abrir os termos
          </a>
        ) : null}
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={marcado}
            onChange={(e) => setMarcado(e.target.checked)}
          />
          Li e aceito os termos de uso e a política de privacidade.
        </label>
        <Botao larguraTotal disabled={!marcado || enviando} onClick={() => void aceitar()}>
          {enviando ? "Registrando…" : "Continuar"}
        </Botao>
      </div>
    </div>
  );
}
