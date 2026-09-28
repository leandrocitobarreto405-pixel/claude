// Teste ponta a ponta da Alice: webhook do Chatwoot → fila → IA (Claude falso) com ferramentas →
// resposta no Chatwoot (falso) como robô, registro de custo, vendedora e passagem para humano.
import { execFileSync } from "node:child_process";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3996";
const CLAUDE = `http://127.0.0.1:${process.env.PORTA_CLAUDE ?? 3995}`;
const CHATWOOT = `http://127.0.0.1:${process.env.PORTA_CHATWOOT ?? 3994}`;
const TOKEN = "a".repeat(64);
const EMPRESA = "11111111-1111-1111-1111-111111111111";

let falhas = 0;
function check(nome, cond, info) {
  console.log(
    `${cond ? "OK  " : "FALHA"} ${nome}${cond ? "" : " -> " + JSON.stringify(info)?.slice(0, 600)}`,
  );
  if (!cond) falhas++;
}
const sql = (q) =>
  execFileSync("psql", ["-XAtq", "-d", process.env.DB_NAME, "-c", q], { encoding: "utf8" }).trim();
const log = async (base) => (await fetch(`${base}/__log`)).json();
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms = 15000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await esperar(250);
  }
  return false;
}

async function webhook(corpo) {
  const r = await fetch(`${APP}/api/public/hooks/chatwoot/${TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const pessoa = (n) => ({
  id: 800 + n,
  name: `Cliente ${n}`,
  phone_number: `+55119880000${n}`,
  type: "contact",
});
const conversaNova = (n) => ({
  event: "conversation_created",
  id: 950 + n,
  inbox_id: 4242,
  status: "pending",
  account: { id: 187966 },
  meta: { sender: pessoa(n) },
  created_at: 1790100000,
  updated_at: 1790100000 + n,
  last_activity_at: 1790100000,
});
const msg = (id, n, texto, extra = {}) => ({
  event: "message_created",
  id,
  message_type: "incoming",
  content: texto,
  private: false,
  created_at: new Date().toISOString(),
  account: { id: 187966 },
  inbox: { id: 4242 },
  sender: pessoa(n),
  conversation: { id: 950 + n, inbox_id: 4242, status: "pending", meta: { sender: pessoa(n) } },
  ...extra,
});
const situacao = (n) =>
  sql(`SELECT coalesce(string_agg(t.tipo || ':' || t.situacao, ',' ORDER BY t.created_at), '-')
         FROM ia_tarefas t JOIN conversas c ON c.id = t.conversa_id WHERE c.chatwoot_conversation_id = ${950 + n}`);

// ---------------------------------------------------------------- preparação
sql(
  `UPDATE chatwoot_conexoes SET base_url = '${CHATWOOT}', alice_bot_id = 77 WHERE webhook_token = repeat('a', 64)`,
);
sql(`INSERT INTO chatwoot_conexao_segredos (conexao_id, api_token, alice_bot_token)
     SELECT id, 'token-admin', 'token-robo' FROM chatwoot_conexoes WHERE webhook_token = repeat('a', 64)
     ON CONFLICT (conexao_id) DO UPDATE SET api_token = 'token-admin', alice_bot_token = 'token-robo'`);
sql(`INSERT INTO ia_configuracoes (empresa_id, ativo, espera_segundos, instrucoes)
     VALUES ('${EMPRESA}', true, 1, 'Atendemos só Florianópolis.')`);
sql(`INSERT INTO salespeople (empresa_id, name, commission_percentage, atendente_nexa, eh_ia)
     VALUES ('${EMPRESA}', 'Alice (IA)', 0, true, true)`);
sql(`INSERT INTO tabela_precos_itens (empresa_id, nome, preco_higienizacao, preco_impermeabilizacao, ordem)
     VALUES ('${EMPRESA}', 'Sofá 3 lugares', 180, 250, 1)`);

// ---------------------------------------------------------------- 1. atendimento com foto
let r = await webhook(conversaNova(1));
check("conversa nova (pendente) aceita", r.status === 200, r);
r = await webhook(
  msg(9101, 1, "Oi, quero higienizar meu sofá", {
    attachments: [{ file_type: "image", data_url: `${CHATWOOT}/foto-sofa.jpg` }],
  }),
);
check("mensagem com foto aceita", r.status === 200, r);
check("resposta agendada", situacao(1).startsWith("responder:"), situacao(1));

const respondeu = await ate(() => situacao(1) === "responder:concluida");
check("tarefa concluída pela fila", respondeu, situacao(1));

const chamadasClaude = await log(CLAUDE);
check(
  "duas rodadas com a IA (ferramenta + resposta)",
  chamadasClaude.length === 2,
  chamadasClaude.length,
);
const primeira = chamadasClaude[0] ?? { body: {}, headers: {} };
const sistema = JSON.stringify(primeira.body.system ?? "");
check("modelo configurado", primeira.body.model === "claude-opus-5", primeira.body.model);
check(
  "fallback padrão ligado",
  primeira.body.fallbacks === "default" &&
    String(primeira.headers["anthropic-beta"] ?? "").includes("server-side-fallback-2026-07-01"),
  primeira.headers["anthropic-beta"],
);
check(
  "tabela de preços no prompt",
  /Sofá 3 lugares: higienização R\$\s?180,00/.test(sistema),
  sistema.slice(0, 300),
);
check("instrução da empresa no prompt", sistema.includes("Atendemos só Florianópolis."));
check(
  "prompt fixo com cache",
  JSON.stringify(primeira.body.system?.[0]?.cache_control) === '{"type":"ephemeral"}',
);
const blocos = primeira.body.messages?.[0]?.content ?? [];
check(
  "foto enviada à IA",
  blocos.some((b) => b.type === "image" && b.source?.media_type === "image/jpeg"),
  blocos.map((b) => b.type),
);
check(
  "ferramentas oferecidas",
  (primeira.body.tools ?? []).map((t) => t.name).join(",") ===
    "atualizar_lead,consultar_agenda,passar_para_atendente",
);

let chamadasChatwoot = await log(CHATWOOT);
const enviadas = chamadasChatwoot.filter(
  (c) => c.method === "POST" && c.url.endsWith(`/conversations/951/messages`),
);
check(
  "duas mensagens no WhatsApp",
  enviadas.length === 2,
  enviadas.map((e) => e.body),
);
check(
  "enviadas como robô",
  enviadas.every((e) => e.headers.api_access_token === "token-robo"),
);
check(
  "negrito do WhatsApp",
  enviadas[1]?.body?.content?.includes("*sofá de 3 lugares*"),
  enviadas[1]?.body,
);
check(
  "não privadas",
  enviadas.every((e) => e.body?.private === false),
);

check(
  "lead atualizado pela ferramenta",
  sql(`SELECT upholstery_description || ' | ' || service_interest FROM crm_leads l
  JOIN conversas c ON c.crm_lead_id = l.id WHERE c.chatwoot_conversation_id = 951`) ===
    "Sofá 3 lugares com mancha | Higienização",
);
check(
  "Alice como vendedora do lead",
  sql(`SELECT s.name FROM crm_leads l JOIN conversas c ON c.crm_lead_id = l.id
  JOIN salespeople s ON s.id = l.salesperson_id WHERE c.chatwoot_conversation_id = 951`) ===
    "Alice (IA)",
);
const exec =
  sql(`SELECT rodadas || '|' || tokens_entrada || '|' || tokens_cache_leitura || '|' || (custo_usd > 0) || '|' || array_length(mensagens_enviadas, 1)
  FROM ia_execucoes e JOIN conversas c ON c.id = e.conversa_id WHERE c.chatwoot_conversation_id = 951`);
check("execução registrada com tokens e custo", exec === "2|2400|6000|true|2", exec);

// ---------------------------------------------------------------- 2. mensagens do próprio robô não disparam nada
r = await webhook(
  msg(9102, 1, "Oi! Sou a Alice", {
    message_type: "outgoing",
    sender: { id: 77, type: "agent_bot" },
  }),
);
check("mensagem do robô não agenda", situacao(1) === "responder:concluida", situacao(1));

// ---------------------------------------------------------------- 3. humano assume
r = await webhook(
  msg(9103, 1, "Oi, aqui é a Carol", { message_type: "outgoing", sender: { id: 5, type: "user" } }),
);
const passou = await ate(() => situacao(1) === "responder:concluida,passar_para_humano:concluida");
check("humano escreveu → conversa vai para a equipe", passou, situacao(1));
chamadasChatwoot = await log(CHATWOOT);
check(
  "Chatwoot recebeu 'aberta'",
  chamadasChatwoot.some(
    (c) => c.url.endsWith("/conversations/951/toggle_status") && c.body?.status === "open",
  ),
);
check(
  "conversa marcada como aberta",
  sql(`SELECT status FROM conversas WHERE chatwoot_conversation_id = 951`) === "open",
);
r = await webhook(
  msg(9104, 1, "ok, obrigado", {
    conversation: { id: 951, inbox_id: 4242, status: "open", meta: { sender: pessoa(1) } },
  }),
);
await esperar(1500);
check(
  "depois do humano, a Alice não responde",
  situacao(1) === "responder:concluida,passar_para_humano:concluida",
  situacao(1),
);

// ---------------------------------------------------------------- 4. a IA passa para a equipe
await webhook(conversaNova(2));
await webhook(msg(9201, 2, "Quero falar com uma pessoa"));
const passou2 = await ate(() => situacao(2) === "responder:concluida");
check("passagem pela IA concluída", passou2, situacao(2));
chamadasChatwoot = await log(CHATWOOT);
const daConversa2 = chamadasChatwoot.filter((c) => c.url.includes("/conversations/952/"));
check(
  "avisou o cliente",
  daConversa2.some((c) => c.body?.private === false && c.body?.content?.includes("especialista")),
  daConversa2.map((c) => c.body),
);
check(
  "nota privada com o resumo",
  daConversa2.some(
    (c) => c.body?.private === true && c.body?.content?.includes("Quer falar com atendente."),
  ),
);
check(
  "conversa aberta para a equipe",
  daConversa2.some((c) => c.url.endsWith("/toggle_status") && c.body?.status === "open"),
);

// ---------------------------------------------------------------- 5. processador protegido
const semChave = await fetch(`${APP}/api/public/hooks/alice-processar`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tarefa_id: "00000000-0000-0000-0000-000000000000" }),
});
check("processador sem chave → 401", semChave.status === 401, semChave.status);
const comChave = await fetch(`${APP}/api/public/hooks/alice-processar`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${process.env.NEXA_TAREFAS_SEGREDO}`,
  },
  body: JSON.stringify({ tarefa_id: "00000000-0000-0000-0000-000000000000" }),
});
const corpoComChave = await comChave.json();
check(
  "tarefa inexistente é ignorada",
  comChave.status === 200 && corpoComChave.situacao === "ignorada",
  corpoComChave,
);

// ---------------------------------------------------------------- 6. Alice desligada
sql(`UPDATE ia_configuracoes SET ativo = false WHERE empresa_id = '${EMPRESA}'`);
await webhook(conversaNova(3));
await webhook(msg(9301, 3, "Oi"));
check("Alice desligada não agenda", situacao(3) === "-", situacao(3));

console.log(falhas ? `\n${falhas} falha(s)` : "\nAlice: tudo certo.");
process.exit(falhas ? 1 : 0);
