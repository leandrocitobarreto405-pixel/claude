// Cadastro Incorporado (Embedded Signup) do app "Nexa OS". Chamado pela tela Configurações ›
// Conectar WhatsApp, com o login do app (admin da empresa ativa).
//   { acao: "situacao" }  → liberação, situação e o que a tela precisa (app_id, config_id).
//   { acao: "concluir", code, waba_id, phone_number_id } → troca o code pelo token do cliente,
//     confere que o WABA é desse token, guarda o token criptografado, inscreve o app no WABA,
//     registra o número com PIN e salva a situação.
// Só funciona para empresa liberada (linha em whatsapp_cloud_conexoes). Turbine e empresas atuais
// não têm linha: a função recusa.
import {
  cabecalhosCors,
  cifrar,
  erroDaMeta,
  gerarPin,
  graph,
  json,
} from "../_compartilhado/meta.ts";
import { bancoServidor, chamador, config } from "../_compartilhado/servidor.ts";

const ID = /^[0-9]{5,25}$/;

type Conexao = {
  empresa_id: string;
  situacao: string;
  waba_id: string | null;
  phone_number_id: string | null;
  numero_exibicao: string | null;
  nome_verificado: string | null;
  erro: string | null;
  conectado_em: string | null;
};

Deno.serve(async (req: Request) => {
  const cors = cabecalhosCors(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ erro: "Método não permitido." }, 405, cors);

  const db = bancoServidor();
  const quem = await chamador(req, db);
  if (!quem) return json({ erro: "Entre no Nexa OS de novo." }, 401, cors);
  if (!quem.empresaAdmin)
    return json({ erro: "Só o admin da empresa conecta o WhatsApp." }, 403, cors);
  const empresa = quem.empresaAdmin;
  const c = config();
  const corpo = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const { data: linha } = await db
    .from("whatsapp_cloud_conexoes")
    .select(
      "empresa_id, situacao, waba_id, phone_number_id, numero_exibicao, nome_verificado, erro, conectado_em",
    )
    .eq("empresa_id", empresa)
    .maybeSingle();
  const conexao = linha as Conexao | null;

  if (corpo["acao"] === "situacao") {
    if (!conexao) return json({ liberado: false }, 200, cors);
    return json(
      {
        liberado: true,
        pronto: Boolean(c.configId && c.appSecret && c.chaveToken),
        app_id: c.appId,
        config_id: c.configId || null,
        versao: c.versao,
        situacao: conexao.situacao,
        numero: conexao.numero_exibicao,
        nome: conexao.nome_verificado,
        erro: conexao.erro,
        conectado_em: conexao.conectado_em,
      },
      200,
      cors,
    );
  }

  if (corpo["acao"] !== "concluir") return json({ erro: "Ação desconhecida." }, 400, cors);
  if (!conexao)
    return json(
      { erro: "Conectar WhatsApp ainda não está liberado para esta empresa." },
      403,
      cors,
    );
  if (!c.appSecret || !c.chaveToken)
    return json({ erro: "Configuração do app incompleta (secrets)." }, 503, cors);

  const code = String(corpo["code"] ?? "");
  const wabaId = String(corpo["waba_id"] ?? "");
  const phoneId = String(corpo["phone_number_id"] ?? "");
  if (!code || code.length > 2000 || !ID.test(wabaId) || !ID.test(phoneId)) {
    return json({ erro: "Dados do cadastro incompletos." }, 400, cors);
  }

  // O mesmo número não pode estar em outra empresa.
  const { data: outra } = await db
    .from("whatsapp_cloud_conexoes")
    .select("empresa_id")
    .eq("phone_number_id", phoneId)
    .neq("empresa_id", empresa)
    .maybeSingle();
  if (outra) return json({ erro: "Este número já está ligado a outra empresa." }, 409, cors);

  const marcar = async (campos: Record<string, unknown>) =>
    db.from("whatsapp_cloud_conexoes").update(campos).eq("empresa_id", empresa);
  const falhar = async (msg: string, status = 502) => {
    await marcar({ situacao: "erro", erro: msg.slice(0, 500) });
    return json({ erro: msg, situacao: "erro" }, status, cors);
  };

  await marcar({ situacao: "pendente", erro: null, waba_id: wabaId, phone_number_id: phoneId });

  // 1. code → token de integração do cliente (business integration system user token).
  const troca = await graph("oauth/access_token", {
    versao: c.versao,
    params: { client_id: c.appId, client_secret: c.appSecret, code },
  });
  const token = troca.dados["access_token"] as string | undefined;
  if (!troca.ok || !token) return falhar(`Não foi possível trocar o código: ${erroDaMeta(troca)}`);

  // 2. O WABA recebido pelo navegador pertence mesmo a esse token?
  const dbg = await graph("debug_token", {
    versao: c.versao,
    params: { input_token: token, access_token: `${c.appId}|${c.appSecret}` },
  });
  const escopos =
    (dbg.dados["data"] as { granular_scopes?: Array<{ scope: string; target_ids?: string[] }> })
      ?.granular_scopes ?? [];
  const alvos = new Set(
    escopos.flatMap((s) => (s.scope.startsWith("whatsapp_business") ? (s.target_ids ?? []) : [])),
  );
  if (!dbg.ok || !alvos.has(wabaId)) {
    return falhar("A conta do WhatsApp retornada não pertence a esta autorização.", 403);
  }

  // 3. Guarda o token criptografado (o banco nunca vê o texto aberto).
  const pin = gerarPin();
  const { error: eSeg } = await db.from("whatsapp_cloud_segredos").upsert({
    empresa_id: empresa,
    token_cifrado: await cifrar(token, c.chaveToken),
    pin_cifrado: await cifrar(pin, c.chaveToken),
    updated_at: new Date().toISOString(),
  });
  if (eSeg) return falhar("Falha ao guardar a autorização.", 500);

  // 4. Inscreve o app Nexa OS no WABA do cliente (webhooks de mensagens e status).
  const insc = await graph(`${wabaId}/subscribed_apps`, {
    token,
    metodo: "POST",
    versao: c.versao,
  });
  if (!insc.ok) return falhar(`Não foi possível inscrever o app na conta: ${erroDaMeta(insc)}`);

  // 5. Registra o número na Cloud API com o PIN (verificação em duas etapas).
  const reg = await graph(`${phoneId}/register`, {
    token,
    metodo: "POST",
    versao: c.versao,
    corpo: { messaging_product: "whatsapp", pin },
  });
  if (!reg.ok) return falhar(`Não foi possível registrar o número: ${erroDaMeta(reg)}`);

  // 6. Número e nome para a tela.
  const info = await graph(phoneId, {
    token,
    versao: c.versao,
    params: { fields: "display_phone_number,verified_name" },
  });
  await marcar({
    situacao: "conectado",
    erro: null,
    numero_exibicao:
      (info.dados["display_phone_number"] as string | undefined)?.slice(0, 40) ?? null,
    nome_verificado: (info.dados["verified_name"] as string | undefined)?.slice(0, 200) ?? null,
    conectado_em: new Date().toISOString(),
    conectado_por: quem.userId,
  });
  return json(
    {
      situacao: "conectado",
      numero: info.dados["display_phone_number"] ?? null,
      nome: info.dados["verified_name"] ?? null,
    },
    200,
    cors,
  );
});
