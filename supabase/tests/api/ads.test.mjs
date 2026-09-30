// Teste ponta a ponta dos anúncios: pop-up da landing → /api/public/ads/lead (CORS, formatos,
// validação) → lead criado pelo WhatsApp (Chatwoot) → venda → exportação para a planilha (Google
// Sheets falso) → marcação de enviado.
import { execFileSync } from "node:child_process";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3996";
const FAKE = `http://127.0.0.1:${process.env.PORTA_CHATWOOT ?? 3994}`;
const EMPRESA = "11111111-1111-1111-1111-111111111111";
const LANDING = "https://turbinecleanimper.lovable.app";
const PLANILHA = "planilhaTesteAds_1234567890";

let falhas = 0;
function check(nome, cond, info) {
  console.log(
    `${cond ? "OK  " : "FALHA"} ${nome}${cond ? "" : " -> " + JSON.stringify(info)?.slice(0, 600)}`,
  );
  if (!cond) falhas++;
}
const sql = (q) =>
  execFileSync("psql", ["-XAtq", "-d", process.env.DB_NAME, "-c", q], { encoding: "utf8" }).trim();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const enviar = (corpo, headers = {}) =>
  fetch(`${APP}/api/public/ads/lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: LANDING, ...headers },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
const exportar = (query = "", chave = process.env.NEXA_TAREFAS_SEGREDO) =>
  fetch(`${APP}/api/public/hooks/ads-exportar-google${query}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}` },
  });
const planilha = async () =>
  (
    await (
      await fetch(`${FAKE}/v4/spreadsheets/${PLANILHA}/values/A1`, {
        headers: { Authorization: "Bearer token-oauth-empresa" },
      })
    ).json()
  ).values ?? [];

// ---------------------------------------------------------------- preparação
sql(`INSERT INTO ads_dominios (dominio, empresa_id) VALUES
       ('turbinecleanimper.lovable.app', '${EMPRESA}'), ('turbineclanhigenizacao.lovable.app', '${EMPRESA}')`);
sql(
  `INSERT INTO ads_configuracoes (empresa_id, google_planilha_id) VALUES ('${EMPRESA}', '${PLANILHA}')`,
);
sql(`INSERT INTO google_conexoes (empresa_id, email, escopos) VALUES ('${EMPRESA}', 'turbine@teste.dev', '{}')
     ON CONFLICT (empresa_id) DO NOTHING`);
sql(`INSERT INTO google_conexao_segredos (empresa_id, refresh_token) VALUES ('${EMPRESA}', 'refresh-teste')
     ON CONFLICT (empresa_id) DO UPDATE SET refresh_token = 'refresh-teste'`);

// ---------------------------------------------------------------- 1. CORS
// O preflight (OPTIONS) é respondido pelo próprio Vite no modo dev; ele é conferido no build de
// produção (docs/nexa-os/ANUNCIOS.md). Aqui: o POST devolve o cabeçalho só para a landing.
// ---------------------------------------------------------------- 2. captação
let r = await enviar({
  name: "Leandro Teste",
  phone: "(11) 97777-6666",
  pageUrl: `${LANDING}/?gclid=Cj0KCQ_teste-ads&utm_source=google&utm_campaign=imper-sp`,
});
let corpo = await r.json();
check(
  "JSON da landing gravado (gclid e UTM tirados da URL)",
  r.status === 200 &&
    corpo.ok &&
    corpo.resultado === "gravado" &&
    r.headers.get("access-control-allow-origin") === LANDING,
  [r.status, corpo],
);
check(
  "campos no banco",
  sql(`SELECT nome || '|' || normalized_phone || '|' || gclid || '|' || utm_campaign || '|' || servico
         FROM ads_clicks WHERE normalized_phone = '5511977776666'`) ===
    "Leandro Teste|5511977776666|Cj0KCQ_teste-ads|imper-sp|impermeabilizacao",
);

// sendBeacon: text/plain com JSON, sem Origin (só Referer).
r = await fetch(`${APP}/api/public/ads/lead`, {
  method: "POST",
  headers: { "Content-Type": "text/plain", Referer: "https://turbineclanhigenizacao.lovable.app/" },
  body: JSON.stringify({ nome: "Bia", telefone: "11966665555", gclid: "GCLID_BEACON_1" }),
});
corpo = await r.json();
check("sendBeacon (text/plain) gravado", corpo.ok && corpo.resultado === "gravado", corpo);
check(
  "serviço pela landing de higienização",
  sql(`SELECT servico FROM ads_clicks WHERE gclid = 'GCLID_BEACON_1'`) === "higienizacao",
);

// Formulário.
r = await fetch(`${APP}/api/public/ads/lead`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: LANDING },
  body: new URLSearchParams({
    nome: "Caio",
    telefone: "11955554444",
    gclid: "GCLID_FORM_1",
  }).toString(),
});
check("formulário gravado", (await r.json()).resultado === "gravado");

// Reenvio igual: não duplica.
r = await enviar({ phone: "11977776666", gclid: "Cj0KCQ_teste-ads" });
check("reenvio não duplica", (await r.json()).resultado === "duplicado");

// Falhas leves: sempre 200.
r = await enviar({ nome: "Sem telefone" });
corpo = await r.json();
check(
  "sem telefone: 200 com ok=false",
  r.status === 200 && !corpo.ok && corpo.resultado === "invalido",
  corpo,
);
r = await enviar("isto não é json {", { "Content-Type": "application/json" });
check("corpo quebrado: 200", r.status === 200 && (await r.json()).ok === false);
r = await enviar({ telefone: "11944443333" }, { Origin: "https://site-estranho.com" });
corpo = await r.json();
check(
  "domínio não liberado: 200 sem CORS e nada gravado",
  r.status === 200 &&
    corpo.resultado === "dominio_desconhecido" &&
    !r.headers.get("access-control-allow-origin") &&
    sql(`SELECT count(*) FROM ads_clicks WHERE normalized_phone = '5511944443333'`) === "0",
  corpo,
);
check(
  "tentativas registradas no log",
  Number(sql(`SELECT count(*) FROM ads_eventos WHERE tipo = 'captacao'`)) >= 7,
);

// ---------------------------------------------------------------- 3. lead pelo WhatsApp
// O WhatsApp manda o número sem o 9º dígito: ainda assim casa com o pop-up.
r = await fetch(`${APP}/api/public/hooks/chatwoot/${"a".repeat(64)}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    event: "message_created",
    id: 99001,
    message_type: "incoming",
    content: "Oi, vim pelo anúncio",
    private: false,
    created_at: new Date().toISOString(),
    account: { id: 187966 },
    inbox: { id: 4242 },
    sender: { id: 8990, type: "contact" },
    conversation: {
      id: 990,
      inbox_id: 4242,
      status: "open",
      meta: { sender: { id: 8990, name: "Leandro", phone_number: "+551177776666" } },
    },
  }),
});
check("mensagem do WhatsApp aceita", r.status === 200, r.status);
await esperar(300);
check(
  "clique ligado ao lead da conversa e WhatsApp iniciado",
  sql(`SELECT (a.crm_lead_id = c.crm_lead_id AND a.whatsapp_iniciado_em IS NOT NULL)::text
         FROM ads_clicks a, conversas c
        WHERE a.gclid = 'Cj0KCQ_teste-ads' AND c.chatwoot_conversation_id = 990`) === "true",
);

