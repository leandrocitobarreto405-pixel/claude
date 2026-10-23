import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Avisos do Asaas (cobranças das faturas da assinatura). Confere o cabeçalho asaas-access-token
 * com ASAAS_WEBHOOK_TOKEN; o banco guarda cada aviso uma vez e atualiza fatura e assinatura.
 */
export const Route = createFileRoute("/api/public/hooks/pagamentos")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { avisoAutorizado } = await import("@/lib/asaas.server");
        if (!process.env["ASAAS_WEBHOOK_TOKEN"]) return json({ error: "Não configurado." }, 503);
        if (!avisoAutorizado(request.headers.get("asaas-access-token")))
          return json({ error: "Não autorizado." }, 401);

        const corpo = (await request.json().catch(() => null)) as unknown;
        const { lerAvisoAsaas } = await import("@/lib/asaas");
        const aviso = lerAvisoAsaas(corpo);
        // Aviso que não é de cobrança: responde 200 para o Asaas não ficar repetindo.
        if (!aviso) return json({ ok: true, ignorado: true });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("registrar_evento_pagamento", {
          _evento_id: aviso.eventoId,
          _evento: aviso.evento,
          _cobranca_id: aviso.cobrancaId,
          _payload: corpo as never,
        });
        if (error) {
          console.error("Asaas: falha ao registrar aviso:", aviso.evento, error.message);
          return json({ ok: false }, 500);
        }
        const r = (data ?? {}) as { resultado?: string; fatura_id?: string; status?: string };
        if (r.resultado === "processado" && r.status === "vencida" && r.fatura_id) {
          const { avisarFaturaVencida } = await import("@/lib/cobranca-email.server");
          await avisarFaturaVencida(supabaseAdmin, r.fatura_id).catch(() => 0);
        }
        return json({ ok: true, resultado: r.resultado ?? null });
      },
    },
  },
});
