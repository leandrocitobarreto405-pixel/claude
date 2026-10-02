import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Botao, Chip } from "@/components/nexa";
import { ListaEtapas, ProgressoImplantacao } from "@/components/implantacao/checklist";
import { liberarEmpresaFn, type Implantacao } from "@/lib/implantacao.functions";
import { dateBR } from "@/lib/format";

export const CHAVE_IMPLANTACOES_NEXA = ["implantacao", "nexa"] as const;

/** Progresso de uma empresa na tela Empresas (Nexa): ver a lista, liberar ou bloquear. */
export function ImplantacaoDaEmpresa({ dados }: { dados: Implantacao }) {
  const qc = useQueryClient();
  const liberarFn = useServerFn(liberarEmpresaFn);
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const { resumo, liberadaEm } = dados;

  async function mudar(liberar: boolean) {
    const pergunta = liberar
      ? `Liberar ${dados.nome}? A empresa poderá ligar a Alice e os envios para clientes.`
      : `Bloquear ${dados.nome} de novo? A Alice e os envios para clientes são desligados agora.`;
    if (!window.confirm(pergunta)) return;
    setOcupado(true);
    try {
      await liberarFn({ data: { empresaId: dados.empresaId, liberar } });
      await qc.invalidateQueries({ queryKey: ["implantacao"] });
      toast.success(liberar ? "Empresa liberada." : "Empresa bloqueada.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível mudar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Configuração</span>
        {liberadaEm ? (
          <Chip tom="sucesso">Liberada em {dateBR(liberadaEm.slice(0, 10))}</Chip>
        ) : resumo.podeLiberar ? (
          <Chip tom="atencao">Pronta para liberar</Chip>
        ) : (
          <Chip>Em implantação</Chip>
        )}
      </div>
      <ProgressoImplantacao resumo={resumo} />
      <div className="flex flex-wrap gap-2">
        <Botao variante="neutro" onClick={() => setAberto(true)}>
          Ver etapas
        </Botao>
        {liberadaEm ? (
          <Botao variante="neutro" disabled={ocupado} onClick={() => void mudar(false)}>
            Bloquear de novo
          </Botao>
        ) : (
          <Botao disabled={ocupado || !resumo.podeLiberar} onClick={() => void mudar(true)}>
            Liberar empresa
          </Botao>
        )}
      </div>
      {!liberadaEm && !resumo.podeLiberar ? (
        <p className="text-xs text-muted-foreground">
          O botão libera quando as {resumo.obrigatorias.total} etapas obrigatórias estiverem
          prontas.
        </p>
      ) : null}
      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetContent
          side="bottom"
          className="max-h-[88vh] overflow-y-auto rounded-t-card-lg p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
        >
          <SheetTitle className="font-titulo text-2xl">{dados.nome}</SheetTitle>
          <SheetDescription>
            Para resolver uma etapa, abra a empresa e vá em Mais → Configuração da empresa.
          </SheetDescription>
          <div className="mt-4 flex flex-col gap-4">
            <ProgressoImplantacao resumo={resumo} />
            <ListaEtapas etapas={dados.etapas} editavel={false} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