// ---------------------------------------------------------------- 3b. planilha sem vendas
// Sem conversões novas, a exportação formata a planilha vazia (parâmetros + cabeçalho).
let formatada = await (await exportar()).json();
check(
  "planilha vazia: formatada sem vendas",
  formatada.ok &&
    formatada.resultados?.[0]?.situacao === "formatada" &&
    JSON.stringify((await planilha()).slice(0, 2)) ===
      JSON.stringify([
        ["Parameters:TimeZone=America/Sao_Paulo"],
        [
          "Google Click ID",
          "Conversion Name",
          "Conversion Time",
          "Conversion Value",
          "Conversion Currency",
        ],
      ]) &&
    (await planilha()).length === 2,
  [formatada, await planilha()],
);
check(
  "formatar não marca clique como enviado",
  sql(`SELECT count(*) FROM ads_clicks WHERE enviado_google_em IS NOT NULL`) === "0",
);
check(
  "conferência das duas linhas no log",
  sql(`SELECT detalhe->'primeiras_linhas'->0->>0 FROM ads_eventos
        WHERE tipo = 'exportacao_google' AND resultado = 'formatada'`) ===
    "Parameters:TimeZone=America/Sao_Paulo",
);
formatada = await (await exportar()).json();
check("já formatada: não mexe", formatada.resultados?.[0]?.situacao === "nada_novo", formatada);
// Fora do formato (alguém mexeu): volta ao formato.
await fetch(`${FAKE}/v4/spreadsheets/${PLANILHA}/values/A1?valueInputOption=RAW`, {
  method: "PUT",
  headers: { Authorization: "Bearer token-oauth-empresa", "Content-Type": "application/json" },
  body: JSON.stringify({ values: [["anotação solta"], ["a", "b"]] }),
});
formatada = await (await exportar()).json();
check(
  "fora do formato: reformatada",
  formatada.resultados?.[0]?.situacao === "formatada" &&
    (await planilha())[0]?.[0] === "Parameters:TimeZone=America/Sao_Paulo" &&
    (await planilha()).length === 2,
  [formatada, await planilha()],
);

