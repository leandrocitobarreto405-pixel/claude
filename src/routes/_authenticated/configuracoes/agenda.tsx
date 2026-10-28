import { createFileRoute } from "@tanstack/react-router";
import { CalendarCog } from "lucide-react";
import { LinkDeConfig, PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { GoogleAgenda } from "@/components/configuracoes/google-agenda";
import { ContaGoogle } from "@/components/conta-google";
import { AgendaTecnicos } from "@/components/configuracoes/agenda-tecnicos";

export const Route = createFileRoute("/_authenticated/configuracoes/agenda")({
  head: () => ({ meta: [{ title: "Configurações: agenda — Nexa OS" }] }),
  component: () => (
    <PaginaGrupo grupo="agenda">
      <LinkDeConfig
        to="/agenda-config"
        titulo="Agenda e técnicos"
        descricao="Horários dos técnicos, veículos, rodízio e contatos internos"
        icone={CalendarCog}
      />
      <SecaoConfig titulo="Agenda dos técnicos no WhatsApp">
        <AgendaTecnicos />
      </SecaoConfig>
      <SecaoConfig titulo="Google Agenda" aberta>
        <div className="grid gap-6">
          <ContaGoogle />
          <GoogleAgenda />
        </div>
      </SecaoConfig>
    </PaginaGrupo>
  ),
});
