import { createFileRoute } from "@tanstack/react-router";
import { Bell, Route as RouteIcon } from "lucide-react";
import { LinkDeConfig, PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { Recorrentes } from "@/components/configuracoes/recorrentes";

export const Route = createFileRoute("/_authenticated/configuracoes/outros")({
  head: () => ({ meta: [{ title: "Configurações: outros — Nexa OS" }] }),
  component: () => (
    <PaginaGrupo grupo="outros">
      <SecaoConfig titulo="Despesas recorrentes" aberta>
        <Recorrentes />
      </SecaoConfig>
      <LinkDeConfig
        to="/rotas"
        titulo="Rotas e quilometragem"
        descricao="Rotas do dia, custo por km e fechamento do mês"
        icone={RouteIcon}
      />
      <LinkDeConfig
        to="/notificacoes"
        titulo="Notificações no celular"
        descricao="Ativar neste celular e escolher o que receber"
        icone={Bell}
      />
    </PaginaGrupo>
  ),
});
