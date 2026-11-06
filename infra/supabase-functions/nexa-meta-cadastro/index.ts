// Cadastro Incorporado (Embedded Signup) do app "Nexa OS". Chamado pela tela Configurações ›
// Conectar WhatsApp, com o login do app (admin da empresa ativa).
//   { acao: "situacao" }  → liberação, situação e o que a tela precisa (app_id, config_id).
//   { acao: "concluir", code, waba_id, phone_number_id } → troca o code pelo token do cliente
//     (vence em 60 dias), confere que o WABA é desse token, inscreve o app no WABA e registra o
//     número com PIN usando ESSE token; depois confere o compartilhamento do WABA com o portfólio
//     da Nexa e atribui o usuário do sistema da Nexa (token permanente, NEXA_META_SYSTEM_TOKEN),
//     que é o que o dia a dia usa.
// Só funciona para empresa liberada (linha em whatsapp_cloud_conexoes). Turbine e empresas atuais
// não têm linha: a função recusa.
import {
  cabecalhosCors,
  cifrar,
  erroDaMeta,
  gerarPin,
  graph,
  json,
  NEXA_BUSINESS_ID,
  vencimentoDoToken,
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

  // Nexa: tenta de novo o acesso permanente (compartilhamento + atribuição) de uma conexão.
  if (corpo["acao"] === "reatribuir") {
    if (!quem.souNexa) return json({ erro: "Só a equipe da Nexa." }, 403, cors);
    if (!conexao?.waba_id) return json({ erro: "Empresa sem WABA conectado." }, 400, cors);
    const p = await acessoPermanente(c.systemToken, conexao.waba_id, c.versao);
    await db
      .from("whatsapp_cloud_conexoes")
      .update({
        waba_compartilhado: p.compartilhado,
        atribuicao_ok: p.ok,
        atribuicao_erro: p.erro,
        atribuido_em: p.ok ? new Date().toISOString() : null,
        ...(p.ok && conexao.situacao === "pendente" ? { situacao: "conectado", erro: null } : {}),
      })
      .eq("empresa_id", empresa);
    return json({ ok: p.ok, erro: p.erro }, p.ok ? 200 : 502, cors);
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

  // 1. code → token do cliente (vence em 60 dias: só para o cadastro).
  const troca = await graph("oauth/access_token", {
    versao: c.versao,
    params: { client_id: c.appId, client_secret: c.appSecret, code },
  });
  const tokenCliente = troca.dados["access_token"] as string | undefined;
  if (!troca.ok || !tokenCliente)
    return falhar(`Não foi possível trocar o código: ${erroDaMeta(troca)}`);

  // 2. O WABA recebido pelo navegador pertence mesmo a esse token? (e quem autorizou, vencimento)
  const dbg = await graph("debug_token", {
    versao: c.versao,
    params: { input_token: tokenCliente, access_token: `${c.appId}|${c.appSecret}` },
  });
  const dd = (dbg.dados["data"] ?? {}) as {
    user_id?: string;
    granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  };
  const alvos = new Set(
    (dd.granular_scopes ?? []).flatMap((s) =>
      s.scope.startsWith("whatsapp_business") ? (s.target_ids ?? []) : [],
    ),
  );
  if (!dbg.ok || !alvos.has(wabaId)) {
    return falhar("A conta do WhatsApp retornada não pertence a esta autorização.", 403);
  }

  // 3. Guarda o token do cliente (registro / nova tentativa da atribuição) e o PIN, criptografados.
  const pin = gerarPin();
  const { error: eSeg } = await db.from("whatsapp_cloud_segredos").upsert({
    empresa_id: empresa,
    token_cifrado: await cifrar(tokenCliente, c.chaveToken),
    pin_cifrado: await cifrar(pin, c.chaveToken),
    updated_at: new Date().toISOString(),
  });
  if (eSeg) return falhar("Falha ao guardar a autorização.", 500);
  await marcar({
    meta_user_id: dd.user_id ? String(dd.user_id).slice(0, 100) : null,
    token_cliente_vence_em: vencimentoDoToken(dbg.dados),
  });

  // 4. Inscreve o app Nexa OS no WABA do cliente (webhooks de mensagens e status).
  const insc = await graph(`${wabaId}/subscribed_apps`, {
    token: tokenCliente,
    metodo: "POST",
    versao: c.versao,
  });
  if (!insc.ok) return falhar(`Não foi possível inscrever o app na conta: ${erroDaMeta(insc)}`);

  // 5. Registra o número na Cloud API com o PIN (verificação em duas etapas).
  const reg = await graph(`${phoneId}/register`, {
    token: tokenCliente,
    metodo: "POST",
    versao: c.versao,
    corpo: { messaging_product: "whatsapp", pin },
  });
  if (!reg.ok) return falhar(`Não foi possível registrar o número: ${erroDaMeta(reg)}`);

  // 6. Acesso PERMANENTE da Nexa: confere o compartilhamento com o portfólio e atribui o usuário do
  //    sistema ao WABA (tasks MANAGE). O dia a dia usa só esse token.
  const permanente = await acessoPermanente(c.systemToken, wabaId, c.versao);
  await marcar({
    waba_compartilhado: permanente.compartilhado,
    atribuicao_ok: permanente.ok,
    atribuicao_erro: permanente.erro,
    atribuido_em: permanente.ok ? new Date().toISOString() : null,
  });

  // 7. Número e nome para a tela (com o token da Nexa quando a atribuição deu certo).
  const info = await graph(phoneId, {
    token: permanente.ok ? c.systemToken : tokenCliente,
    versao: c.versao,
    params: { fields: "display_phone_number,verified_name" },
  });
  const numero = (info.dados["display_phone_number"] as string | undefined)?.slice(0, 40) ?? null;
  const nome = (info.dados["verified_name"] as string | undefined)?.slice(0, 200) ?? null;
  const situacao = permanente.ok ? "conectado" : "pendente";
  await marcar({
    situacao,
    erro: permanente.ok
      ? null
      : "Número registrado. Falta a Nexa terminar o acesso permanente; a equipe da Nexa já foi avisada.",
    numero_exibicao: numero,
    nome_verificado: nome,
    conectado_em: new Date().toISOString(),
    conectado_por: quem.userId,
  });
  return json({ situacao, numero, nome }, 200, cors);
});

