import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Rede de segurança da fila da Alice (Cloud Scheduler a cada 5–10 min): entrega à fila o que ficou
 * de fora e processa tarefas atrasadas (fila perdida, servidor reiniciado).
 * Autenticação: Authorization: Bearer $NEXA_TAREFAS_SEGREDO.
 */
export const Route = createFileRoute("/api/public/hooks/alice-varredura")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { tarefaAutorizada } = await import("@/lib/robo.server");
        if (!tarefaAutorizada(request)) return json({ error: "Não autorizado." }, 401);
        try {
          const { varrerFila } = await import("@/lib/alice/fila.server");
          const { iniciarContatosPendentes } = await import("@/lib/ads/alice-contato.server");
          const fila = await varrerFila();
          // Fase 2 dos anúncios (desligada por padrão): Alice inicia a conversa do pop-up.
          const anuncios = await iniciarContatosPendentes().catch((e) => {
            console.error("[ads] alice_contato.falha", e);
            return null;
          });
          // Confirmação na véspera e pós-venda (cada chave começa desligada por empresa).
          const { rodarPosAtendimento } = await import("@/lib/alice/pos-atendimento.server");
          const posAtendimento = await rodarPosAtendimento().catch((e) => {
            console.error("Alice: falha no pós-atendimento", e);
            return null;
          });
          // Leads do site: planilhas das LPs, quem chamou, avisos só no app (envio desligado).
          const { rodarLeadsSite } = await import("@/lib/leads-site.server");
          const leadsSite = await rodarLeadsSite().catch((e) => {
            console.error("Leads do site: falha", e instanceof Error ? e.message : e);
            return null;
          });
          // OS criada sem lead: liga ao único lead aberto com o mesmo telefone (antes da exportação).
          const { ligarOsSemLead } = await import("@/lib/crm-vinculo.server");
          const vinculoOs = await ligarOsSemLead().catch((e) => {
            console.error("CRM: falha no vínculo de OS", e instanceof Error ? e.message : e);
            return null;
          });
          // Google Ads: exportação diária das vendas (uma vez por dia, a partir das 5h).
          const { exportacaoDiaria } = await import("@/lib/ads/exportar-google.server");
          const exportacaoGoogle = await exportacaoDiaria()
            .then((r) => r.map(({ linhas: _l, ...x }) => x))
            .catch((e) => {
              console.error(
                "Google Ads: falha na exportação diária",
                e instanceof Error ? e.message : e,
              );
              return null;
            });
          return json({
            ok: true,
            ...fila,
            anuncios,
            posAtendimento,
            leadsSite,
            vinculoOs,
            exportacaoGoogle,
          });
        } catch (erro) {
          console.error("Alice: falha na varredura", erro);
          return json({ ok: false, error: "Falha temporária." }, 500);
        }
      },
    },
  },
});
