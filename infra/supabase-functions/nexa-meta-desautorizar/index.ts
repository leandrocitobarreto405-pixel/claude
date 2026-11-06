// Callback de desautorizar do app "Nexa OS" (formato da Meta): a pessoa removeu o app nas
// configurações do Facebook. Valida o signed_request com o App Secret, registra o pedido e marca a
// conexão da empresa que essa pessoa autorizou como "desautorizado". Não apaga nada sozinho (token,
// eventos e o vínculo ficam; a equipe da Nexa decide). A Meta só espera 200.
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
  const { data: marcadas } = await bancoServidor()
    .from("whatsapp_cloud_conexoes")
    .update({ situacao: "desautorizado", desautorizado_em: new Date().toISOString() })
    .eq("meta_user_id", payload.user_id.slice(0, 100))
    .select("empresa_id");
  return json({ ok: true, conexoes: (marcadas ?? []).length });
});
