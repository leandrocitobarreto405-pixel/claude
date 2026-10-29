/**
 * Anexos das mensagens (áudio, foto, documento) servidos pelo app: o navegador pede
 * GET /api/anexo/<id da mensagem> com o token da pessoa; o servidor confere a mensagem pelo RLS,
 * acha o arquivo no Chatwoot (evento do webhook ou API, com o token da conexão, que nunca vai ao
 * navegador) e devolve os bytes.
 */
type Anexo = { file_type?: string; data_url?: string; extension?: string | null };

const TIPO_PADRAO: Record<string, string> = {
  audio: "audio/ogg",
  image: "image/jpeg",
  video: "video/mp4",
  file: "application/octet-stream",
};

/**
 * Tempo de cada etapa (mensagem no banco, achar o anexo, primeira resposta do Chatwoot) no
 * registro do servidor e no cabeçalho Server-Timing. Só números: nenhum id nem dado de cliente.
 */
function registrarTempos(t: {
  mensagemMs: number;
  anexoMs?: number;
  origemMs?: number;
  fonte?: "evento" | "api";
  status: number;
  bytes?: number | null;
}) {
  console.log(`Anexo: tempos ${JSON.stringify(t)}`);
}

export async function servirAnexo(request: Request, mensagemId: string): Promise<Response> {
  if (!/^[0-9a-f-]{36}$/i.test(mensagemId)) return json({ error: "Não encontrado." }, 404);
  const t0 = performance.now();
  const ms = (desde: number) => Math.round(performance.now() - desde);
  const { clienteDoPedido } = await import("@/integrations/supabase/auth-middleware");
  let supabase: Awaited<ReturnType<typeof clienteDoPedido>>["supabase"];
  try {
    ({ supabase } = await clienteDoPedido(request.headers));
  } catch {
    return json({ error: "Não autorizado." }, 401);
  }
  const { data: m } = await supabase
    .from("whatsapp_messages")
    .select("id, conversa_id, chatwoot_message_id, raw_event_reference, message_type")
    .eq("id", mensagemId)
    .maybeSingle();
  if (!m || !m.conversa_id) return json({ error: "Não encontrado." }, 404);
  const mensagemMs = ms(t0);

  const t1 = performance.now();
  const { anexos, fonte } = await anexosDaMensagem(
    m.conversa_id,
    m.chatwoot_message_id == null ? null : Number(m.chatwoot_message_id),
    m.raw_event_reference ?? null,
  );
  const n = Math.max(0, Number(new URL(request.url).searchParams.get("n") ?? 0) || 0);
  const anexo = anexos[n];
  const anexoMs = ms(t1);
  if (!anexo?.data_url) {
    registrarTempos({ mensagemMs, anexoMs, fonte, status: 404 });
    return json({ error: "Mensagem sem arquivo." }, 404);
  }

  const t2 = performance.now();
  let origem: Response;
  try {
    origem = await fetch(anexo.data_url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    registrarTempos({ mensagemMs, anexoMs, origemMs: ms(t2), fonte, status: 502 });
    return json({ error: "O arquivo não está disponível agora." }, 502);
  }
  const origemMs = ms(t2);
  if (!origem.ok || !origem.body) {
    registrarTempos({ mensagemMs, anexoMs, origemMs, fonte, status: 502 });
    return json({ error: "O arquivo não está disponível." }, 502);
  }
  const tipo =
    origem.headers.get("content-type")?.split(";")[0] ||
    TIPO_PADRAO[anexo.file_type ?? "file"] ||
    "application/octet-stream";
  const cabecalhos: Record<string, string> = {
    "Content-Type": tipo,
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": "inline",
    "X-Content-Type-Options": "nosniff",
  };
  const tamanho = origem.headers.get("content-length");
  if (tamanho) cabecalhos["Content-Length"] = tamanho;
  cabecalhos["Server-Timing"] =
    `mensagem;dur=${mensagemMs}, anexo;dur=${anexoMs}, origem;dur=${origemMs}`;
  registrarTempos({
    mensagemMs,
    anexoMs,
    origemMs,
    fonte,
    status: 200,
    bytes: tamanho ? Number(tamanho) : null,
  });
  return new Response(origem.body, { status: 200, headers: cabecalhos });
}

/** Anexos pelo evento do webhook (mensagens recebidas) ou pela API (as que o app mandou). */
async function anexosDaMensagem(
  conversaId: string,
  chatwootMessageId: number | null,
  eventoId: string | null,
): Promise<{ anexos: Anexo[]; fonte: "evento" | "api" }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  if (eventoId) {
    const { data: ev } = await supabaseAdmin
      .from("integracao_eventos")
      .select("payload")
      .eq("id", eventoId)
      .maybeSingle();
    const lista = (ev?.payload as { attachments?: Anexo[] } | null)?.attachments;
    if (lista?.length) return { anexos: lista, fonte: "evento" };
  }
  const vazio = { anexos: [] as Anexo[], fonte: "api" as const };
  if (chatwootMessageId == null) return vazio;
  const { data: conv } = await supabaseAdmin
    .from("conversas")
    .select("chatwoot_conversation_id, conexao_id")
    .eq("id", conversaId)
    .maybeSingle();
  if (!conv) return vazio;
  const [{ data: cx }, { data: sg }] = await Promise.all([
    supabaseAdmin
      .from("chatwoot_conexoes")
      .select("base_url, account_id")
      .eq("id", conv.conexao_id)
      .maybeSingle(),
    supabaseAdmin
      .from("chatwoot_conexao_segredos")
      .select("api_token")
      .eq("conexao_id", conv.conexao_id)
      .maybeSingle(),
  ]);
  if (!cx || !sg?.api_token) return vazio;
  const { chamar } = await import("@/lib/alice/chatwoot-api.server");
  const r = await chamar<{ payload?: Array<{ id: number; attachments?: Anexo[] }> }>(
    { baseUrl: cx.base_url, accountId: Number(cx.account_id) },
    sg.api_token,
    `/conversations/${conv.chatwoot_conversation_id}/messages?before=${chatwootMessageId + 1}`,
  ).catch(() => null);
  const msg = r?.payload?.find((x) => Number(x.id) === chatwootMessageId);
  return { anexos: msg?.attachments ?? [], fonte: "api" };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
