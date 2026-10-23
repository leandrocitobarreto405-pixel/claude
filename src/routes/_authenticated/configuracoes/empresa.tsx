import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { LinkDeConfig, PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { MetaCustos } from "@/components/configuracoes/meta-custos";
import { DadosEmpresa } from "@/components/configuracoes/dados-empresa";
import { AssinaturaDaEmpresa } from "@/components/assinatura/assinatura-da-empresa";

export const Route = createFileRoute("/_authenticated/configuracoes/empresa")({
  head: () => ({ meta: [{ title: "Configurações: empresa — Nexa OS" }] }),
  component: () => (
    <PaginaGrupo grupo="empresa">
      <LinkDeConfig
        to="/configuracoes/equipe"
        titulo="Equipe e acessos"
        descricao="Logins, convites, vendedoras e técnicos"
        icone={Users}
      />
      <SecaoConfig titulo="Dados nos documentos">
        <DadosEmpresa />
      </SecaoConfig>
      <SecaoConfig titulo="Metas e custos" aberta>
        <MetaCustos />
      </SecaoConfig>
      <SecaoConfig titulo="Assinatura e faturas">
        <AssinaturaDaEmpresa />
      </SecaoConfig>
    </PaginaGrupo>
  ),
});
