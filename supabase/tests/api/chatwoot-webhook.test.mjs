// Teste ponta a ponta do webhook do Chatwoot: servidor do app (vite dev) → PostgREST local.
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3996";
const TOKEN = "a".repeat(64);
const TOKEN_ASSINADO = "b".repeat(64);
const SEGREDO = "segredo-do-webhook";

let falhas = 0;
function check(nome, cond, info) {
  console.log(`${cond ? "OK  " : "FALHA"} ${nome}${cond ? "" : " -> " + JSON.stringify(info)}`);
  if (!cond) falhas++;
}
const sql = (q) =>
  execFileSync("psql", ["-XAtq", "-d", process.env.DB_NAME, "-c", q], { encoding: "utf8" }).trim();

async function post(token, corpo, cabecalhos = {}) {
  const r = await fetch(`${APP}/api/public/hooks/chatwoot/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...cabecalhos },
    body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
function assinar(corpo, ts = Math.floor(Date.now() / 1000), segredo = SEGREDO) {
  const hmac = createHmac("sha256", segredo).update(`${ts}.${corpo}`).digest("hex");
  return { "X-Chatwoot-Timestamp": String(ts), "X-Chatwoot-Signature": `sha256=${hmac}` };
}

const sender = { id: 555, name: "Cliente Teste", phone_number: "+5511912345678", type: "contact" };
const conversa = (conta, inbox, id = 901) => ({
  event: "conversation_created",
  id,
  inbox_id: inbox,
  status: "open",
  account: { id: conta },
  meta: { sender },
  contact_inbox: { source_id: "5511912345678" },
  created_at: 1790000000,
  updated_at: 1790000000.1,
  last_activity_at: 1790000000,
});
const mensagem = (id, conta = 187966, inbox = 4242) => ({
  event: "message_created",
  id,
  message_type: "incoming",
  content: "Quero orçamento de sofá",
  private: false,
  created_at: "2026-09-26T12:00:00Z",
  account: { id: conta },
  inbox: { id: inbox },
  sender: { id: 555, name: "Cliente Teste", phone_number: "+5511912345678" },
  conversation: { id: 901, inbox_id: inbox, status: "open", meta: { sender } },
});

let r = await post("nao-e-token", conversa(187966, 4242));
check("token em formato inválido → 404", r.status === 404, r);
r = await post("c".repeat(64), conversa(187966, 4242));
check("token desconhecido → 404", r.status === 404, r);

r = await post(TOKEN, conversa(187966, 4242));
check("conversa nova → 200 processado", r.status === 200 && r.body?.status === "processado", r);
r = await post(TOKEN, mensagem(7001), { "X-Chatwoot-Delivery": "entrega-1" });
check("mensagem → 200 processado", r.status === 200 && r.body?.status === "processado", r);
r = await post(TOKEN, mensagem(7001), { "X-Chatwoot-Delivery": "entrega-1" });
check("mensagem repetida → 200 duplicado", r.status === 200 && r.body?.duplicado === true, r);

r = await post(TOKEN, conversa(999, 4242));
check("evento de outra conta → 403", r.status === 403, r);
r = await post(TOKEN, "{nao é json");
check("JSON inválido → 400", r.status === 400, r);
r = await post(TOKEN, "[1,2]");
check("JSON que não é objeto → 400", r.status === 400, r);

r = await post(TOKEN, {
  event: "conversation_typing_on",
  account: { id: 187966 },
  conversation: { id: 901 },
});
check("aviso de digitação descartado", r.status === 200 && r.body?.status === "descartado", r);
check(
  "descartado não é gravado",
  sql("SELECT count(*) FROM integracao_eventos WHERE evento = 'conversation_typing_on'") === "0",
);

r = await post(TOKEN, conversa(187966, 31337, 950));
check(
  "caixa não mapeada → 200 guardado",
  r.status === 200 && r.body?.status === "inbox_nao_mapeado",
  r,
);

// Conexão que exige assinatura.
const corpo = JSON.stringify(conversa(111, 7, 902));
r = await post(TOKEN_ASSINADO, corpo);
check("sem assinatura → 401", r.status === 401 && r.body?.motivo === "sem_assinatura", r);
r = await post(
  TOKEN_ASSINADO,
  corpo,
  assinar(corpo, Math.floor(Date.now() / 1000), "segredo-errado"),
);
check(
  "assinatura com segredo errado → 401",
  r.status === 401 && r.body?.motivo === "assinatura_invalida",
  r,
);
r = await post(TOKEN_ASSINADO, corpo, assinar(corpo, Math.floor(Date.now() / 1000) - 3600));
check("assinatura antiga → 401", r.status === 401 && r.body?.motivo === "fora_da_janela", r);
r = await post(TOKEN_ASSINADO, corpo.replace("Cliente Teste", "Cliente Troca"), assinar(corpo));
check("corpo alterado → 401", r.status === 401, r);
r = await post(TOKEN_ASSINADO, corpo, assinar(corpo));
check("assinatura válida → 200 processado", r.status === 200 && r.body?.status === "processado", r);

// Estado final no banco.
check(
  "um lead para o contato",
  sql("SELECT count(*) FROM crm_leads WHERE normalized_phone = '5511912345678'") === "1",
);
check(
  "uma mensagem gravada",
  sql("SELECT count(*) FROM whatsapp_messages WHERE chatwoot_message_id = 7001") === "1",
);
check(
  "entrega registrada no evento",
  sql("SELECT count(*) FROM integracao_eventos WHERE delivery_id = 'entrega-1'") === "1",
);
check(
  "eventos recusados não foram gravados",
  sql(
    "SELECT count(*) FROM integracao_eventos WHERE account_id = 999 OR payload->>'id' = '902'",
  ) === "1",
);

// Reprocessamento (tarefa agendada).
const rep = (auth) =>
  fetch(`${APP}/api/public/hooks/chatwoot-reprocessar`, {
    method: "POST",
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  }).then(async (x) => ({ status: x.status, body: await x.json().catch(() => null) }));
r = await rep();
check("reprocessar sem autorização → 401", r.status === 401, r);
sql(`INSERT INTO chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('c0000000-0000-0000-0000-000000000001', 31337, '11111111-1111-1111-1111-111111111111')`);
r = await rep(process.env.NEXA_TAREFAS_SEGREDO);
check(
  "reprocessar com a chave da tarefa → processa o pendente",
  r.status === 200 && r.body?.processados === 1,
  r,
);

console.log(falhas ? `\n${falhas} falha(s)` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
