// Chamadas de teste do app "Nexa OS" para a Análise do app da Meta. SÓ o número de teste da Meta
// (+1 555 188-4259, phone_number_id 1547429628435173, WABA 3641269396036529) e SÓ para admin da
// Nexa (Painel Nexa). Nunca usa número de cliente nem o da Turbine.
//   enviar_texto { para, texto }          → whatsapp_business_messaging
//   enviar_modelo { para, modelo, idioma } → whatsapp_business_messaging
//   listar_modelos / listar_numeros       → whatsapp_business_management
//   criar_modelo { nome }                 → whatsapp_business_management
//   mensagens                             → últimas mensagens recebidas pelo webhook (tela)
import {
  cabecalhosCors,
  erroDaMeta,
  graph,
  json,
  TESTE_PHONE_ID,
  TESTE_WABA_ID,
  type RespostaGraph,
} from "../_compartilhado/meta.ts";
import { bancoServidor, chamador, config } from "../_compartilhado/servidor.ts";

const PARA = /^[0-9]{10,15}$/;
const NOME_MODELO = /^[a-z0-9_]{1,512}$/;

function resposta(
  r: RespostaGraph,
  cors: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  return r.ok
    ? json({ ok: true, ...extra, meta: r.dados }, 200, cors)
    : json({ ok: false, erro: erroDaMeta(r) }, 502, cors);
}

Deno.serve(async (req: Request) => {
  const cors = cabecalhosCors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405, cors);

  const db = bancoServidor();
  const quem = await chamador(req, db);
  if (!quem?.souNexa)
    return json({ erro: "Só a equipe da Nexa usa as chamadas de teste." }, 403, cors);

  const c = config();
  if (!c.tokenTeste) return json({ erro: "Falta o secret NEXA_META_TESTE_TOKEN." }, 503, cors);
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const acao = String(corpo["acao"] ?? "");
  const g = (caminho: string, o: Parameters<typeof graph>[1] = {}) =>
    graph(caminho, { token: c.tokenTeste, versao: c.versao, ...o });

  // Trava: o número de teste não pode estar ligado a nenhuma empresa.
  const { data: ligado } = await db
    .from("whatsapp_cloud_conexoes")
    .select("empresa_id")
    .eq("phone_number_id", TESTE_PHONE_ID)
    .maybeSingle();
  if (ligado)
    return json({ erro: "O número de teste está ligado a uma empresa: recusado." }, 409, cors);

  switch (acao) {
    case "enviar_texto": {
      const para = String(corpo["para"] ?? "").replace(/\D/g, "");
      const texto = String(corpo["texto"] ?? "").trim();
      if (!PARA.test(para) || !texto || texto.length > 1000)
        return json({ erro: "Destino ou texto inválido." }, 400, cors);
      const r = await g(`${TESTE_PHONE_ID}/messages`, {
        metodo: "POST",
        corpo: { messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } },
      });
      return resposta(r, cors);
    }
    case "enviar_modelo": {
      const para = String(corpo["para"] ?? "").replace(/\D/g, "");
      const modelo = String(corpo["modelo"] ?? "hello_world");
      const idioma = String(corpo["idioma"] ?? "en_US");
      if (!PARA.test(para) || !NOME_MODELO.test(modelo) || !/^[a-z]{2}(_[A-Z]{2})?$/.test(idioma)) {
        return json({ erro: "Destino, modelo ou idioma inválido." }, 400, cors);
      }
      const r = await g(`${TESTE_PHONE_ID}/messages`, {
        metodo: "POST",
        corpo: {
          messaging_product: "whatsapp",
          to: para,
          type: "template",
          template: { name: modelo, language: { code: idioma } },
        },
      });
      return resposta(r, cors);
    }
    case "listar_modelos": {
      const r = await g(`${TESTE_WABA_ID}/message_templates`, {
        params: { fields: "name,status,language,category", limit: "50" },
      });
      return resposta(r, cors);
    }
    case "listar_numeros": {
      const r = await g(`${TESTE_WABA_ID}/phone_numbers`, {
        params: {
          fields: "display_phone_number,verified_name,quality_rating,code_verification_status",
        },
      });
      return resposta(r, cors);
    }
    case "criar_modelo": {
      const nome = String(corpo["nome"] ?? "nexa_os_teste");
      if (!NOME_MODELO.test(nome))
        return json({ erro: "Nome inválido (minúsculas, números e _)." }, 400, cors);
      const r = await g(`${TESTE_WABA_ID}/message_templates`, {
        metodo: "POST",
        corpo: {
          name: nome,
          language: "en_US",
          category: "UTILITY",
          components: [
            {
              type: "BODY",
              text: "Hi {{1}}, your service with Nexa OS is confirmed for {{2}}.",
              example: { body_text: [["Anna", "Friday, 9 AM"]] },
            },
          ],
        },
      });
      return resposta(r, cors);
    }
    case "mensagens": {
      const { data } = await db
        .from("whatsapp_cloud_eventos")
        .select("tipo, contato, texto, status, wa_message_id, recebido_em")
        .eq("phone_number_id", TESTE_PHONE_ID)
        .order("recebido_em", { ascending: false })
        .limit(30);
      return json({ ok: true, eventos: data ?? [] }, 200, cors);
    }
    default:
      return json({ erro: "Ação desconhecida." }, 400, cors);
  }
});