// ---------------------------------------------------------------- 4. venda e exportação
const lead = sql(`SELECT crm_lead_id FROM ads_clicks WHERE gclid = 'Cj0KCQ_teste-ads'`);
sql(
  `UPDATE ads_clicks SET created_at = now() - interval '2 days' WHERE gclid = 'Cj0KCQ_teste-ads'`,
);
sql(`INSERT INTO customers (id, empresa_id, full_name, phone)
     VALUES ('c9000000-0000-0000-0000-000000000001', '${EMPRESA}', 'Leandro', '11977776666')`);
sql(`INSERT INTO work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date)
     VALUES ('e9000000-0000-0000-0000-000000000001', '${EMPRESA}', '9901',
             'c9000000-0000-0000-0000-000000000001', 649.90, current_date)`);
sql(
  `UPDATE crm_leads SET linked_work_order_id = 'e9000000-0000-0000-0000-000000000001' WHERE id = '${lead}'`,
);
sql(`INSERT INTO payments (empresa_id, work_order_id, payment_channel, payment_date, gross_amount, net_amount,
       payment_status, is_active)
     VALUES ('${EMPRESA}', 'e9000000-0000-0000-0000-000000000001', 'Pix', current_date - 1, 649.90, 649.90, 'Pago', true)`);

r = await exportar("", "chave-errada-com-mais-de-32-caracteres-0000");
check("exportação sem chave → 401", r.status === 401);

r = await exportar("?simular=1");
corpo = await r.json();
const simulada = corpo.resultados?.[0];
check(
  "simulação devolve a linha sem gravar",
  simulada?.situacao === "simulado" &&
    simulada.linhas?.length === 1 &&
    simulada.linhas[0][0] === "Cj0KCQ_teste-ads" &&
    simulada.linhas[0][1] === "Venda Impermeabilização" &&
    /^\d{4}-\d{2}-\d{2} 12:00:00-03:00$/.test(simulada.linhas[0][2]) &&
    simulada.linhas[0][3] === 649.9 &&
    (await planilha()).length === 2 &&
    sql(`SELECT count(*) FROM ads_clicks WHERE enviado_google_em IS NOT NULL`) === "0",
  corpo,
);

