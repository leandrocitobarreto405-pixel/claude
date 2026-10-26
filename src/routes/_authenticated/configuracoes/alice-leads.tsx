import { createFileRoute } from "@tanstack/react-router";
import { ComRecurso } from "@/components/plano/recurso-bloqueado";
import { Link2, Megaphone, Upload } from "lucide-react";
import { LinkDeConfig, PaginaGrupo, SecaoConfig } from "@/components/configuracoes/pagina-grupo";
import { Listas } from "@/components/configuracoes/listas";
import { AliceConfig } from "@/components/alice-config";
import { EnsaioNome } from "@/components/alice/ensaio-nome";
import { AliceAudio } from "@/components/configuracoes/alice-audio";
import { LeadsSiteConfig } from "@/components/leads-site-config";
import { MensagensOrigem } from "@/components/mensagens-origem";

export const Route = createFileRoute("/_authenticated/configuracoes/alice-leads")({
  head: () => ({ meta: [{ title: "Configurações: Alice, leads e marketing — Nexa OS" }] }),
  component: () => (
    <PaginaGrupo grupo="alice-leads">
      <SecaoConfig titulo="Alice" aberta>
        <ComRecurso recurso="alice">
          <AliceConfig />
        </ComRecurso>
      </SecaoConfig>
      <SecaoConfig titulo="Alice: ensaio do nome do cliente">
        <ComRecurso recurso="alice">
          <EnsaioNome />
        </ComRecurso>
      </SecaoConfig>
      <SecaoConfig titulo="Alice: responder em áudio">
        <ComRecurso recurso="alice">
          <AliceAudio />
        </ComRecurso>
      </SecaoConfig>
      <SecaoConfig titulo="Leads do site">
        <ComRecurso recurso="crm">
          <LeadsSiteConfig />
        </ComRecurso>
      </SecaoConfig>
      <SecaoConfig titulo="Listas de marketing e mensagens por origem">
        <ComRecurso recurso="marketing">
          <div className="grid gap-6">
            <Listas />
            <MensagensOrigem />
          </div>
        </ComRecurso>
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
