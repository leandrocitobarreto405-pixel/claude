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
          // Retirada/entrega de persiana e tapete: tarefa da equipe na véspera (nada vai ao cliente).
          const { rodarVesperaRetirada } = await import("@/lib/retirada-vespera.server");
          const vesperaRetirada = await rodarVesperaRetirada().catch((e) => {
            console.error("Retirada: falha na véspera", e instanceof Error ? e.message : e);
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
          // Visita que passou da data sem conclusão nem nova data: tarefa P1 "remarcar" da equipe
          // (fecha sozinha quando a visita é concluída ou remarcada). Não depende da Tatiana.
          const { rodarVisitasVencidas } = await import("@/lib/visita-vencida.server");
          const visitasVencidas = await rodarVisitasVencidas().catch((e) => {
            console.error("Visita vencida: falha", e instanceof Error ? e.message : e);
            return null;
          });
          // Transferência da Alice sem resposta: push à equipe de 5 em 5 minutos, no horário de
          // atendimento, até alguém responder na conversa (só com a chave ligada na empresa).
          const { rodarAlarmeDeTransferencias } = await import("@/lib/alice/transferencia.server");
          const transferencias = await rodarAlarmeDeTransferencias().catch((e) => {
            console.error("Alarme de transferência: falha", e instanceof Error ? e.message : e);
            return null;
          });
          // Alice fora do ar com cliente esperando: push só para o admin (chave por empresa).
          const { rodarAvisoForaDoAr } = await import("@/lib/alice/fora-do-ar.server");
          const foraDoAr = await rodarAvisoForaDoAr().catch((e) => {
            console.error("Alice fora do ar: falha", e instanceof Error ? e.message : e);
            return null;
          });
          // Alarme de vaga na agenda: push às 8h30, 10h30, 13h30 e 16h enquanto houver vaga.
          const { rodarAlarmeDeVagas } = await import("@/lib/vagas.server");
          const alarmeDeVagas = await rodarAlarmeDeVagas().catch((e) => {
            console.error("Alarme de vaga: falha", e instanceof Error ? e.message : e);
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
          // Ensaio da fase 2 de "Alice e vendas" (aprovado pelo dono): uma conversa por rodada, até
          // as três; nada vai a cliente. Fica por último para não atrasar o resto.
          const { rodarEnsaioVendasPendente } = await import("@/lib/alice/ensaio-vendas.server");
          const ensaioVendas = await rodarEnsaioVendasPendente().catch((e) => {
            console.error("Ensaio Alice e vendas: falha", e instanceof Error ? e.message : e);
            return null;
          });
          return json({
            ok: true,
            ensaioVendas,
            encerramento,
            ...fila,
            anuncios,
            posAtendimento,
            vesperaRetirada,
            leadsSite,
            vinculoOs,
            temperaturas,
            retornosExpirados,
            servicosNaoConcluidos,
            visitasVencidas,
            alarmeDeVagas,
            transferencias,
            foraDoAr,
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
