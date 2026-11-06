// Callback de exclusão de dados do app "Nexa OS" (formato da Meta).
// POST (form ou JSON) com signed_request: valida com o App Secret, registra o pedido e devolve
// { url, confirmation_code }. GET ?codigo=XXXX: situação do pedido (usado pela página
// /exclusao-de-dados). Não apaga nada sozinho: a equipe da Nexa conclui o pedido no prazo.
import {
  cabecalhosCors,
  gerarCodigo,
  json,
  lerSignedRequest,
  ORIGEM_APP,
} from "../_compartilhado/meta.ts";
import { bancoServidor, config } from "../_compartilhado/servidor.ts";

const SITUACAO: Record<string, string> = {
  recebido: "Pedido recebido",
  em_andamento: "Em andamento",
  concluido: "Concluído",
};

async function signedRequestDe(req: Request): Promise<string> {
  const tipo = req.headers.get("Content-Type") ?? "";
  if (tipo.includes("application/json")) {
    const b = (await req.json().catch(() => ({}))) as { signed_request?: string };
    return b.signed_request ?? "";
  }
  const f = await req.formData().catch(() => null);
  return String(f?.get("signed_request") ?? "");
}

Deno.serve(async (req: Request) => {
  const cors = cabecalhosCors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const db = bancoServidor();

  if (req.method === "GET") {
    const codigo = (new URL(req.url).searchParams.get("codigo") ?? "").toUpperCase();
    if (!/^[A-Z0-9]{10,32}$/.test(codigo)) return json({ erro: "Código inválido." }, 400, cors);
    const { data } = await db
      .from("meta_exclusao_pedidos")
      .select("situacao, criado_em, concluido_em")
      .eq("codigo", codigo)
      .maybeSingle();
    if (!data) return json({ erro: "Pedido não encontrado." }, 404, cors);
    const d = data as { situacao: string; criado_em: string; concluido_em: string | null };
    return json(
      {
        codigo,
        situacao: SITUACAO[d.situacao] ?? d.situacao,
        recebido_em: d.criado_em,
        concluido_em: d.concluido_em,
      },
      200,
      cors,
    );
  }
  if (req.method !== "POST") return new Response("Método não permitido.", { status: 405 });

  const payload = await lerSignedRequest(await signedRequestDe(req), config().appSecret);
  if (!payload) return json({ erro: "signed_request inválido." }, 400);
  const codigo = gerarCodigo();
  const { error } = await db
    .from("meta_exclusao_pedidos")
    .insert({ codigo, origem: "exclusao", meta_user_id: payload.user_id.slice(0, 100) });
  if (error) {
    console.error("nexa-meta-exclusao: falha ao gravar", error.code);
    return json({ erro: "Falha ao registrar o pedido." }, 500);
  }
  return json({
    url: `${ORIGEM_APP}/exclusao-de-dados?codigo=${codigo}`,
    confirmation_code: codigo,
  });
});