/**
 * Compartilhamento do WABA com o portfólio da Nexa e atribuição do usuário do sistema da Nexa
 * (POST /{waba_id}/assigned_users, tasks MANAGE), com o token permanente do usuário do sistema.
 */
async function acessoPermanente(
  systemToken: string,
  wabaId: string,
  versao: string,
): Promise<{ ok: boolean; compartilhado: boolean | null; erro: string | null }> {
  if (!systemToken)
    return { ok: false, compartilhado: null, erro: "Falta o secret NEXA_META_SYSTEM_TOKEN." };
  // Compartilhado? O WABA aparece entre as contas de clientes do portfólio da Nexa.
  let compartilhado = false;
  let depois: string | null = null;
  for (let pagina = 0; pagina < 10 && !compartilhado; pagina++) {
    const r = await graph(`${NEXA_BUSINESS_ID}/client_whatsapp_business_accounts`, {
      token: systemToken,
      versao,
      params: { fields: "id", limit: "200", ...(depois ? { after: depois } : {}) },
    });
    if (!r.ok)
      return { ok: false, compartilhado: null, erro: `Compartilhamento: ${erroDaMeta(r)}` };
    const lista = (r.dados["data"] as Array<{ id: string }> | undefined) ?? [];
    compartilhado = lista.some((w) => w.id === wabaId);
    depois =
      ((r.dados["paging"] as { cursors?: { after?: string }; next?: string } | undefined)?.next &&
        (r.dados["paging"] as { cursors?: { after?: string } }).cursors?.after) ||
      null;
    if (!depois) break;
  }
  if (!compartilhado) {
    return {
      ok: false,
      compartilhado,
      erro: "O WABA não aparece compartilhado com o portfólio da Nexa.",
    };
  }
  // ID do usuário do sistema dono do token.
  const eu = await graph("me", { token: systemToken, versao, params: { fields: "id" } });
  const userId = eu.dados["id"] as string | undefined;
  if (!eu.ok || !userId)
    return { ok: false, compartilhado, erro: `Usuário do sistema: ${erroDaMeta(eu)}` };
  const atr = await graph(`${wabaId}/assigned_users`, {
    token: systemToken,
    metodo: "POST",
    versao,
    params: { user: userId, tasks: "['MANAGE']" },
  });
  if (!atr.ok) return { ok: false, compartilhado, erro: `Atribuição: ${erroDaMeta(atr)}` };
  return { ok: true, compartilhado, erro: null };
}
