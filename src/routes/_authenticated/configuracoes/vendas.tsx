import { createFileRoute } from "@tanstack/react-router";
import { PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { Taxas } from "@/components/configuracoes/taxas";
import { CuponsConfig } from "@/components/configuracoes/cupons";
import { RegraNotaFiscal } from "@/components/configuracoes/nota-fiscal";
import { TabelaPrecosConfig } from "@/components/tabela-precos-config";
import { OrcamentoRegrasConfig } from "@/components/orcamento-regras-config";
import { ControleInsumosCard, ProdutosConfig } from "@/components/produtos-config";
import { useControleInsumos } from "@/lib/produtos";

export const Route = createFileRoute("/_authenticated/configuracoes/vendas")({
  head: () => ({ meta: [{ title: "Configurações: vendas — Nexa OS" }] }),
  component: Vendas,
});

function Vendas() {
  const { ativo: controleInsumos } = useControleInsumos();
  return (
    <PaginaGrupo grupo="vendas">
      <SecaoConfig titulo="Tabela de preços" aberta>
        <TabelaPrecosConfig />
      </SecaoConfig>
      <SecaoConfig titulo="Regras de orçamento">
        <OrcamentoRegrasConfig />
      </SecaoConfig>
      <SecaoConfig titulo="Cupons">
        <CuponsConfig />
      </SecaoConfig>
      <SecaoConfig titulo="Nota fiscal">
        <RegraNotaFiscal />
      </SecaoConfig>
      <SecaoConfig titulo="Taxas de pagamento">
        <Taxas />
      </SecaoConfig>
      <SecaoConfig titulo="Produtos e insumos">
        <div className="grid gap-6">
          <ControleInsumosCard />
          {controleInsumos ? <ProdutosConfig /> : null}
        </div>
      </SecaoConfig>
    </PaginaGrupo>
  );
}
