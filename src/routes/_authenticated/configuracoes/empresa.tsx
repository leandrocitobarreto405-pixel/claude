import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { LinkDeConfig, PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { MetaCustos } from "@/components/configuracoes/meta-custos";

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
      <SecaoConfig titulo="Metas e custos" aberta>
        <MetaCustos />
      </SecaoConfig>
    </PaginaGrupo>
  ),
});
