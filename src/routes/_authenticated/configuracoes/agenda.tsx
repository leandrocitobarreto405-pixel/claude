import { createFileRoute } from "@tanstack/react-router";
import { CalendarCog } from "lucide-react";
import { LinkDeConfig, PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { GoogleAgenda } from "@/components/configuracoes/google-agenda";
import { ContaGoogle } from "@/components/conta-google";

export const Route = createFileRoute("/_authenticated/configuracoes/agenda")({
  head: () => ({ meta: [{ title: "Configurações: agenda — Nexa OS" }] }),
  component: () => (
    <PaginaGrupo grupo="agenda">
      <LinkDeConfig
        to="/agenda-config"
        titulo="Agenda e promoção"
        descricao="Horários dos técnicos, veículos e promoção de dia vago"
        icone={CalendarCog}
      />
      <SecaoConfig titulo="Google Agenda" aberta>
        <div className="grid gap-6">
          <ContaGoogle />
          <GoogleAgenda />
        </div>
      </SecaoConfig>
    </PaginaGrupo>
  ),
});
