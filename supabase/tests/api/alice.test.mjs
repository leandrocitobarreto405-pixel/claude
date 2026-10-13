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
    "atualizar_lead,consultar_cliente,consultar_cep,consultar_tabela_precos,criar_orcamento,registrar_indicacao,adicional_pos_fechamento,enviar_mensagem,enviar_video,agendar_followup,registrar_motivo_perda,atualizar_etapa,avisar_equipe,transferir_para_humano",
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
  "relatório interno da IA retido (registrado, não enviado)",
  !ordem.some((t) => t.includes("Ficha do cliente")) &&
    sql(`SELECT count(*) FROM ia_execucoes e JOIN conversas c ON c.id = e.conversa_id
          WHERE c.chatwoot_conversation_id = 954
            AND e.mensagens_enviadas::text LIKE '%não enviado: texto interno%'`) === "1",
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

// Contato interno da equipe (marcado pelo admin): follow-up de cliente não sai.
await webhook(conversaNova(14));
await webhook(msg(96401, 14, "Oi"));
await ate(() => situacao(14) === "responder:concluida");
sql(`INSERT INTO contatos_internos (empresa_id, telefone, nome, chave)
     VALUES ('${EMPRESA}', '11988000014', 'Equipe', '')`);
const antes14 = (await doChatwoot(964)).length;
const f14 = followupAgora(14);
const r14 = await processar(f14);
check(
  "contato interno: follow-up não sai e a repescagem é cancelada",
  r14.situacao === "ignorada" &&
    (await doChatwoot(964)).length === antes14 &&
    sql(`SELECT status FROM crm_followups WHERE ia_tarefa_id = '${f14}'`) === "Cancelada",
  r14,
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

// ---------------------------------------------------------------- 4h. agendamento pela Alice
// Horário livre do técnico daqui a 7 dias, orçamento enviado ao lead; o cliente aceita.
sql(`UPDATE ia_configuracoes SET agenda_automatica = true WHERE empresa_id = '${EMPRESA}'`);
const tecnico = sql(`INSERT INTO technicians (empresa_id, name, base_address)
                     VALUES ('${EMPRESA}', 'Josué Teste', 'Rua X, 1') RETURNING id`);
const diaAg = sql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 7)::text`);
sql(`INSERT INTO agenda_horarios_base (empresa_id, tecnico_id, dia_semana, hora)
     VALUES ('${EMPRESA}', '${tecnico}', extract(dow FROM '${diaAg}'::date)::int, '10:00')`);
sql(`INSERT INTO config_options (empresa_id, kind, name, display_order)
     SELECT '${EMPRESA}', 'service_type', 'Higienização', 1
      WHERE NOT EXISTS (SELECT 1 FROM config_options WHERE empresa_id = '${EMPRESA}'
                          AND kind = 'service_type' AND name ILIKE 'higien%')`);
const orcamento = (n) =>
  sql(`WITH q AS (
         INSERT INTO quotes (empresa_id, cliente_nome, crm_lead_id, subtotal, desconto, total, valor_a_vista, parcelas, status)
         SELECT '${EMPRESA}', 'Cliente ${n}', crm_lead_id, 360, 0, 360, 342, 6, 'enviado'
           FROM conversas WHERE chatwoot_conversation_id = ${950 + n} RETURNING id)
       INSERT INTO quote_items (empresa_id, quote_id, tabela_preco_item_id, nome_snapshot, tipo_servico, preco_tabela, preco_aplicado, quantidade)
       SELECT '${EMPRESA}', q.id, t.id, 'Sofá 3 lugares', 'higienizacao', 180, 180, 2
         FROM q, tabela_precos_itens t WHERE t.empresa_id = '${EMPRESA}' AND t.nome = 'Sofá 3 lugares'
       RETURNING quote_id`);
const proxima = String(
  Number(
    sql(`SELECT coalesce(max(nullif(regexp_replace(os_number, '\\D', '', 'g'), '')::int), 0)
                FROM work_orders WHERE empresa_id = '${EMPRESA}'`),
  ) + 1,
).padStart(4, "0");

await webhook(conversaNova(15));
await webhook(msg(9151, 15, "Oi, quero higienizar meu sofá"));
check(
  "agendamento: Alice atendeu",
  await ate(() => situacao(15) === "responder:concluida"),
  situacao(15),
);
const quote15 = orcamento(15);
check("agendamento: orçamento do lead", Boolean(quote15), quote15);
await webhook(msg(9152, 15, `Pode ser ${diaAg} 10:00, pix`));
check(
  "agendamento: resposta concluída",
  await ate(() => situacao(15) === "responder:concluida,responder:concluida", 25000),
  situacao(15),
);
const os15 =
  sql(`SELECT w.os_number || '|' || w.status || '|' || w.total_gross_value || '|' || w.items_sum || '|' ||
                         w.negotiated_payment_method || '|' || w.negotiated_installments || '|' || s.name || '|' ||
                         o.name || '|' || coalesce(w.adjustment_reason, '-')
                    FROM work_orders w JOIN salespeople s ON s.id = w.salesperson_id
                    JOIN config_options o ON o.id = w.sales_origin_id
                    JOIN crm_leads l ON l.linked_work_order_id = w.id
                    JOIN conversas c ON c.crm_lead_id = l.id AND c.chatwoot_conversation_id = 965`);
const [num15, st15, total15, soma15, forma15, parc15, vend15, origem15, ajuste15] = os15.split("|");
check("agendamento: OS com o próximo número", num15 === proxima, { os15, proxima });
check(
  "agendamento: OS agendada no Pix",
  st15 === "Agendada" && forma15 === "Pix" && parc15 === "1",
  os15,
);
check(
  "agendamento: total do Pix, itens pela tabela",
  Number(total15) === 342 && Number(soma15) === 360,
  os15,
);
check("agendamento: motivo do ajuste", ajuste15.includes("Pix"), ajuste15);
check("agendamento: Alice sozinha → vendedora Alice (IA)", vend15 === "Alice (IA)", vend15);
check("agendamento: sem outra origem → WhatsApp (criada)", origem15 === "WhatsApp", origem15);
check(
  "agendamento: atendimento no dia, hora e técnico",
  sql(`SELECT v.scheduled_date || ' ' || v.scheduled_time || '|' || t.name || '|' || v.status || '|' ||
              (SELECT string_agg(i.description || ' x' || trim_scale(i.quantity) || ' ' || i.unit_price, ',')
                 FROM service_items i WHERE i.visit_id = v.id)
         FROM visits v JOIN work_orders w ON w.id = v.work_order_id JOIN technicians t ON t.id = v.technician_id
        WHERE w.os_number = '${num15}' AND w.empresa_id = '${EMPRESA}'`) ===
    `${diaAg} 10:00:00|Josué Teste|Agendado|Sofá 3 lugares x2 180`,
);
check(
  "agendamento: cliente com endereço completo",
  sql(`SELECT c.full_name || '|' || c.phone || '|' || c.street || ', ' || c.street_number || '|' || c.state || '|' || c.email
         FROM customers c JOIN work_orders w ON w.customer_id = c.id
        WHERE w.os_number = '${num15}' AND w.empresa_id = '${EMPRESA}'`) ===
    "Ana Teste da Silva|5511988000015|Rua Felipe Schmidt, 100|SC|ana@teste.com",
);
check(
  "agendamento: orçamento convertido e lead fechado",
  sql(`SELECT q.status || '|' || l.is_open FROM quotes q JOIN crm_leads l ON l.id = q.crm_lead_id
        WHERE q.id = '${quote15}'`) === "convertido|false",
);
const aviso15 = sql(`SELECT titulo || '|' || mensagem FROM mkt_avisos
                      WHERE empresa_id = '${EMPRESA}' AND tipo = 'agendamento_alice'
                        AND mensagem LIKE '%OS ${num15}%' ORDER BY created_at LIMIT 1`);
check(
  "agendamento: aviso à equipe com cliente, dia, horário e valor",
  aviso15.startsWith("Agendamento feito pela Alice|Ana Teste da Silva") &&
    aviso15.includes("às 10:00") &&
    /R\$\s?342,00 no Pix/.test(aviso15),
  aviso15,
);
check(
  "agendamento: documento desligado → equipe avisada, sem PDF",
  sql(`SELECT count(*) FROM mkt_avisos WHERE empresa_id = '${EMPRESA}' AND titulo = 'OS da Alice sem documento'
         AND mensagem LIKE '%OS ${num15}%'`) === "1",
);
const fala15 = (await doChatwoot(965)).map(textoDe);
check(
  "agendamento: confirmação ao cliente, sem anexo",
  fala15.some((t) => t.includes("Serviço agendado")) &&
    !(await doChatwoot(965)).some((c) => c.multipart),
  fala15,
);
// O mesmo horário não é reservado de novo (outra conversa).
await webhook(conversaNova(16));
await webhook(msg(9161, 16, "Oi"));
await ate(() => situacao(16) === "responder:concluida");
orcamento(16);
await webhook(msg(9162, 16, `Pode ser ${diaAg} 10:00, pix`));
await ate(() => situacao(16) === "responder:concluida,responder:concluida", 25000);
check(
  "agendamento: horário já ocupado não vira outra OS",
  sql(
    `SELECT count(*) FROM visits WHERE empresa_id = '${EMPRESA}' AND scheduled_date = '${diaAg}'`,
  ) === "1" && (await doChatwoot(966)).map(textoDe).some((t) => t.includes("outro")),
  (await doChatwoot(966)).map(textoDe),
);

// Atendente respondeu pelo Chatwoot e devolveu para a Alice: a vendedora é a atendente.
sql(`INSERT INTO agenda_horarios_base (empresa_id, tecnico_id, dia_semana, hora)
     VALUES ('${EMPRESA}', '${tecnico}', extract(dow FROM '${diaAg}'::date)::int, '14:00')`);
await webhook(conversaNova(17));
await webhook(msg(9171, 17, "Oi"));
await ate(() => situacao(17) === "responder:concluida");
await webhook(
  msg(9172, 17, "Oi! Aqui é a Maria, já te ajudo.", {
    message_type: "outgoing",
    sender: { id: 7, name: "Maria Germano", email: "atendimento@turbine.test", type: "user" },
  }),
);
await ate(() => situacao(17).includes("passar_para_humano:concluida"));
await webhook(nota(9173, 17, "#alice", "open"));
await ate(() => situacao(17).endsWith("devolver_para_alice:concluida,responder:concluida"));
orcamento(17);
await webhook(msg(9174, 17, `Pode ser ${diaAg} 14:00, cartao`));
check(
  "agendamento com atendente: concluído",
  await ate(
    () =>
      sql(
        `SELECT count(*) FROM visits WHERE empresa_id = '${EMPRESA}' AND scheduled_date = '${diaAg}'`,
      ) === "2",
    25000,
  ),
  situacao(17),
);
check(
  "agendamento com atendente: vendedora é a atendente; cartão em 3x",
  sql(`SELECT s.name || '|' || w.negotiated_payment_method || '|' || w.negotiated_installments || '|' || w.total_gross_value::numeric(10,2)
         FROM work_orders w JOIN salespeople s ON s.id = w.salesperson_id
         JOIN visits v ON v.work_order_id = w.id
        WHERE w.empresa_id = '${EMPRESA}' AND v.scheduled_date = '${diaAg}' AND v.scheduled_time = '14:00'`) ===
    "Maria|Crédito|3|360.00",
);

// OS criada e o cliente escreve enquanto a Alice ainda responde: a confirmação sai mesmo assim
// e a mensagem nova é respondida depois (uma resposta por vez na conversa).
sql(`INSERT INTO agenda_horarios_base (empresa_id, tecnico_id, dia_semana, hora)
     VALUES ('${EMPRESA}', '${tecnico}', extract(dow FROM '${diaAg}'::date)::int, '15:00'),
            ('${EMPRESA}', '${tecnico}', extract(dow FROM '${diaAg}'::date)::int, '16:00')`);
const visitasAs = (hora) =>
  sql(`SELECT count(*) FROM visits WHERE empresa_id = '${EMPRESA}' AND scheduled_date = '${diaAg}'
         AND scheduled_time = '${hora}'`);
const emAndamento = (n) => /pendente|processando/.test(situacao(n));
await webhook(conversaNova(18));
await webhook(msg(9181, 18, "Oi"));
await ate(() => situacao(18) === "responder:concluida");
orcamento(18);
await webhook(msg(9182, 18, `Pode ser ${diaAg} 15:00, pix [demorar]`));
await ate(() => visitasAs("15:00") === "1", 20000);
await webhook(msg(9183, 18, "Obrigada!"));
await esperar(500);
await ate(() => !emAndamento(18), 40000);
const fala18 = (await doChatwoot(968)).map(textoDe);
check(
  "OS + mensagem nova durante a resposta: confirmação enviada",
  fala18.some((t) => t?.includes("Serviço agendado")),
  fala18,
);
check(
  "OS + mensagem nova: a mensagem nova também é respondida, uma resposta por vez",
  situacao(18) === "responder:concluida,responder:concluida,responder:concluida" &&
    sql(`SELECT count(*) FROM ia_execucoes e JOIN conversas c ON c.id = e.conversa_id
          WHERE c.chatwoot_conversation_id = 968 AND e.erro IS NULL`) === "3",
  situacao(18),
);
check(
  "OS + mensagem nova: a segunda resposta só começa depois que a primeira termina",
  sql(`SELECT (array_agg(t.iniciada_em ORDER BY t.created_at))[3] >= (array_agg(t.concluida_em ORDER BY t.created_at))[2]
         FROM ia_tarefas t JOIN conversas c ON c.id = t.conversa_id WHERE c.chatwoot_conversation_id = 968`) ===
    "t",
);

// OS criada e alguém da equipe escreve enquanto a Alice responde: o cliente não recebe a
// confirmação; a equipe recebe uma nota com a OS.
await webhook(conversaNova(19));
await webhook(msg(9191, 19, "Oi"));
await ate(() => situacao(19) === "responder:concluida");
orcamento(19);
await webhook(msg(9192, 19, `Pode ser ${diaAg} 16:00, pix [demorar]`));
await ate(() => visitasAs("16:00") === "1", 20000);
await webhook(
  msg(9193, 19, "Oi! Aqui é a Maria, vou conferir.", {
    message_type: "outgoing",
    sender: { id: 7, name: "Maria Germano", email: "atendimento@turbine.test", type: "user" },
  }),
);
await esperar(500);
await ate(() => !emAndamento(19), 40000);
const posts19 = await doChatwoot(969);
check(
  "OS + equipe escreveu: o cliente não recebe a confirmação",
  !posts19.some((c) => !c.body?.private && textoDe(c)?.includes("Serviço agendado")),
  posts19.map(textoDe),
);
check(
  "OS + equipe escreveu: nota para a equipe com a OS",
  posts19.some(
    (c) => c.body?.private && /OS \d+ criada .*NÃO recebeu a confirmação/.test(textoDe(c) ?? ""),
  ),
  posts19.map(textoDe),
);
sql(`UPDATE ia_configuracoes SET agenda_automatica = false WHERE empresa_id = '${EMPRESA}'`);

// ---------------------------------------------------------------- 4i. depois do agendamento
// Confirmação na véspera e pós-venda (dados fictícios). Domingo não sai nada: o teste pula.
const domingo =
  sql(`SELECT extract(dow FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::int`) === "0";
if (domingo) {
  console.log("PULADO depois do agendamento (domingo não tem envio)");
} else {
  const amanha = sql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::text`);
  const ontem = sql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1)::text`);
  const hoje = sql(`SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text`);
  // Segunda: o pós-venda de ontem (domingo) também sai, mas o texto livre diz "no domingo".
  await fetch(`${CHATWOOT}/api/v1/accounts/187966/__modelos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      acrescentar: [
        {
          name: "tc_confirmacao_servico",
          language: "pt_BR",
          status: "APPROVED",
          category: "UTILITY",
          components: [
            {
              type: "BODY",
              text: "Oi, {{1}}, tudo bem? Alice aqui 💙 Passando para confirmar o seu serviço de amanhã, com o técnico chegando entre {{2}}. Está tudo certo para realizarmos o serviço?",
            },
          ],
        },
        {
          name: "tc_pos_venda",
          language: "pt_BR",
          status: "APPROVED",
          category: "UTILITY",
          components: [
            {
              type: "BODY",
              text: "Bom dia, {{1}}, tudo bem? Alice aqui 💙 Separamos a pasta do seu serviço, com a OS e as fotos e vídeos de antes e depois: {{2}} Como foi o atendimento do {{3}} ontem? Ficou tudo certo com {{4}} depois do serviço?",
            },
          ],
        },
      ],
    }),
  });
  const contato = (telefone, conversa) =>
    fetch(`${CHATWOOT}/api/v1/accounts/187966/__contato`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ telefone, conversa }),
    });
  // OS da equipe (sem histórico da Alice): cliente, OS e atendimento.
  const osDaEquipe = (n, nome, fone, data, status, concluido) =>
    sql(`WITH c AS (INSERT INTO customers (empresa_id, full_name, phone) VALUES ('${EMPRESA}', '${nome}', '${fone}') RETURNING id),
         w AS (INSERT INTO work_orders (empresa_id, os_number, customer_id, status, total_gross_value)
               SELECT '${EMPRESA}', '${n}', id, '${status === "Concluído" ? "Concluída" : "Agendada"}', 300 FROM c RETURNING id),
         v AS (INSERT INTO visits (empresa_id, work_order_id, scheduled_date, scheduled_time, status, technician_id, completion_date, visit_value)
               SELECT '${EMPRESA}', id, '${data}', '10:00', '${status}', '${tecnico}', ${concluido ? `'${data}'` : "NULL"}, 300 FROM w RETURNING id)
         INSERT INTO service_items (empresa_id, visit_id, description, quantity, unit_price, subtotal)
         SELECT '${EMPRESA}', id, 'Sofá comum 3 lugares — Higienização', 1, 300, 300 FROM v RETURNING visit_id`);
  sql(`INSERT INTO mkt_configuracoes (empresa_id, chatwoot_inbox_id) VALUES ('${EMPRESA}', 4242)
       ON CONFLICT (empresa_id) DO UPDATE SET chatwoot_inbox_id = 4242`);
  sql(`UPDATE ia_configuracoes SET confirmacao_ligada = true, confirmacao_hora = '00:00',
         confirmacao_modelo = 'tc_confirmacao_servico', pos_venda_ligado = true, pos_venda_hora = '00:00',
         pos_venda_modelo = 'tc_pos_venda', avaliacao_ligada = true,
         avaliacao_link = 'https://g.page/r/teste/review' WHERE empresa_id = '${EMPRESA}'`);
  // 1) Cliente nova, sem conversa: janela fechada → modelo.
  osDaEquipe("PV-1", "Ana Teste", "11977000041", amanha, "Agendado", false);
  // 2) Cliente da conversa 17 (a equipe escreveu nela; janela aberta) → texto livre e volta para a Alice.
  await contato("+5511988000017", 967);
  osDaEquipe("PV-2", "Bia Teste", "11988000017", amanha, "Agendado", false);
  // 3) Pós-venda sem pasta para a cliente da conversa 18 (janela aberta) e 4) para a da 19.
  await contato("+5511988000018", 968);
  await contato("+5511988000019", 969);
  osDaEquipe("PV-3", "Cris Teste", "11988000018", ontem, "Concluído", true);
  osDaEquipe("PV-4", "Duda Teste", "11988000019", ontem, "Concluído", true);
  // Mensagens recentes das clientes 17, 18 e 19 (janela de 24 h aberta).
  for (const [id, n] of [
    [9601, 17],
    [9602, 18],
    [9603, 19],
  ])
    await webhook(msg(id, n, "Oi, bom dia"));
  await esperar(1500);
  sql(
    `UPDATE ia_tarefas SET situacao = 'ignorada' WHERE situacao = 'pendente' AND tipo = 'responder'`,
  );
  sql(`UPDATE conversas SET status = 'open' WHERE chatwoot_conversation_id IN (967, 968, 969)`);

  const r = await fetch(`${APP}/api/public/hooks/alice-varredura`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.NEXA_TAREFAS_SEGREDO}` },
  }).then((x) => x.json());
  check("pós-atendimento roda na varredura", r.posAtendimento?.enviados === 4, r.posAtendimento);
  const enviados = (await log(CHATWOOT)).filter(
    (c) => c.method === "POST" && /\/messages$/.test(c.url),
  );
  const modelo = enviados.find((c) => c.body?.template_params?.name === "tc_confirmacao_servico");
  check(
    "janela fechada: modelo da confirmação com nome e janela",
    modelo &&
      JSON.stringify(modelo.body.template_params.processed_params) ===
        JSON.stringify({ body: { 1: "Ana", 2: "10h e 11h" } }),
    modelo?.body,
  );
  const livre967 = enviados.find(
    (c) =>
      c.url.endsWith("/conversations/967/messages") &&
      !c.body?.template_params &&
      /Passando para confirmar/.test(c.body?.content ?? ""),
  );
  check(
    "janela aberta: texto livre na conversa",
    Boolean(livre967),
    enviados.map((c) => c.body?.content),
  );
  check(
    "a equipe tinha assumido e a conversa voltou para a Alice",
    sql(
      `SELECT status || '|' || (devolvida_para_alice_em IS NOT NULL) FROM conversas WHERE chatwoot_conversation_id = 967`,
    ) === "pending|true",
  );
  const pv968 = enviados.find(
    (c) =>
      c.url.endsWith("/conversations/968/messages") &&
      /Separamos a pasta/.test(c.body?.content ?? ""),
  );
  check(
    "pós-venda sem pasta: sem link, técnico e estofado",
    /antes e depois: a equipe te manda o link em seguida\. Como foi o atendimento do Josué/.test(
      pv968?.body?.content ?? "",
    ) && /Ficou tudo certo com o seu sofá depois do serviço\?/.test(pv968?.body?.content ?? ""),
    pv968?.body?.content,
  );
  check(
    "pós-venda sem pasta: nota para a equipe",
    enviados.some(
      (c) =>
        c.url.endsWith("/conversations/968/messages") &&
        c.body?.private &&
        /sem o link da pasta/.test(c.body?.content ?? ""),
    ),
  );
  const r2 = await fetch(`${APP}/api/public/hooks/alice-varredura`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.NEXA_TAREFAS_SEGREDO}` },
  }).then((x) => x.json());
  check("não manda duas vezes", r2.posAtendimento?.enviados === 0, r2.posAtendimento);

  // Respostas: confirmou (OS da equipe → registra e devolve para a equipe).
  await webhook(msg(9611, 17, "Tudo certo, pode vir!"));
  await ate(() => situacao(17).endsWith("responder:concluida"), 25000);
  await ate(
    () =>
      sql(
        `SELECT resposta FROM ia_pos_atendimento WHERE tipo = 'confirmacao' AND work_order_id = (SELECT id FROM work_orders WHERE os_number = 'PV-2')`,
      ) === "confirmou",
    15000,
  );
  check(
    "confirmou: atendimento confirmado e histórico na OS",
    sql(
      `SELECT v.status FROM visits v JOIN work_orders w ON w.id = v.work_order_id WHERE w.os_number = 'PV-2'`,
    ) === "Confirmado" &&
      sql(
        `SELECT count(*) FROM work_order_history h JOIN work_orders w ON w.id = h.work_order_id WHERE w.os_number = 'PV-2' AND h.description LIKE 'Cliente confirmou%'`,
      ) === "1",
  );
  await ate(
    () => sql(`SELECT status FROM conversas WHERE chatwoot_conversation_id = 967`) === "open",
    10000,
  );
  check(
    "OS da equipe: depois da resposta a conversa volta para a equipe",
    sql(`SELECT status FROM conversas WHERE chatwoot_conversation_id = 967`) === "open",
  );

  // Elogio no pós-venda → pedido de avaliação com o link.
  await webhook(msg(9612, 18, "Ficou ótimo, obrigada!"));
  await ate(
    () => sql(`SELECT count(*) FROM ia_pos_atendimento WHERE tipo = 'avaliacao'`) === "1",
    25000,
  );
  const aval = (await log(CHATWOOT)).filter(
    (c) =>
      c.method === "POST" &&
      c.url.endsWith("/conversations/968/messages") &&
      /g\.page\/r\/teste\/review/.test(c.body?.content ?? ""),
  );
  check(
    "elogio: pedido de avaliação com o link, uma vez",
    aval.length === 1,
    aval.map((c) => c.body?.content),
  );

  // Problema no pós-venda → garantia (transferência), sem avaliação.
  await webhook(msg(9613, 19, "Tive um problema, ficou uma marca"));
  await ate(
    async () =>
      (await log(CHATWOOT)).some(
        (c) =>
          c.url.endsWith("/conversations/969/messages") &&
          c.body?.private &&
          /garantia/.test(c.body?.content ?? ""),
      ),
    25000,
  );
  check(
    "problema: transferido como garantia e sem avaliação",
    sql(
      `SELECT resposta FROM ia_pos_atendimento WHERE tipo = 'pos_venda' AND work_order_id = (SELECT id FROM work_orders WHERE os_number = 'PV-4')`,
    ) === "problema" &&
      !(await log(CHATWOOT)).some(
        (c) =>
          c.url.endsWith("/conversations/969/messages") && /g\.page/.test(c.body?.content ?? ""),
      ) &&
      (await log(CHATWOOT)).some(
        (c) =>
          c.url.endsWith("/conversations/969/messages") &&
          c.body?.private &&
          /garantia/.test(c.body?.content ?? ""),
      ),
  );

  // Dia do serviço: a cliente escreve e a Alice não responde (fica com a equipe).
  osDaEquipe("PV-5", "Eva Teste", "11988000016", hoje, "Agendado", false);
  sql(`UPDATE conversas SET status = 'pending' WHERE chatwoot_conversation_id = 966`);
  sql(
    `UPDATE ia_tarefas SET situacao = 'concluida' WHERE situacao = 'pendente' AND conversa_id = (SELECT id FROM conversas WHERE chatwoot_conversation_id = 966)`,
  );
  const antes966 = (await log(CHATWOOT)).filter((c) =>
    c.url.endsWith("/conversations/966/messages"),
  ).length;
  await webhook(msg(9614, 16, "O técnico já está chegando?"));
  await ate(
    () => sql(`SELECT status FROM conversas WHERE chatwoot_conversation_id = 966`) === "open",
    20000,
  );
  const novas966 = (await log(CHATWOOT))
    .filter((c) => c.url.endsWith("/conversations/966/messages"))
    .slice(antes966);
  check(
    "dia do serviço: só nota para a equipe, nada para a cliente",
    novas966.length > 0 &&
      novas966.every((c) => c.body?.private) &&
      novas966.some((c) => /dia do serviço/.test(c.body?.content ?? "")),
    novas966.map((c) => c.body?.content),
  );

  // "Tirar a Alice desta cliente": nada sai para ela (nova OS para amanhã, cliente com IA desligada).
  sql(`UPDATE whatsapp_contacts SET ia_desligada = true WHERE normalized_phone LIKE '%88000019'`);
  osDaEquipe("PV-6", "Duda Teste", "11988000019", amanha, "Agendado", false);
  const r3 = await fetch(`${APP}/api/public/hooks/alice-varredura`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.NEXA_TAREFAS_SEGREDO}` },
  }).then((x) => x.json());
  check(
    "Alice tirada da cliente: confirmação não sai",
    r3.posAtendimento?.enviados === 0 &&
      sql(
        `SELECT situacao || ':' || motivo FROM ia_pos_atendimento WHERE work_order_id = (SELECT id FROM work_orders WHERE os_number = 'PV-6')`,
      ) === "ignorado:Alice tirada desta cliente",
    r3.posAtendimento,
  );
  sql(
    `UPDATE ia_configuracoes SET confirmacao_ligada = false, pos_venda_ligado = false, avaliacao_ligada = false WHERE empresa_id = '${EMPRESA}'`,
  );
  // Não deixa rastro para os testes seguintes (marketing e notificações usam o mesmo banco).
  sql(`UPDATE visits SET status = 'Cancelado', technician_id = NULL
        WHERE work_order_id IN (SELECT id FROM work_orders WHERE os_number LIKE 'PV-%')`);
  sql(`DELETE FROM mkt_tarefas WHERE empresa_id = '${EMPRESA}' AND conversa_id IN
        (SELECT id FROM conversas WHERE chatwoot_conversation_id BETWEEN 966 AND 969)`);
  sql(`UPDATE whatsapp_contacts SET ia_desligada = false, sem_pos_venda = false
        WHERE normalized_phone LIKE '%8800001_'`);
}

// ---------------------------------------------------------------- 4j. leads do site
// Planilha da LP (falsa, dados fictícios): só linhas novas, quem chamou antes/depois do cadastro,
// 9º dígito, número inválido, repetido em 30 min, aviso só no app e envio automático (ligado só
// aqui, para testar).
{
  const PLANILHA = "planilha-leads-teste-000000001";
  const quando = (min) =>
    new Date(Date.now() - min * 60_000).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const tinhaGoogle =
    sql(`SELECT count(*) FROM google_conexoes WHERE empresa_id = '${EMPRESA}'`) !== "0";
  if (!tinhaGoogle) {
    sql(
      `INSERT INTO google_conexoes (empresa_id, email, escopos, situacao) VALUES ('${EMPRESA}', 'turbine@teste.dev', '{}', 'conectada')`,
    );
    sql(
      `INSERT INTO google_conexao_segredos (empresa_id, refresh_token) VALUES ('${EMPRESA}', 'refresh-teste')`,
    );
  }
  await fetch(`${CHATWOOT}/__planilha`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: PLANILHA,
      aba: "Leads",
      valores: [
        [
          "Data e Hora",
          "Nome",
          "WhatsApp",
          "Serviço",
          "utm_source",
          "utm_medium",
          "utm_campaign",
          "utm_term",
          "utm_content",
          "gclid",
          "gbraid",
          "wbraid",
          "fbclid",
          "Página",
        ],
        [
          quando(30),
          "Lia Teste",
          "11966000001",
          "Sofá",
          "google",
          "cpc",
          "lp",
          "higienizar sofá",
          "",
          "gclid-lia",
        ],
        [quando(12), "Rui Teste", "11966000002", "Colchão"],
        [quando(11), "Ivo Teste", "1196600"],
        [quando(7), "Rui Teste", "11966000002", "Colchão"],
        [quando(20), "Gil Teste", "11966000003", "Sofá"],
        [quando(16), "Edu Teste", "11966000004", "Sofá"],
      ],
    }),
  });
  await fetch(`${CHATWOOT}/api/v1/accounts/187966/__modelos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      acrescentar: [
        {
          name: "tc_lead_site",
          language: "pt_BR",
          status: "APPROVED",
          category: "UTILITY",
          components: [
            {
              type: "BODY",
              text: "Oi, {{1}}! Aqui é a Alice, da Turbine Clean 💙 Recebemos seu pedido de orçamento pelo nosso site. Pra eu te passar o valor, me manda uma foto do seu estofado e o seu CEP?",
            },
          ],
        },
      ],
    }),
  });
  // Lia escreveu 25 min atrás (depois do cadastro); Gil, salvo sem o 9, escreveu 40 min atrás
  // (antes do cadastro, dentro de 1 h).
  sql(`WITH c AS (INSERT INTO whatsapp_contacts (empresa_id, normalized_phone) VALUES
         ('${EMPRESA}', '5511966000001'), ('${EMPRESA}', '551166000003') RETURNING id, normalized_phone)
       INSERT INTO whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_timestamp)
       SELECT '${EMPRESA}', id, 'Recebida',
              now() - CASE WHEN normalized_phone = '5511966000001' THEN interval '25 minutes' ELSE interval '40 minutes' END
         FROM c`);
  sql(`INSERT INTO crm_leads (empresa_id, lead_name, phone, normalized_phone, source_type)
       VALUES ('${EMPRESA}', 'Lia Teste', '11966000001', '5511966000001', 'whatsapp')`);
  sql(
    `INSERT INTO leads_site_planilhas (empresa_id, nome, planilha_id) VALUES ('${EMPRESA}', 'LP Teste', '${PLANILHA}')`,
  );
  sql(`INSERT INTO leads_site_configuracoes (empresa_id, envio_ligado, envio_ativado_em, envio_hora_inicio, envio_hora_fim)
       VALUES ('${EMPRESA}', true, now() - interval '1 minute', '00:00', '23:59')`);
  const antesLeads = (await log(CHATWOOT)).length;
  const varrer = () =>
    fetch(`${APP}/api/public/hooks/alice-varredura`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.NEXA_TAREFAS_SEGREDO}` },
    }).then((x) => x.json());
  const l1 = (await varrer()).leadsSite;
  check(
    "leads do site: 6 linhas lidas, 2 chamaram, 2 avisos, 1 modelo enviado",
    l1?.lidos === 6 &&
      l1?.chamaram === 2 &&
      l1?.avisos === 2 &&
      l1?.enviados === 1 &&
      l1?.erros === 0,
    l1,
  );
  const sit = (nome) =>
    sql(`SELECT string_agg(situacao || CASE WHEN repetido_de IS NULL THEN '' ELSE '(repetido)' END, ',' ORDER BY linha)
           FROM leads_site WHERE nome = '${nome}'`);
  check("chamou depois do cadastro", sit("Lia Teste") === "chamou", sit("Lia Teste"));
  check(
    "chamou antes do cadastro, contato sem o 9",
    sit("Gil Teste") === "chamou",
    sit("Gil Teste"),
  );
  check(
    "não chamou + repetido em 30 min",
    sit("Rui Teste") === "nao_chamou,nao_chamou(repetido)",
    sit("Rui Teste"),
  );
  check("número inválido", sit("Ivo Teste") === "invalido", sit("Ivo Teste"));
  const avisosLeads = sql(
    `SELECT count(*) || ':' || bool_and(so_no_app) || ':' || count(whatsapp_enviado_em) FROM mkt_avisos WHERE tipo = 'lead_site_sem_chamar'`,
  );
  check("aviso só no app para Rui e Edu (nunca WhatsApp)", avisosLeads === "2:true:0", avisosLeads);
  const modelos = (await log(CHATWOOT))
    .slice(antesLeads)
    .filter((c) => c.body?.template_params?.name === "tc_lead_site");
  check(
    "modelo tc_lead_site só para o Edu (16 min), com o nome",
    modelos.length === 1 &&
      modelos[0].body.template_params.processed_params?.body?.["1"] === "Edu" &&
      sql(`SELECT modelo_enviado_em IS NOT NULL FROM leads_site WHERE nome = 'Edu Teste'`) === "t",
    modelos.map((m) => m.body?.template_params),
  );
  check(
    "lead do CRM da Lia ganha LP e gclid, origem continua",
    sql(
      `SELECT lp_origem || '|' || gclid || '|' || source_type FROM crm_leads WHERE lead_name = 'Lia Teste'`,
    ) === "LP Teste|gclid-lia|whatsapp",
    sql(`SELECT lp_origem, gclid, source_type FROM crm_leads WHERE lead_name = 'Lia Teste'`),
  );
  const l2 = (await varrer()).leadsSite;
  check(
    "segunda leitura não repete nada",
    l2?.lidos === 0 && l2?.avisos === 0 && l2?.enviados === 0,
    l2,
  );
  // Desligado: o Rui completa 15 min mas nada sai.
  sql(`UPDATE leads_site_configuracoes SET envio_ligado = false WHERE empresa_id = '${EMPRESA}'`);
  sql(
    `UPDATE leads_site SET cadastrado_em = now() - interval '20 minutes' WHERE nome = 'Rui Teste'`,
  );
  const l3 = (await varrer()).leadsSite;
  check("envio desligado: nada sai", l3?.enviados === 0, l3);
  sql(`UPDATE leads_site_planilhas SET ativa = false WHERE empresa_id = '${EMPRESA}'`);
  if (!tinhaGoogle) {
    sql(`DELETE FROM google_conexao_segredos WHERE empresa_id = '${EMPRESA}'`);
    sql(`DELETE FROM google_conexoes WHERE empresa_id = '${EMPRESA}'`);
  }
}

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
