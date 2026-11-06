// Callback de desautorizar do app "Nexa OS" (formato da Meta): a pessoa removeu o app nas
// configurações do Facebook. Valida o signed_request com o App Secret e registra; a Meta só espera
// 200. Não desliga nenhuma conexão sozinho (o WhatsApp da empresa continua até ela desconectar).
import { gerarCodigo, json, lerSignedRequest } from "../_compartilhado/meta.ts";
import { bancoServidor, config } from "../_compartilhado/servidor.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Método não permitido.", { status: 405 });
  let signed = "";
  const tipo = req.headers.get("Content-Type") ?? "";
  if (tipo.includes("application/json")) {
    signed =
      ((await req.json().catch(() => ({}))) as { signed_request?: string }).signed_request ?? "";
  } else {
    signed = String((await req.formData().catch(() => null))?.get("signed_request") ?? "");
  }
  const payload = await lerSignedRequest(signed, config().appSecret);
  if (!payload) return json({ erro: "signed_request inválido." }, 400);
  const { error } = await bancoServidor()
    .from("meta_exclusao_pedidos")
    .insert({
      codigo: gerarCodigo(),
      origem: "desautorizar",
      meta_user_id: payload.user_id.slice(0, 100),
    });
  if (error) {
    console.error("nexa-meta-desautorizar: falha ao gravar", error.code);
    return json({ erro: "Falha ao registrar." }, 500);
  }
  return json({ ok: true });
});
