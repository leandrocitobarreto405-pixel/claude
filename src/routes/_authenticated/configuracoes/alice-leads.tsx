import { createFileRoute } from "@tanstack/react-router";
import { Link2, Megaphone, Upload } from "lucide-react";
import { LinkDeConfig, PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { Listas } from "@/components/configuracoes/listas";
import { AliceConfig } from "@/components/alice-config";
import { LeadsSiteConfig } from "@/components/leads-site-config";
import { MensagensOrigem } from "@/components/mensagens-origem";

export const Route = createFileRoute("/_authenticated/configuracoes/alice-leads")({
  head: () => ({ meta: [{ title: "Configurações: Alice, leads e marketing — Nexa OS" }] }),
  component: () => (
    <PaginaGrupo grupo="alice-leads">
      <SecaoConfig titulo="Alice" aberta>
        <AliceConfig />
      </SecaoConfig>
      <SecaoConfig titulo="Leads do site">
        <LeadsSiteConfig />
      </SecaoConfig>
      <SecaoConfig titulo="Listas de marketing e mensagens por origem">
        <div className="grid gap-6">
          <Listas />
          <MensagensOrigem />
        </div>
      </SecaoConfig>
      <LinkDeConfig
        to="/crm/integracoes"
        titulo="Integrações de leads"
        descricao="Webhooks e formulários que criam leads"
        icone={Link2}
      />
      <LinkDeConfig
        to="/crm/importar"
        titulo="Importar histórico"
        descricao="Planilha de leads antigos"
        icone={Upload}
      />
      <LinkDeConfig
        to="/crm/campanhas"
        titulo="Campanhas Google"
        descricao="Campanhas, investimento e identificação"
        icone={Megaphone}
      />
    </PaginaGrupo>
  ),
});
