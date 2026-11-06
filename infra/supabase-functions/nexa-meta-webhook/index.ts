// Webhook do app "Nexa OS" na Meta (WhatsApp Cloud API). NOVO e separado do webhook da Turbine.
// GET: verificação (hub.challenge). POST: confere X-Hub-Signature-256 e grava mensagens e status
// em whatsapp_cloud_eventos, achando a empresa pelo phone_number_id / waba_id. Não responde ao
// cliente, não chama a Alice e não toca no Chatwoot.
import {
  assinaturaValida,
  desafioDaVerificacao,
  json,
  linhasDoWebhook,
} from "../_compartilhado/meta.ts";
import { bancoServidor, config } from "../_compartilhado/servidor.ts";

Deno.serve(async (req: Request) => {
  const c = config();
  const url = new URL(req.url);

  if (req.method === "GET") {
    const desafio = desafioDaVerificacao(url.searchParams, c.verifyToken);
    return desafio === null
      ? new Response("Verificação recusada.", { status: 403 })
      : new Response(desafio, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  if (req.method !== "POST") return new Response("Método não permitido.", { status: 405 });

  const corpoCru = new Uint8Array(await req.arrayBuffer());
  if (!(await assinaturaValida(c.appSecret, corpoCru, req.headers.get("X-Hub-Signature-256")))) {
    console.warn("nexa-meta-webhook: assinatura inválida");
    return json({ erro: "Assinatura inválida." }, 401);
  }
  let corpo: unknown;
  try {
    corpo = JSON.parse(new TextDecoder().decode(corpoCru));
  } catch {
    return json({ erro: "JSON inválido." }, 400);
  }

  const linhas = linhasDoWebhook(corpo);
  if (!linhas.length) return json({ ok: true, eventos: 0 });

  const db = bancoServidor();
  // Empresa pelo número (ou pela conta), só entre as conexões do app Nexa OS.
  const phones = [...new Set(linhas.map((l) => l.phone_number_id).filter(Boolean))] as string[];
  const wabas = [...new Set(linhas.map((l) => l.waba_id).filter(Boolean))] as string[];
  const { data: conexoes } = await db
    .from("whatsapp_cloud_conexoes")
    .select("empresa_id, waba_id, phone_number_id")
    .or(
      [
        phones.length ? `phone_number_id.in.(${phones.join(",")})` : "",
        wabas.length ? `waba_id.in.(${wabas.join(",")})` : "",
      ]
        .filter(Boolean)
        .join(",") || "empresa_id.is.null",
    );
  const porPhone = new Map<string, string>();
  const porWaba = new Map<string, string>();
  for (const x of (conexoes ?? []) as Array<{
    empresa_id: string;
    waba_id: string | null;
    phone_number_id: string | null;
  }>) {
    if (x.phone_number_id) porPhone.set(x.phone_number_id, x.empresa_id);
    if (x.waba_id) porWaba.set(x.waba_id, x.empresa_id);
  }

  const registros = linhas.map((l) => ({
    ...l,
    empresa_id:
      (l.phone_number_id && porPhone.get(l.phone_number_id)) ||
      (l.waba_id && porWaba.get(l.waba_id)) ||
      null,
  }));
  // Linha a linha: a Meta reenvia eventos e a repetida (mesmo wamid, tipo e status) é ignorada.
  let gravados = 0;
  for (const r of registros) {
    const { error } = await db.from("whatsapp_cloud_eventos").insert(r);
    if (!error) gravados++;
    else if (error.code !== "23505") {
      // Sem o corpo da mensagem no log.
      console.error("nexa-meta-webhook: falha ao gravar", error.code, error.message);
      return json({ erro: "Falha ao gravar." }, 500);
    }
  }
  return json({ ok: true, eventos: gravados });
});
