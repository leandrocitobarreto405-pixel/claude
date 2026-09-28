import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader, SectionCard } from "@/components/app-shell";
import { useContextoTenant } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/crm/whatsapp")({
  head: () => ({
    meta: [
      { title: "Integração do WhatsApp — Nexa OS" },
      {
        name: "description",
        content: "As conversas do WhatsApp chegam ao Nexa OS pelo Chatwoot.",
      },
    ],
  }),
  component: WhatsappConfig,
});

/**
 * A ligação direta com a API do WhatsApp (Meta) foi desativada (decisão D2): as conversas chegam
 * pelo Chatwoot. A página fica só como aviso para quem tinha o endereço salvo.
 */
function WhatsappConfig() {
  const { data: ctx } = useContextoTenant();
  return (
    <>
      <PageHeader
        title="Integração do WhatsApp"
        description="As conversas do WhatsApp chegam ao Nexa OS pelo Chatwoot."
      />
      <SectionCard title="O WhatsApp agora vem pelo Chatwoot" accent="warning">
        <div className="grid gap-3 text-sm">
          <p>
            A ligação direta com a Meta foi desativada. Cada número de WhatsApp fica numa caixa de
            entrada do Chatwoot, e o Chatwoot avisa o Nexa OS a cada conversa e mensagem. Os leads
            aparecem em CRM → Leads.
          </p>
          <p className="text-muted-foreground">
            O endereço antigo (<code>/api/public/hooks/whatsapp</code>) não recebe mais mensagens.
            Não use esse endereço no Chatwoot.
          </p>
          {ctx?.souNexa ? (
            <div>
              <Button asChild>
                <Link to="/nexa/chatwoot">Abrir a configuração do Chatwoot</Link>
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">A configuração é feita pela equipe da Nexa.</p>
          )}
        </div>
      </SectionCard>
    </>
  );
}