r = await exportar();
corpo = await r.json();
const valores = await planilha();
check("exportação ok", corpo.ok && corpo.resultados?.[0]?.situacao === "enviado", corpo);
check(
  "planilha: parâmetros, cabeçalho e a venda",
  valores[0]?.[0] === "Parameters:TimeZone=America/Sao_Paulo" &&
    valores[1]?.join("|") ===
      "Google Click ID|Conversion Name|Conversion Time|Conversion Value|Conversion Currency" &&
    valores.length === 3 &&
    valores[2][0] === "Cj0KCQ_teste-ads" &&
    valores[2][4] === "BRL",
  valores,
);
check(
  "clique marcado como enviado",
  sql(
    `SELECT count(*) FROM ads_clicks WHERE gclid = 'Cj0KCQ_teste-ads' AND enviado_google_em IS NOT NULL`,
  ) === "1",
);
check("view vazia depois do envio", sql(`SELECT count(*) FROM vw_conversoes_google`) === "0");

r = await exportar();
corpo = await r.json();
check(
  "segunda exportação: nada novo, planilha mantida",
  corpo.resultados?.[0]?.situacao === "nada_novo" && (await planilha()).length === 3,
  corpo,
);

// Falha no Google: nada é marcado, erro registrado.
sql(`UPDATE ads_configuracoes SET google_planilha_id = 'planilha-sem-acesso-0000000000'`);
sql(`INSERT INTO work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date)
     VALUES ('e9000000-0000-0000-0000-000000000002', '${EMPRESA}', '9902',
             'c9000000-0000-0000-0000-000000000001', 300, current_date)`);
const lead2 = sql(`SELECT crm_lead_id FROM ads_clicks WHERE gclid = 'GCLID_FORM_1'`);
if (!lead2) {
  sql(
    `INSERT INTO crm_leads (empresa_id, lead_name, phone, normalized_phone) VALUES ('${EMPRESA}', 'Caio', '11955554444', '5511955554444')`,
  );
}
const lead2id = sql(`SELECT crm_lead_id FROM ads_clicks WHERE gclid = 'GCLID_FORM_1'`);
sql(`UPDATE ads_clicks SET created_at = now() - interval '2 days' WHERE gclid = 'GCLID_FORM_1'`);
sql(
  `UPDATE crm_leads SET linked_work_order_id = 'e9000000-0000-0000-0000-000000000002' WHERE id = '${lead2id}'`,
);
sql(`INSERT INTO payments (empresa_id, work_order_id, payment_channel, payment_date, gross_amount, net_amount,
       payment_status, is_active)
     VALUES ('${EMPRESA}', 'e9000000-0000-0000-0000-000000000002', 'Pix', current_date - 1, 300, 300, 'Pago', true)`);
r = await exportar();
corpo = await r.json();
check(
  "Google recusou: erro informado e nada marcado",
  !corpo.ok &&
    corpo.resultados?.[0]?.situacao === "erro" &&
    sql(
      `SELECT count(*) FROM ads_clicks WHERE gclid = 'GCLID_FORM_1' AND enviado_google_em IS NOT NULL`,
    ) === "0" &&
    sql(
      `SELECT count(*) FROM ads_eventos WHERE tipo = 'exportacao_google' AND resultado = 'erro'`,
    ) === "1",
  corpo,
);

// ---------------------------------------------------------------- 5. fase 2 desligada
r = await fetch(`${APP}/api/public/hooks/alice-varredura`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.NEXA_TAREFAS_SEGREDO}` },
});
corpo = await r.json();
check(
  "fase 2 desligada: varredura não inicia conversa",
  corpo.anuncios?.empresas === 0 &&
    corpo.anuncios?.iniciados === 0 &&
    sql(`SELECT count(*) FROM ads_eventos WHERE tipo = 'alice'`) === "0",
  corpo,
);

console.log(falhas ? `\n${falhas} falha(s)` : "\nAnúncios: tudo certo.");
process.exit(falhas ? 1 : 0);
