// Teste ponta a ponta da Alice: webhook do Chatwoot → fila → IA (Claude falso) com ferramentas →
// resposta no Chatwoot (falso) como robô, registro de custo, vendedora e passagem para humano.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

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
// Vídeo padrão no "Storage" local (servido pelo proxy do teste).
fs.mkdirSync(path.join(process.env.STORAGE_DIR, "alice-midias", EMPRESA), { recursive: true });
fs.writeFileSync(
  path.join(process.env.STORAGE_DIR, "alice-midias", EMPRESA, "video-hig.mp4"),
  "video-falso",
);
sql(`INSERT INTO ia_configuracoes (empresa_id, ativo, espera_segundos, instrucoes, hora_inicio, hora_fim, video_higienizacao, espera_apos_midia_segundos)
     VALUES ('${EMPRESA}', true, 1, 'Atendemos só Florianópolis.', 0, 24, '${EMPRESA}/video-hig.mp4', 3)`);
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
check("modelo padrão (Opus 5.5)", primeira.body.model === "claude-opus-5-5", primeira.body.model);
check(
  "conversa no cache automático",
  JSON.stringify(primeira.body.cache_control) === '{"type":"ephemeral"}',
  primeira.body.cache_control,
);
const ultimaMsg = primeira.body.messages?.[primeira.body.messages.length - 1];
check(
  "hora e lead depois da conversa (mensagem de sistema no fim)",
  ultimaMsg?.role === "system" &&
    String(ultimaMsg?.content).startsWith("Agora:") &&
    primeira.body.system?.length === 1,
  { ultima: ultimaMsg, blocosSistema: primeira.body.system?.length },
);
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
const nomesFerramentas = (primeira.body.tools ?? []).map((t) => t.name).join(",");
check(
  "ferramentas da fase 1 (vídeo cadastrado, agenda desligada)",
  nomesFerramentas ===
    "atualizar_lead,consultar_cliente,consultar_cep,consultar_tabela_precos,criar_orcamento,enviar_mensagem,enviar_video,agendar_followup,registrar_motivo_perda,atualizar_etapa,transferir_para_humano",
  nomesFerramentas,
);
check(
  "ferramentas liberadas escritas nas instruções",
  sistema.includes("Ferramentas liberadas agora: atualizar_lead, consultar_cliente"),
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
check(
  "tarefa para a equipe na repescagem",
  sql(`SELECT f.responsavel || '|' || f.status || '|' || (f.notes LIKE '%cliente pediu uma pessoa%')
         FROM crm_followups f JOIN conversas c ON c.crm_lead_id = f.crm_lead_id
        WHERE c.chatwoot_conversation_id = 952`) === "equipe|Pendente|true",
);

// ---------------------------------------------------------------- 4b. orçamento com vídeo e follow-up
const processar = (id) =>
  fetch(`${APP}/api/public/hooks/alice-processar`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NEXA_TAREFAS_SEGREDO}`,
    },
    body: JSON.stringify({ tarefa_id: id }),
  }).then((r) => r.json());
const doChatwoot = async (conversa) =>
  (await log(CHATWOOT)).filter(
    (c) => c.method === "POST" && c.url.endsWith(`/conversations/${conversa}/messages`),
  );

await webhook(conversaNova(4));
await webhook(msg(9401, 4, "Oi, quero o orçamento do sofá"));
check(
  "orçamento respondido",
  await ate(
    () =>
      situacao(4).startsWith("followup:pendente") || situacao(4).includes("responder:concluida"),
  ),
  situacao(4),
);
const textoDe = (c) =>
  c.multipart ? `[anexo ${/filename="([^"]+)"/.exec(c.multipart)?.[1]}]` : c.body?.content;
const antesDaEspera = (await doChatwoot(954)).map(textoDe);
check(
  "primeiro só o aviso e o vídeo; o orçamento espera",
  antesDaEspera.length === 2 && antesDaEspera[1] === "[anexo video-hig.mp4]",
  antesDaEspera,
);
check(
  "resto programado na fila",
  await ate(() => situacao(4).includes("enviar_mensagens:concluida")),
  situacao(4),
);
const msgs4 = await doChatwoot(954);
const ordem = msgs4.map(textoDe);
// O orçamento vai por enviar_mensagem: uma mensagem só, com a linha em branco dentro.
check(
  "ordem: texto, vídeo, orçamento (um bloco), pergunta",
  ordem.length === 4 &&
    ordem[0]?.startsWith("Enquanto eu preparo") &&
    ordem[1] === "[anexo video-hig.mp4]" &&
    ordem[2]?.startsWith("*Higienização Premium*\n✔️") &&
    ordem[2]?.includes("\n\nTotal:") &&
    ordem[3] === "Prontinho! Te enviei a proposta!\nEla faz sentido pra você?",
  ordem,
);
check(
  "valores calculados pelo sistema (total e Pix 5%)",
  /R\$\s?180,00/.test(ordem[2] ?? "") && /R\$\s?171,00/.test(ordem[2] ?? ""),
  ordem[2],
);
check(
  "vídeo enviado como robô",
  msgs4.find((c) => c.multipart)?.headers.api_access_token === "token-robo",
);
check(
  "orçamento gravado no lead",
  sql(`SELECT q.total || '|' || q.valor_a_vista || '|' || q.status || '|' || q.parcelas || '|' || count(i.id)
         FROM quotes q JOIN conversas c ON c.crm_lead_id = q.crm_lead_id
         JOIN quote_items i ON i.quote_id = q.id
        WHERE c.chatwoot_conversation_id = 954 GROUP BY q.id`) === "180.00|171.00|enviado|5|1",
);
check(
  "follow-up agendado para a Alice",
  sql(`SELECT t.situacao || '|' || f.responsavel || '|' || f.status || '|' || (t.executar_apos > now() + interval '9 minutes')
         FROM ia_tarefas t JOIN conversas c ON c.id = t.conversa_id
         JOIN crm_followups f ON f.ia_tarefa_id = t.id
        WHERE c.chatwoot_conversation_id = 954 AND t.tipo = 'followup'`) ===
    "pendente|alice|Pendente|true",
);
await webhook(msg(9402, 4, "vou ver com meu marido"));
check(
  "cliente respondeu: follow-up cancelado",
  sql(`SELECT f.status FROM crm_followups f JOIN ia_tarefas t ON t.id = f.ia_tarefa_id
         JOIN conversas c ON c.id = t.conversa_id WHERE c.chatwoot_conversation_id = 954`) ===
    "Cancelada",
);
await ate(() => !situacao(4).includes("responder:pendente"));

// Cliente escreve antes da hora: o orçamento sai antes da resposta nova.
sql(`UPDATE ia_configuracoes SET espera_apos_midia_segundos = 120 WHERE empresa_id = '${EMPRESA}'`);
await webhook(conversaNova(9));
await webhook(msg(9901, 9, "Oi, quero o orçamento do sofá"));
await ate(() => situacao(9).includes("responder:concluida"));
check("orçamento aguardando", situacao(9).includes("enviar_mensagens:pendente"), situacao(9));
await webhook(msg(9902, 9, "Oi? Chegou o vídeo"));
check(
  "cliente escreveu: orçamento enviado antes da resposta",
  (await ate(() => /responder:concluida.*responder:concluida/.test(situacao(9)))) &&
    situacao(9).includes("enviar_mensagens:concluida"),
  situacao(9),
);
const ordem9 = (await doChatwoot(959)).map(textoDe);
const iOrc = ordem9.findIndex((t) => t?.startsWith("*Higienização Premium*"));
check(
  "ordem com o cliente apressado: vídeo, orçamento, depois a resposta nova",
  ordem9[1] === "[anexo video-hig.mp4]" && iOrc === 2 && ordem9.length > 4,
  ordem9,
);

// Equipe assumiu antes da hora: o orçamento programado não é enviado.
await webhook(conversaNova(10));
await webhook(msg(10001, 10, "Oi, quero o orçamento do sofá"));
await ate(() => situacao(10).includes("responder:concluida"));
const idProgramada = sql(`SELECT t.id FROM ia_tarefas t JOIN conversas c ON c.id = t.conversa_id
  WHERE c.chatwoot_conversation_id = 960 AND t.tipo = 'enviar_mensagens'`);
await webhook(
  msg(10002, 10, "Oi, aqui é a Carol", {
    message_type: "outgoing",
    sender: { id: 5, type: "user" },
  }),
);
await ate(() => situacao(10).includes("passar_para_humano:concluida"));
const antes10 = (await doChatwoot(960)).length;
sql(
  `UPDATE ia_tarefas SET executar_apos = now() - interval '1 second' WHERE id = '${idProgramada}'`,
);
const r10 = await processar(idProgramada);
check(
  "equipe assumiu: orçamento programado não sai",
  r10.situacao === "ignorada" && (await doChatwoot(960)).length === antes10,
  r10,
);
sql(`UPDATE ia_configuracoes SET espera_apos_midia_segundos = 3 WHERE empresa_id = '${EMPRESA}'`);

// ---------------------------------------------------------------- 4c. follow-up na hora
function followupAgora(conversa) {
  return sql(`WITH t AS (
      INSERT INTO ia_tarefas (empresa_id, conversa_id, tipo, executar_apos, enfileirada, dados)
      SELECT empresa_id, id, 'followup', now() - interval '1 second', true,
             '{"trilha":"A","motivo":"sem resposta ao orçamento","mensagem_sugerida":"Viu o orçamento?"}'
        FROM conversas WHERE chatwoot_conversation_id = ${950 + conversa} RETURNING id, empresa_id, conversa_id)
    , f AS (INSERT INTO crm_followups (empresa_id, crm_lead_id, responsavel, ia_tarefa_id)
      SELECT t.empresa_id, c.crm_lead_id, 'alice', t.id FROM t JOIN conversas c ON c.id = t.conversa_id)
    SELECT id FROM t`);
}
await webhook(conversaNova(5));
await webhook(msg(9501, 5, "Oi"));
await ate(() => situacao(5) === "responder:concluida");
const antes5 = (await doChatwoot(955)).length;
const f5 = followupAgora(5);
const r5 = await processar(f5);
const depois5 = await doChatwoot(955);
check("follow-up enviado", r5.situacao === "concluida" && depois5.length === antes5 + 1, r5);
check(
  "texto do follow-up",
  depois5[depois5.length - 1]?.body?.content ===
    "Conseguiu dar uma olhadinha no orçamento, Cliente?",
);
check(
  "repescagem da Alice concluída",
  sql(`SELECT status || '|' || result FROM crm_followups WHERE ia_tarefa_id = '${f5}'`) ===
    "Concluída|Enviado pela Alice",
);

// Fora da janela de 24 h: não manda; vira tarefa da equipe.
await webhook(conversaNova(6));
await webhook(msg(9601, 6, "Oi"));
await ate(() => situacao(6) === "responder:concluida");
sql(`UPDATE whatsapp_messages SET message_timestamp = now() - interval '2 days'
      WHERE conversa_id = (SELECT id FROM conversas WHERE chatwoot_conversation_id = 956)`);
const antes6 = (await doChatwoot(956)).length;
const f6 = followupAgora(6);
const r6 = await processar(f6);
check(
  "fora da janela: nada enviado",
  r6.situacao === "ignorada" && (await doChatwoot(956)).length === antes6,
  r6,
);
check(
  "fora da janela: vira tarefa da equipe",
  sql(`SELECT responsavel || '|' || status FROM crm_followups WHERE ia_tarefa_id = '${f6}'`) ===
    "equipe|Pendente",
);

// ---------------------------------------------------------------- 4d. áudio transcrito
await webhook(conversaNova(7));
await webhook(
  msg(9701, 7, "", {
    attachments: [{ file_type: "audio", data_url: `${CHATWOOT}/audio-cliente.ogg` }],
  }),
);
check("áudio respondido", await ate(() => situacao(7) === "responder:concluida"), situacao(7));
check(
  "transcrição gravada na mensagem",
  sql(`SELECT m.transcricao FROM whatsapp_messages m JOIN conversas c ON c.id = m.conversa_id
        WHERE c.chatwoot_conversation_id = 957`) === "quero higienizar meu sofá amanhã",
);
const speech = (await log(CHATWOOT)).find((c) => c.url.includes("recognizers/_:recognize"));
check(
  "Speech-to-Text chamado com a conta de serviço",
  speech?.headers.authorization === "Bearer token-google" &&
    speech?.body?.config?.languageCodes?.[0] === "pt-BR",
);
check(
  "IA recebeu a transcrição",
  (await doChatwoot(957)).some((c) => c.body?.content?.startsWith("Entendi pelo seu áudio")),
);

// Áudio sem fala reconhecida: o motivo fica gravado na mensagem.
await webhook(conversaNova(13));
await webhook(
  msg(9131, 13, "", {
    attachments: [{ file_type: "audio", data_url: `${CHATWOOT}/audio-mudo.ogg` }],
  }),
);
check(
  "áudio mudo respondido",
  await ate(() => situacao(13) === "responder:concluida"),
  situacao(13),
);
check(
  "motivo da falha da transcrição gravado",
  sql(`SELECT coalesce(m.transcricao, '-') || '|' || m.transcricao_erro FROM whatsapp_messages m
         JOIN conversas c ON c.id = m.conversa_id WHERE c.chatwoot_conversation_id = 963`) ===
    "-|áudio sem fala reconhecida",
);

// ---------------------------------------------------------------- 4e. IA desligada no cliente
await webhook(conversaNova(8));
sql(`UPDATE whatsapp_contacts SET ia_desligada = true
      WHERE id = (SELECT whatsapp_contact_id FROM conversas WHERE chatwoot_conversation_id = 958)`);
await webhook(msg(9801, 8, "Oi"));
check("IA desligada no cliente: nada agendado", situacao(8) === "-", situacao(8));

// ---------------------------------------------------------------- 4g. comandos da equipe
const nota = (id, n, texto, status = "pending") =>
  msg(id, n, texto, {
    message_type: "outgoing",
    private: true,
    sender: { id: 7, name: "Maria", type: "user" },
    conversation: { id: 950 + n, inbox_id: 4242, status, meta: { sender: pessoa(n) } },
  });
const toggles = async (conversa) =>
  (await log(CHATWOOT))
    .filter((c) => c.url.endsWith(`/conversations/${conversa}/toggle_status`))
    .map((c) => c.body?.status);
await webhook(conversaNova(11));
await webhook(msg(9111, 11, "Oi"));
check(
  "comandos: Alice atendeu",
  await ate(() => situacao(11) === "responder:concluida"),
  situacao(11),
);
await webhook(nota(9112, 11, "#parar"));
check(
  "#parar: passada para a equipe",
  await ate(() => situacao(11) === "responder:concluida,passar_para_humano:concluida"),
  situacao(11),
);
const notas11 = (await doChatwoot(961)).filter((c) => c.body?.private);
check(
  "#parar: nota de confirmação no Chatwoot",
  notas11.some((c) => c.body.content.includes("A Alice saiu desta conversa")),
  notas11,
);
check("#parar: conversa aberta para a equipe", (await toggles(961)).at(-1) === "open");
const antesDoAlice = (await doChatwoot(961)).length;
await webhook(
  msg(9113, 11, "Ainda estão aí?", {
    conversation: { id: 961, inbox_id: 4242, status: "open", meta: { sender: pessoa(11) } },
  }),
);
check("com a equipe: Alice não agenda", situacao(11).split(",").length === 2, situacao(11));
await webhook(nota(9114, 11, "#alice", "open"));
check(
  "#alice: devolvida e cliente respondido",
  await ate(
    () =>
      situacao(11) ===
      "responder:concluida,passar_para_humano:concluida,devolver_para_alice:concluida,responder:concluida",
  ),
  situacao(11),
);
check("#alice: conversa volta para pendente", (await toggles(961)).at(-1) === "pending");
const depoisDoAlice = (await doChatwoot(961)).slice(antesDoAlice);
check(
  "#alice: nota e resposta da Alice",
  depoisDoAlice[0]?.body?.private &&
    depoisDoAlice[0].body.content.includes("já vai responder") &&
    depoisDoAlice.some((c) => !c.body?.private),
  depoisDoAlice.map(textoDe),
);

// Equipe assume enquanto a Alice pensa: a resposta pronta é descartada.
sql(`UPDATE ia_configuracoes SET espera_segundos = 60 WHERE empresa_id = '${EMPRESA}'`);
await webhook(conversaNova(12));
await webhook(msg(9121, 12, "Oi"));
const r12 = sql(`SELECT t.id FROM ia_tarefas t JOIN conversas c ON c.id = t.conversa_id
                  WHERE c.chatwoot_conversation_id = 962 AND t.tipo = 'responder'`);
sql(`INSERT INTO ia_tarefas (empresa_id, conversa_id, tipo, executar_apos, enfileirada)
     SELECT empresa_id, id, 'passar_para_humano', now() + interval '1 hour', true
       FROM conversas WHERE chatwoot_conversation_id = 962`);
sql(`UPDATE ia_tarefas SET executar_apos = now() WHERE id = '${r12}'`);
const resultado12 = await processar(r12);
check(
  "equipe assumiu durante a resposta: nada enviado",
  resultado12.detalhe === "humano assumiu durante o processamento" &&
    (await doChatwoot(962)).length === 0,
  resultado12,
);
sql(`UPDATE ia_tarefas SET situacao = 'ignorada' WHERE situacao = 'pendente'
       AND conversa_id = (SELECT id FROM conversas WHERE chatwoot_conversation_id = 962)`);
sql(`UPDATE ia_configuracoes SET espera_segundos = 1 WHERE empresa_id = '${EMPRESA}'`);

// ---------------------------------------------------------------- 4f. varredura da fila
const varreduraSemChave = await fetch(`${APP}/api/public/hooks/alice-varredura`, {
  method: "POST",
});
check("varredura sem chave → 401", varreduraSemChave.status === 401);
const varredura = await fetch(`${APP}/api/public/hooks/alice-varredura`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.NEXA_TAREFAS_SEGREDO}` },
}).then((r) => r.json());
check("varredura responde", varredura.ok === true, varredura);

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
