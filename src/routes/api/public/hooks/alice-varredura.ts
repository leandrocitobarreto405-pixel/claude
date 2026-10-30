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
          // Encerramento automático de conversas paradas (cada empresa liga em Configurações).
          const { rodarEncerramentoAutomatico } = await import("@/lib/caixa-encerramento.server");
          const encerramento = await rodarEncerramentoAutomatico().catch((e) => {
            console.error("Conversas: falha no encerramento automático", e);
            return null;
          });
          // Leads do site: planilhas das LPs, quem chamou, avisos só no app (envio desligado).
          const { rodarLeadsSite } = await import("@/lib/leads-site.server");
          const leadsSite = await rodarLeadsSite().catch((e) => {
            console.error("Leads do site: falha", e instanceof Error ? e.message : e);
            return null;
          });
          // Retornos da equipe vencidos há mais de 3 dias saem da lista.
          const { expirarRetornos } = await import("@/lib/retornos.server");
          const retornosExpirados = await expirarRetornos().catch((e) => {
            console.error("CRM: falha ao expirar retornos", e instanceof Error ? e.message : e);
            return null;
          });
          // OS criada sem lead: liga ao único lead aberto com o mesmo telefone (antes da exportação).
          const { ligarOsSemLead } = await import("@/lib/crm-vinculo.server");
          const vinculoOs = await ligarOsSemLead().catch((e) => {
            console.error("CRM: falha no vínculo de OS", e instanceof Error ? e.message : e);
            return null;
          });
          // Temperatura por eventos (Quente/Morno/Frio e retorno combinado), depois do vínculo de OS.
          const { rodarTemperaturas } = await import("@/lib/temperatura.server");
          const temperaturas = await rodarTemperaturas().catch((e) => {
            console.error("CRM: falha na temperatura", e instanceof Error ? e.message : e);
            return null;
          });
          // Serviço de data passada ainda "Agendado" depois de 1 dia: aviso só no app, por visita.
          const { avisarServicosNaoConcluidos } = await import("@/lib/avisos.server");
          const servicosNaoConcluidos = await avisarServicosNaoConcluidos().catch((e) => {
            console.error(
              "Avisos: falha nos serviços não concluídos",
              e instanceof Error ? e.message : e,
            );
            return null;
          });
          // "Precisa de você": resumo do dia no sininho às 10h (só no app).
          const { avisoDasDezPrecisa } = await import("@/lib/precisa-de-voce.server");
          const precisaResumo = await avisoDasDezPrecisa().catch((e) => {
            console.error(
              "Precisa de você: falha no aviso das 10h",
              e instanceof Error ? e.message : e,
            );
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
          // Freio: com o banco lento (consulta simples acima de 2 s), os trabalhos pesados sem
          // pressa (lotes da gerente e Tatiana) ficam para o minuto seguinte.
          const { bancoLento } = await import("@/lib/freio.server");
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const freio = await bancoLento(supabaseAdmin);
          // Gerente comercial: lotes de análise pedidos (só leitura; ligado por empresa).
          const { rodarLotesComerciais } = await import("@/lib/comercial/lotes.server");
          const comercial = freio.lento
            ? { adiado: true, ms: freio.ms }
            : await rodarLotesComerciais().catch((e) => {
                console.error(
                  "Gerente comercial: falha no lote",
                  e instanceof Error ? e.message : e,
                );
                return null;
              });
          // Tatiana: passada da noite (21h30), recados, pushes e conferência (modo por empresa).
          const { rodarTatiana } = await import("@/lib/comercial/noite.server");
          const tatiana = freio.lento
            ? { adiado: true, ms: freio.ms }
            : await rodarTatiana().catch((e) => {
                console.error("Tatiana: falha na passada", e instanceof Error ? e.message : e);
                return null;
              });
          return json({
            ok: true,
            encerramento,
            ...fila,
            anuncios,
            posAtendimento,
            leadsSite,
            vinculoOs,
            temperaturas,
            retornosExpirados,
            servicosNaoConcluidos,
            precisaResumo,
            exportacaoGoogle,
            comercial,
            tatiana,
          });
        } catch (erro) {
          console.error("Alice: falha na varredura", erro);
          return json({ ok: false, error: "Falha temporária." }, 500);
        }
      },
    },
  },
});
