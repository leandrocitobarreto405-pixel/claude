import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Webhook do Chatwoot (Configurações → Integrações → Webhooks).
 *
 * O token da URL identifica a conexão. Quando a conexão tem "verificar assinatura" ligado,
 * o cabeçalho X-Chatwoot-Signature também é exigido. O evento é gravado e processado no banco
 * (receber_evento_chatwoot), de forma idempotente. O Chatwoot não reenvia avisos que falham,
 * então a resposta é rápida e os eventos com erro ficam guardados para reprocessar.
 */
export const Route = createFileRoute("/api/public/hooks/chatwoot/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          return await receberAviso(request, params.token ?? "");
        } catch (erro) {
          console.error("Chatwoot: erro inesperado no webhook:", erro);
          return json({ error: "Falha temporária." }, 500);
        }
      },
    },
  },
});

async function receberAviso(request: Request, token: string): Promise<Response> {
  if (!/^[a-f0-9]{32,128}$/i.test(token)) return json({ error: "Não encontrado." }, 404);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: conexao, error: erroConexao } = await supabaseAdmin
    .from("chatwoot_conexoes")
    .select("id, ativo, verificar_assinatura")
    .eq("webhook_token", token)
    .maybeSingle();
  if (erroConexao) {
    console.error("Chatwoot: falha ao buscar a conexão:", erroConexao.message);
    return json({ error: "Falha temporária." }, 500);
  }
  if (!conexao || !conexao.ativo) return json({ error: "Não encontrado." }, 404);

  const corpo = await request.text();

  if (conexao.verificar_assinatura) {
    const { data: segredo } = await supabaseAdmin
      .from("chatwoot_conexao_segredos")
      .select("webhook_secret")
      .eq("conexao_id", conexao.id)
      .maybeSingle();
    if (!segredo?.webhook_secret) {
      console.error("Chatwoot: verificação de assinatura ligada sem segredo cadastrado.");
      return json({ error: "Conexão sem segredo configurado." }, 401);
    }
    const { verificarAssinaturaChatwoot } = await import("@/lib/chatwoot.server");
    const resultado = verificarAssinaturaChatwoot(corpo, segredo.webhook_secret, request.headers);
    if (!resultado.ok)
      return json({ error: "Assinatura inválida.", motivo: resultado.motivo }, 401);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(corpo);
  } catch {
    return json({ error: "Payload inválido." }, 400);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json({ error: "Payload inválido." }, 400);
  }

  // Avisos que o Nexa OS não usa (ex.: "digitando...") são descartados sem gravar.
  const { EVENTOS_CHATWOOT } = await import("@/lib/chatwoot.server");
  const evento = (payload as { event?: unknown }).event;
  if (typeof evento === "string" && !(EVENTOS_CHATWOOT as readonly string[]).includes(evento)) {
    return json({ ok: true, status: "descartado", duplicado: false });
  }

  const { data, error } = await supabaseAdmin.rpc("receber_evento_chatwoot", {
    _token: token,
    _delivery_id: request.headers.get("x-chatwoot-delivery") ?? "",
    _payload: payload as never,
  });
  if (error) {
    const mensagem = error.message ?? "";
    if (mensagem.includes("conexao_invalida")) return json({ error: "Não encontrado." }, 404);
    if (mensagem.includes("conta_divergente")) {
      return json({ error: "Evento de outra conta do Chatwoot." }, 403);
    }
    console.error("Chatwoot: falha ao registrar o evento:", mensagem);
    return json({ error: "Falha ao registrar o evento." }, 500);
  }

  const resultado = (data ?? {}) as {
    status?: string;
    duplicado?: boolean;
    evento_id?: string;
  };
  // Mensagens novas podem ter agendado respostas da Alice: entrega à fila (nunca derruba o webhook).
  const { enfileirarPendentes } = await import("@/lib/alice/fila.server");
  await enfileirarPendentes(supabaseAdmin).catch((e) => console.error("Alice: fila:", e));
  return json({
    ok: true,
    evento_id: resultado.evento_id ?? null,
    status: resultado.status ?? (resultado.duplicado ? "duplicado" : null),
    duplicado: Boolean(resultado.duplicado),
  });
}
