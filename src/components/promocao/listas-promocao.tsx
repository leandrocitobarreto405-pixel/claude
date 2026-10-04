import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Botao } from "@/components/nexa";
import { FAMILIAS_PROMOCAO, type Filtros, type FiltroFamilia } from "@/lib/listas";
import { cn } from "@/lib/utils";

const mesmoFiltro = (a: FiltroFamilia | undefined, b: FiltroFamilia) => a?.ate === b.ate;

/**
 * Escolha das listas da promoção: uma opção "até X dias" por família, ou não incluir.
 * A promoção junta as listas sem repetir pessoa.
 */
export function EscolherListasPromocao({
  aberto,
  fechar,
  listas,
  salvar,
}: {
  aberto: boolean;
  fechar: () => void;
  listas: Filtros;
  salvar: (l: Filtros) => Promise<void>;
}) {
  const [rascunho, setRascunho] = useState<Filtros>(listas);
  const [salvando, setSalvando] = useState(false);
  return (
    <Sheet
      open={aberto}
      onOpenChange={(v) => {
        if (v) setRascunho(listas);
        else fechar();
      }}
    >
      <SheetContent
        side="bottom"
        onOpenAutoFocus={() => setRascunho(listas)}
        className="max-h-[88vh] overflow-y-auto rounded-t-card-lg p-4 pb-[max(env(safe-area-inset-bottom),1rem)]"
      >
        <SheetTitle className="font-titulo text-2xl">Quem recebe a promoção</SheetTitle>
        <SheetDescription>
          Escolha uma opção em cada lista. As pessoas das listas escolhidas são juntadas sem
          repetir. Quem tem serviço marcado nunca recebe.
        </SheetDescription>
        <div className="mt-4 flex flex-col gap-4">
          {FAMILIAS_PROMOCAO.map((def) => {
            const atual = rascunho[def.familia];
            const opcao = (rotulo: string, ativo: boolean, valor: FiltroFamilia | null) => (
              <button
                key={rotulo}
                type="button"
                aria-pressed={ativo}
                onClick={() => {
                  const n = { ...rascunho };
                  if (valor) n[def.familia] = valor;
                  else delete n[def.familia];
                  setRascunho(n);
                }}
                className={cn(
                  "min-h-11 rounded-full border px-3 text-sm font-semibold",
                  ativo
                    ? "border-marca bg-marca text-marca-foreground"
                    : "border-border bg-card text-foreground",
                )}
              >
                {rotulo}
              </button>
            );
            return (
              <section key={def.familia} className="flex flex-col gap-2">
                <div>
                  <h3 className="text-[15px] font-bold">{def.nome}</h3>
                  <p className="text-xs text-muted-foreground">{def.explicacao}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {opcao("Não incluir", !atual, null)}
                  {def.opcoes.map((o) =>
                    opcao(o.rotulo, Boolean(atual) && mesmoFiltro(atual, o.filtro), o.filtro),
                  )}
                </div>
              </section>
            );
          })}
          <Botao
            tamanho="grande"
            larguraTotal
            disabled={salvando || Object.keys(rascunho).length === 0}
            onClick={async () => {
              setSalvando(true);
              try {
                await salvar(rascunho);
                fechar();
              } finally {
                setSalvando(false);
              }
            }}
          >
            {salvando
              ? "Salvando…"
              : Object.keys(rascunho).length === 0
                ? "Escolha pelo menos uma lista"
                : "Salvar listas"}
          </Botao>
        </div>
      </SheetContent>
    </Sheet>
  );
}
