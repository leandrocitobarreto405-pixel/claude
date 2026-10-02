// Teste ponta a ponta do marketing: rotina diária (preparo D-10, bloqueio por modelo não aprovado),
// aprovação, disparo pelo Chatwoot falso (flag, janela, modelo com nome e condição, variante sem
// nome, etiqueta do lote, pausa automática, retomada, conclusão), problema de modelo no disparo,
// tarefas no Chatwoot (opt-out, prioridade), avisos no WhatsApp do dono e avisos da equipe
// (cliente esperando, resumo do dia, nunca para número de cliente).
import { execFileSync } from "node:child_process";
import { createDecipheriv, createECDH, createHmac } from "node:crypto";

const APP = process.env.APP_URL ?? "http://127.0.0.1:3996";
const FAKE = `http://127.0.0.1:${process.env.PORTA_CHATWOOT ?? 3994}`;
const EMP = "11111111-1111-1111-1111-111111111111";
const C1 = "e5000000-0000-0000-0000-000000000001";
const C2 = "e5000000-0000-0000-0000-000000000002";
const C3 = "e5000000-0000-0000-0000-000000000003";

let falhas = 0;
function check(nome, cond, info) {
  console.log(
    `${cond ? "OK  " : "FALHA"} ${nome}${cond ? "" : " -> " + JSON.stringify(info)?.slice(0, 900)}`,
  );
  if (!cond) falhas++;
}
const sql = (q) =>
  execFileSync("psql", ["-XAtq", "-d", process.env.DB_NAME, "-c", q], { encoding: "utf8" }).trim();
const chave = process.env.NEXA_TAREFAS_SEGREDO;
const rota = async (nome, query = "", auth = `Bearer ${chave}`) => {
  const r = await fetch(`${APP}/api/public/hooks/${nome}${query}`, {
    method: "POST",
    headers: { Authorization: auth },
  });
  return { status: r.status, corpo: await r.json().catch(() => null) };
};
const logFake = async () => (await fetch(`${FAKE}/__log`)).json();
const somarDias = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const meses = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};

// ---------------------------------------------------------------- preparação
sql(`UPDATE chatwoot_conexoes SET base_url = '${FAKE}' WHERE webhook_token = repeat('a', 64)`);
sql(`INSERT INTO chatwoot_conexao_segredos (conexao_id, api_token, alice_bot_token)
     VALUES ('c0000000-0000-0000-0000-000000000001', 'token-admin', 'token-robo')
     ON CONFLICT (conexao_id) DO UPDATE SET api_token = 'token-admin', alice_bot_token = 'token-robo'`);
sql(`INSERT INTO mkt_configuracoes (empresa_id, chatwoot_inbox_id, lote_tamanho, amostra_minima, intervalo_segundos)
     VALUES ('${EMP}', 4242, 2, 2, 1)
     ON CONFLICT (empresa_id) DO UPDATE SET chatwoot_inbox_id = 4242, lote_tamanho = 2, amostra_minima = 2,
       intervalo_segundos = 1`);
// Primeiro disparo daqui a uns 12 dias (terça a quinta); "hoje" da rotina = 10 dias antes.
const D = sql(`SELECT private.mkt_proximo_dia_util(current_date + 12)`);
const H = somarDias(D, -10);
// Grupo C4 = comprou há 3–12 meses (na data da rotina).
sql(`SELECT mkt_importar_contatos('${EMP}', '[
  {"telefone": "11955550001", "nome": "Caio Souza", "tipo": "comprador", "servico_em": "${meses(H, -4)}"},
  {"telefone": "11955550999", "nome": "Cliente", "tipo": "comprador", "servico_em": "${meses(H, -5)}"},
  {"telefone": "11955550002", "nome": "Dora", "tipo": "comprador", "servico_em": "${meses(H, -6)}"},
  {"telefone": "11955550003", "nome": "Nina", "tipo": "nao_comprador", "entrada_em": "${meses(H, -1)}"}
]', 'teste e2e')`);
sql(`INSERT INTO mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, templates, datas_disparo, condicao_texto,
       condicao_pct, limites)
     VALUES ('${C1}', '${EMP}', 'Primavera E2E', 'calendario', date_trunc('month', '${D}'::date), '{C4}',
       '{"C4": "tc_oferta_trimestral"}', ARRAY['${D}'::date], '10% na higienização', 10, '{}'),
     ('${C2}', '${EMP}', 'Black Friday E2E', 'calendario', date_trunc('month', '${D}'::date), '{N1}',
       '{"N1": "tc_sazonal_nov"}', ARRAY['${D}'::date], 'frete grátis', NULL, '{}')`);

// ---------------------------------------------------------------- 1. autenticação
check("disparo sem segredo: 401", (await rota("mkt-disparo", "", "Bearer errado")).status === 401);
check("rotina sem segredo: 401", (await rota("mkt-diaria", "", "")).status === 401);

// ---------------------------------------------------------------- 2. rotina D-10
let r = await rota("mkt-diaria", `?empresa=${EMP}&hoje=${H}`);
check("rotina diária", r.status === 200, r);
check(
  "campanha preparada e aguardando aprovação",
  sql(`SELECT status FROM mkt_campanhas WHERE id = '${C1}'`) === "aguardando_aprovacao",
  r.corpo,
);
const NOSSOS = "('5511955550001', '5511955550999', '5511955550002')";
const noC1 =
  sql(`SELECT string_agg(l.numero || ':' || right(e.normalized_phone, 4) || ':' || e.template_nome, ','
                           ORDER BY l.numero, e.ordem)
                    FROM mkt_envios e JOIN mkt_lotes l ON l.id = e.lote_id
                   WHERE e.campanha_id = '${C1}' AND e.normalized_phone IN ${NOSSOS}`);
check(
  "lotes com e sem nome",
  noC1 === "1:0001:tc_oferta_trimestral,1:0999:tc_oferta_trimestral_sn,2:0002:tc_oferta_trimestral",
  noC1,
);
check(
  "aviso para aprovar",
  sql(
    `SELECT count(*) FROM mkt_avisos WHERE campanha_id = '${C1}' AND tipo = 'campanha_para_aprovar'`,
  ) === "1",
);
check(
  "modelo pendente na Meta: campanha bloqueada e aviso",
  sql(`SELECT status || ':' || (motivo_status LIKE '%tc_sazonal_nov%não está aprovado%')::text
         FROM mkt_campanhas WHERE id = '${C2}'`) === "bloqueada:true" &&
    sql(
      `SELECT count(*) FROM mkt_avisos WHERE campanha_id = '${C2}' AND tipo = 'campanha_bloqueada'`,
    ) === "1",
  sql(`SELECT status || ' ' || coalesce(motivo_status, '') FROM mkt_campanhas WHERE id = '${C2}'`),
);
// Só as campanhas deste teste saem (outros contatos da base ficam para trás).
sql(`UPDATE mkt_envios SET status = 'cancelado' WHERE campanha_id = '${C1}'
       AND normalized_phone NOT IN ${NOSSOS}`);
sql(`SELECT mkt_aprovar_campanha('${C1}', NULL, '${H}')`);
check("aprovada", sql(`SELECT status FROM mkt_campanhas WHERE id = '${C1}'`) === "aprovada");

// ---------------------------------------------------------------- 3. disparo
const agora1 = `${D}T10:05:00-03:00`;
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(agora1)}`);
check("flag desligada: nada sai", r.corpo?.disparo?.reservados === 0, r.corpo);
sql(`UPDATE mkt_configuracoes SET disparo_ligado = true WHERE empresa_id = '${EMP}'`);
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(`${D}T08:30:00-03:00`)}`);
check("antes das 10h: nada sai", r.corpo?.disparo?.reservados === 0, r.corpo);
const antes = (await logFake()).length;
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(agora1)}`);
check(
  "lote 1: um enviado, um erro, pausa automática",
  r.corpo?.disparo?.enviados === 1 &&
    r.corpo?.disparo?.erros === 1 &&
    r.corpo?.disparo?.pausas === 1,
  r.corpo,
);
const log1 = (await logFake()).slice(antes);
const criados = log1.filter((x) => x.method === "POST" && x.url.endsWith("/contacts"));
check(
  "contato criado com o primeiro nome (e sem nome no genérico)",
  criados.length === 2 &&
    criados[0].body.name === "Caio" &&
    criados[0].body.phone_number === "+5511955550001" &&
    !("name" in criados[1].body),
  criados.map((x) => x.body),
);
const conversa = log1.find((x) => x.method === "POST" && x.url.endsWith("/conversations"));
check(
  "conversa criada com o robô na caixa 4242",
  conversa?.headers.api_access_token === "token-robo" && conversa?.body.inbox_id === 4242,
  conversa?.body,
);
const modelo = log1.find((x) => x.body?.template_params);
check(
  "modelo com primeiro nome e condição, pelo robô",
  modelo?.headers.api_access_token === "token-robo" &&
    JSON.stringify(modelo?.body.template_params) ===
      JSON.stringify({
        name: "tc_oferta_trimestral",
        category: "MARKETING",
        language: "pt_BR",
        processed_params: { body: { 1: "Caio", 2: "10% na higienização" } },
      }) &&
    modelo?.body.content === "Oi, Caio! 10% na higienização nesta semana.",
  modelo?.body,
);
const etiqueta = log1.find(
  (x) => x.method === "POST" && /\/conversations\/\d+\/labels$/.test(x.url),
);
check(
  "etiqueta do lote na conversa (sem apagar as outras)",
  etiqueta?.body.labels.includes("lead") &&
    etiqueta?.body.labels.some((e) => /^camp-.*-l1$/.test(e)),
  etiqueta?.body,
);
const sn = log1.filter((x) => x.body?.template_params?.name === "tc_oferta_trimestral_sn");
check(
  "variante sem nome: só a condição",
  sn.length === 1 &&
    JSON.stringify(sn[0].body.template_params.processed_params) ===
      JSON.stringify({ body: { 1: "10% na higienização" } }),
  sn.map((x) => x.body),
);
check(
  "envio registrado com a conversa e a mensagem do Chatwoot",
  sql(`SELECT count(*) FROM mkt_envios WHERE campanha_id = '${C1}' AND status = 'enviado'
         AND chatwoot_conversation_id IS NOT NULL AND chatwoot_message_id IS NOT NULL`) === "1",
);
check(
  "erro 131026 conta como bloqueio; lote e campanha pausados com aviso",
  sql(`SELECT bloqueio FROM mkt_envios WHERE campanha_id = '${C1}' AND status = 'erro'`) === "t" &&
    sql(`SELECT status FROM mkt_campanhas WHERE id = '${C1}'`) === "pausada" &&
    sql(
      `SELECT count(*) FROM mkt_avisos WHERE campanha_id = '${C1}' AND tipo = 'pausa_automatica'`,
    ) === "1",
  sql(`SELECT status || ' ' || coalesce(motivo_status, '') FROM mkt_campanhas WHERE id = '${C1}'`),
);

// Retomada: o lote 1 conclui (nada mais a sair); o lote 2 sai na data dele e fecha a campanha.
sql(`SELECT mkt_retomar('${C1}', NULL)`);
const d2 = sql(`SELECT data_prevista FROM mkt_lotes WHERE campanha_id = '${C1}' AND numero = 2`);
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(`${d2}T10:05:00-03:00`)}`);
check(
  "lote 2 enviado",
  r.corpo?.disparo?.enviados === 1 && r.corpo?.disparo?.pausas === 0,
  r.corpo,
);
check(
  "campanha concluída com aviso",
  sql(`SELECT status FROM mkt_campanhas WHERE id = '${C1}'`) === "concluida" &&
    sql(
      `SELECT count(*) FROM mkt_avisos WHERE campanha_id = '${C1}' AND tipo = 'campanha_concluida'`,
    ) === "1",
  sql(`SELECT string_agg(numero || ':' || status, ',') FROM mkt_lotes WHERE campanha_id = '${C1}'`),
);

// ---------------------------------------------------------------- 4. modelo inexistente no disparo
sql(`INSERT INTO mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, datas_disparo, status)
     VALUES ('${C3}', '${EMP}', 'Modelo sumiu', 'calendario', date_trunc('month', '${D}'::date), '{C4}',
       ARRAY['${D}'::date], 'aprovada')`);
sql(`INSERT INTO mkt_lotes (id, empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, status)
     VALUES ('e6000000-0000-0000-0000-000000000003', '${EMP}', '${C3}', 1, 'camp-x-l1', '${D}', 'aprovado')`);
sql(`INSERT INTO mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome,
       status, agendado_para)
     SELECT '${EMP}', '${C3}', 'e6000000-0000-0000-0000-000000000003', id, normalized_phone, 'C4', 'tc_sumiu',
            'pendente', '${D} 10:00-03' FROM mkt_contatos WHERE normalized_phone = '5511955550002'`);
const antes2 = (await logFake()).length;
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(agora1)}`);
check(
  "modelo inexistente: pausa a campanha sem enviar",
  r.corpo?.disparo?.enviados === 0 &&
    r.corpo?.disparo?.devolvidos === 1 &&
    sql(`SELECT status FROM mkt_campanhas WHERE id = '${C3}'`) === "pausada" &&
    sql(`SELECT status FROM mkt_envios WHERE campanha_id = '${C3}'`) === "pendente" &&
    !(await logFake()).slice(antes2).some((x) => x.body?.template_params),
  r.corpo,
);

// ---------------------------------------------------------------- 5. tarefas no Chatwoot
const conv =
  sql(`SELECT id || '|' || chatwoot_conversation_id FROM conversas WHERE empresa_id = '${EMP}'
                    ORDER BY created_at LIMIT 1`).split("|");
sql(`INSERT INTO mkt_tarefas (empresa_id, tipo, conversa_id) VALUES
       ('${EMP}', 'etiqueta_optout', '${conv[0]}'), ('${EMP}', 'prioridade_urgente', '${conv[0]}')`);
const antes3 = (await logFake()).length;
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(agora1)}`);
const log3 = (await logFake()).slice(antes3);
const optout = log3.find(
  (x) => x.method === "POST" && x.url.endsWith(`/conversations/${conv[1]}/labels`),
);
check(
  "opt-out: tira etiquetas de campanha e põe optout",
  JSON.stringify(optout?.body.labels) === JSON.stringify(["lead", "optout"]),
  optout?.body,
);
check(
  "prioridade urgente",
  log3.some(
    (x) =>
      x.url.endsWith(`/conversations/${conv[1]}/toggle_priority`) && x.body.priority === "urgent",
  ),
);
check(
  "tarefas feitas",
  sql(`SELECT count(*) FROM mkt_tarefas WHERE situacao = 'feita'`) === "2",
  r.corpo?.tarefas,
);

// ---------------------------------------------------------------- 6. avisos no WhatsApp do dono
sql(`UPDATE mkt_configuracoes SET aviso_whatsapp_ligado = true, aviso_telefone = '11955558888',
       aviso_template_nome = 'nexa_aviso' WHERE empresa_id = '${EMP}'`);
const antes4 = (await logFake()).length;
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(agora1)}`);
const avisos = (await logFake())
  .slice(antes4)
  .filter((x) => x.body?.template_params?.name === "nexa_aviso");
const pendentes =
  sql(`SELECT count(*) FROM mkt_avisos WHERE empresa_id = '${EMP}' AND whatsapp_enviado_em IS NULL
                         AND created_at > now() - interval '1 day'`);
check(
  "avisos recentes no WhatsApp do dono, uma linha só",
  avisos.length > 0 &&
    avisos.every((x) => !/\n/.test(x.body.template_params.processed_params.body["1"])) &&
    avisos.some((x) =>
      /Campanha para aprovar/.test(x.body.template_params.processed_params.body["1"]),
    ),
  { avisos: avisos.length, pendentes, avisosResultado: r.corpo?.avisos },
);
const contatoDono = (await logFake())
  .slice(antes4)
  .filter((x) => x.method === "POST" && x.url.endsWith("/contacts"));
check("dono: uma conversa só para os avisos", contatoDono.length === 1, contatoDono.length);

// ---------------------------------------------------------------- 7. Alice com cliente da campanha
const CLAUDE = `http://127.0.0.1:${process.env.PORTA_CLAUDE ?? 3995}`;
const caio = { id: 1801, name: "Caio", phone_number: "+5511955550001", type: "contact" };
const webhook = (corpo) =>
  fetch(`${APP}/api/public/hooks/chatwoot/${"a".repeat(64)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
sql(`UPDATE ia_configuracoes SET ativo = true WHERE empresa_id = '${EMP}'`);
const antesClaude = (await (await fetch(`${CLAUDE}/__log`)).json()).length;
await webhook({
  event: "conversation_created",
  id: 1990,
  inbox_id: 4242,
  status: "pending",
  account: { id: 187966 },
  meta: { sender: caio },
  created_at: 1790100000,
  updated_at: 1790100001,
  last_activity_at: 1790100000,
});
await webhook({
  event: "message_created",
  id: 19901,
  message_type: "incoming",
  content: "Oi! Quero usar a condição da campanha no meu sofá",
  private: false,
  created_at: new Date().toISOString(),
  account: { id: 187966 },
  inbox: { id: 4242 },
  sender: caio,
  conversation: { id: 1990, inbox_id: 4242, status: "pending", meta: { sender: caio } },
});
const situacaoCaio = () =>
  sql(`SELECT coalesce(string_agg(t.tipo || ':' || t.situacao, ','), '-') FROM ia_tarefas t
         JOIN conversas c ON c.id = t.conversa_id WHERE c.chatwoot_conversation_id = 1990 AND t.tipo = 'responder'`);
for (let i = 0; i < 80 && situacaoCaio() !== "responder:concluida"; i++)
  await new Promise((ok) => setTimeout(ok, 250));
check(
  "Alice respondeu o cliente da campanha",
  situacaoCaio() === "responder:concluida",
  situacaoCaio(),
);
check(
  "resposta ligada ao envio da campanha",
  sql(`SELECT count(*) FROM mkt_envios WHERE campanha_id = '${C1}' AND normalized_phone = '5511955550001'
         AND respondido_em IS NOT NULL AND crm_lead_id IS NOT NULL`) === "1",
);
const rodadas = (await (await fetch(`${CLAUDE}/__log`)).json()).slice(antesClaude);
const resultados = JSON.stringify(rodadas.map((x) => x.body.messages));
check(
  "consultar_cliente traz a campanha, o grupo e a condição",
  resultados.includes('Veio de disparo de marketing: campanha \\"Primavera E2E\\"') &&
    resultados.includes("grupo C4, modelo tc_oferta_trimestral") &&
    resultados.includes("Condição da campanha: 10% na higienização — 10%"),
  resultados.slice(
    resultados.indexOf("Base de marketing") - 20,
    resultados.indexOf("Base de marketing") + 700,
  ),
);
check(
  "orçamento com o desconto da campanha em linha separada e Pix sobre o total com desconto",
  sql(`SELECT subtotal || '|' || desconto || '|' || total || '|' || valor_a_vista FROM quotes
         WHERE cliente_telefone LIKE '%955550001' ORDER BY created_at DESC LIMIT 1`) ===
    "180.00|18.00|162.00|153.90" &&
    resultados.includes("Condição da campanha Primavera E2E (10%): -R$"),
  sql(
    `SELECT subtotal || '|' || desconto || '|' || total || '|' || valor_a_vista FROM quotes ORDER BY created_at DESC LIMIT 1`,
  ),
);
check(
  "indicação registrada e indicado pré-cadastrado",
  sql(`SELECT count(*) FROM indicacoes i JOIN mkt_contatos c ON c.id = i.indicador_contato_id
         WHERE i.indicado_phone = '5511955557777' AND c.normalized_phone = '5511955550001'
           AND i.indicado_contato_id IS NOT NULL`) === "1" &&
    sql(`SELECT tipo FROM mkt_contatos WHERE normalized_phone = '5511955557777'`) ===
      "nao_comprador",
);

// ---------------------------------------------------------------- 8. pós-venda (C1): janela de 24 h
// Caio escreveu agora (seção 7): vai como mensagem comum. Dora não escreveu: vai o modelo.
const C1C = "e5000000-0000-0000-0000-0000000000c1";
const hojeSP = sql(`SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date`);
sql(`INSERT INTO mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, gatilho, template_nome, status, grupos)
     VALUES ('${C1C}', '${EMP}', 'Pós-venda teste', 'gatilho', '2030-01-01', 'C1', 'tc_posvenda_resultado',
       'enviando', '{C1}')`);
sql(`INSERT INTO mkt_lotes (id, empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, status)
     VALUES ('e6000000-0000-0000-0000-0000000000c1', '${EMP}', '${C1C}', 1, 'gat-c1-teste', '${hojeSP}', 'aprovado')`);
sql(`INSERT INTO mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome,
       status, agendado_para, gatilho_ref, ordem)
     SELECT '${EMP}', '${C1C}', 'e6000000-0000-0000-0000-0000000000c1', id, normalized_phone, 'C1',
            'tc_posvenda_resultado', 'pendente', '${hojeSP} 09:00-03', 'C1:teste:' || normalized_phone,
            CASE normalized_phone WHEN '5511955550001' THEN 0 ELSE 1 END
       FROM mkt_contatos WHERE normalized_phone IN ('5511955550001', '5511955550002')`);
sql(`UPDATE mkt_configuracoes SET gatilho_c1_ligado = true WHERE empresa_id = '${EMP}'`);
const antes5 = (await logFake()).length;
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(`${hojeSP}T10:05:00-03:00`)}`);
const log5 = (await logFake())
  .slice(antes5)
  .filter((x) => x.method === "POST" && x.url.endsWith("/messages"));
const paraCaio = log5.find((x) => x.url.includes("/conversations/1990/"));
const paraDora = log5.find((x) => x.body?.template_params?.name === "tc_posvenda_resultado");
check(
  "C1 com o cliente tendo escrito nas últimas 24 h: mensagem comum, sem modelo",
  r.corpo?.disparo?.enviados === 2 &&
    paraCaio &&
    !paraCaio.body.template_params &&
    paraCaio.body.content ===
      "Oi, Caio! Aqui é a Alice, da Turbine Clean. Como ficou o seu estofado depois do serviço?" &&
    paraCaio.headers.api_access_token === "token-robo",
  { disparo: r.corpo?.disparo, msgs: log5.map((x) => [x.url, x.body]) },
);
check(
  "C1 fora da janela: modelo de utilidade com o primeiro nome",
  JSON.stringify(paraDora?.body.template_params) ===
    JSON.stringify({
      name: "tc_posvenda_resultado",
      category: "UTILITY",
      language: "pt_BR",
      processed_params: { body: { 1: "Dora" } },
    }),
  paraDora?.body,
);
check(
  "envio em texto livre registrado",
  sql(
    `SELECT count(*) FROM mkt_eventos WHERE resultado = 'texto_livre' AND campanha_id = '${C1C}'`,
  ) === "1",
);

// ---------------------------------------------------------------- 9. reclamação no pós-venda
const dora = { id: 1802, name: "Dora", phone_number: "+5511955550002", type: "contact" };
await webhook({
  event: "conversation_created",
  id: 1992,
  inbox_id: 4242,
  status: "pending",
  account: { id: 187966 },
  meta: { sender: dora },
  created_at: 1790100000,
  updated_at: 1790100001,
  last_activity_at: 1790100000,
});
await webhook({
  event: "message_created",
  id: 19921,
  message_type: "incoming",
  content: "O sofá ficou manchado, não gostei",
  private: false,
  created_at: new Date().toISOString(),
  account: { id: 187966 },
  inbox: { id: 4242 },
  sender: dora,
  conversation: { id: 1992, inbox_id: 4242, status: "pending", meta: { sender: dora } },
});
const situacaoDora = () =>
  sql(`SELECT coalesce(string_agg(t.tipo || ':' || t.situacao, ','), '-') FROM ia_tarefas t
         JOIN conversas c ON c.id = t.conversa_id WHERE c.chatwoot_conversation_id = 1992 AND t.tipo = 'responder'`);
const antesDora = (await logFake()).length;
const antesClaudeDora = (await (await fetch(`${CLAUDE}/__log`)).json()).length;
for (let i = 0; i < 80 && situacaoDora() !== "responder:concluida"; i++)
  await new Promise((ok) => setTimeout(ok, 250));
const logDora = (await logFake())
  .slice(antesDora)
  .filter((x) => x.url.includes("/conversations/1992/"));
check(
  "reclamação: Alice passa para a equipe com prioridade",
  situacaoDora() === "responder:concluida" &&
    logDora.some((x) => x.url.endsWith("/toggle_status") && x.body?.status === "open") &&
    logDora.some(
      (x) =>
        x.body?.private && String(x.body.content).includes("PRIORIDADE (problema no pós-venda)"),
    ),
  { situacao: situacaoDora(), chamadas: logDora.map((x) => [x.url, x.body]) },
);
check(
  "reclamação: sem pós-venda, prioridade urgente e aviso",
  sql(`SELECT sem_pos_venda FROM mkt_contatos WHERE normalized_phone = '5511955550002'`) === "t" &&
    sql(
      `SELECT bool_and(sem_pos_venda) FROM whatsapp_contacts WHERE normalized_phone = '5511955550002'`,
    ) === "t" &&
    sql(`SELECT count(*) FROM mkt_tarefas t JOIN conversas c ON c.id = t.conversa_id
          WHERE c.chatwoot_conversation_id = 1992 AND t.tipo = 'prioridade_urgente'`) === "1" &&
    sql(
      `SELECT count(*) FROM mkt_avisos WHERE tipo = 'problema_pos_venda' AND mensagem LIKE 'Dora reclamou%'`,
    ) === "1",
  sql(
    `SELECT string_agg(tipo || ':' || mensagem, ' | ') FROM mkt_avisos WHERE tipo = 'problema_pos_venda'`,
  ),
);
const rodadasDora = JSON.stringify(
  (await (await fetch(`${CLAUDE}/__log`)).json()).slice(antesClaudeDora),
);
check(
  "consultar_cliente avisa a Alice que é resposta ao pós-venda",
  rodadasDora.includes("Recebeu a mensagem de pós-venda"),
  rodadasDora.slice(0, 400),
);

// ---------------------------------------------------------------- 10. avisos da equipe
const nexaAvisos = async (desde) =>
  (await logFake())
    .slice(desde)
    .filter((x) => x.body?.template_params?.name === "nexa_aviso")
    .map((x) => x.body.template_params.processed_params.body["1"]);
sql(`UPDATE mkt_configuracoes SET aviso_whatsapp_ligado = true, aviso_telefone = '11955558888',
       aviso_template_nome = 'nexa_aviso', aviso_espera_minutos = 10 WHERE empresa_id = '${EMP}'`);
sql(`INSERT INTO conversas (empresa_id, conexao_id, chatwoot_conversation_id, status, aguardando_desde,
       ultima_atividade_em)
     VALUES ('${EMP}', 'c0000000-0000-0000-0000-000000000001', 99001, 'open', now() - interval '20 minutes',
       now() - interval '20 minutes'),
            ('${EMP}', 'c0000000-0000-0000-0000-000000000001', 99002, 'open', now() - interval '3 minutes',
       now() - interval '3 minutes')`);
let antes10 = (await logFake()).length;
r = await rota("mkt-disparo");
let enviados10 = await nexaAvisos(antes10);
check(
  "espera de 20 min vira aviso no WhatsApp da equipe; a de 3 min ainda não",
  sql(`SELECT count(*) FROM mkt_avisos WHERE tipo = 'cliente_esperando'`) === "1" &&
    enviados10.some((t) => /espera resposta da equipe há 2\d min/.test(t)),
  { espera: r.corpo?.espera, enviados10 },
);
antes10 = (await logFake()).length;
r = await rota("mkt-disparo");
check(
  "a mesma espera não é avisada duas vezes",
  sql(`SELECT count(*) FROM mkt_avisos WHERE tipo = 'cliente_esperando'`) === "1" &&
    (await nexaAvisos(antes10)).length === 0,
  r.corpo?.espera,
);

// Número de cliente (Caio, da base de marketing) no lugar do celular da equipe: nada sai.
for (const fone of ["11955550001", "1155550001"]) {
  sql(`UPDATE mkt_configuracoes SET aviso_telefone = '${fone}' WHERE empresa_id = '${EMP}'`);
  sql(`INSERT INTO mkt_avisos (empresa_id, tipo, titulo, mensagem)
       VALUES ('${EMP}', 'teste', 'Teste', 'não pode chegar no cliente ${fone}')`);
  antes10 = (await logFake()).length;
  r = await rota("mkt-disparo");
  const depois = (await logFake()).slice(antes10);
  check(
    `nenhum aviso para número de cliente (${fone})`,
    depois.filter((x) => x.body?.template_params).length === 0 &&
      sql(
        `SELECT count(*) FROM mkt_avisos WHERE mensagem LIKE '%${fone}' AND whatsapp_enviado_em IS NULL`,
      ) === "1",
    { avisos: r.corpo?.avisos, depois: depois.length },
  );
}
sql(`UPDATE mkt_configuracoes SET aviso_telefone = '11955558888', aviso_resumo_diario = true
     WHERE empresa_id = '${EMP}'`);
const hojeResumo = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
r = await rota("mkt-diaria", `?empresa=${EMP}&hoje=${hojeResumo}`);
check(
  "resumo do dia às 9h para a equipe",
  sql(`SELECT count(*) FROM mkt_avisos WHERE tipo = 'resumo_diario'`) === "1" &&
    /clientes? esperando a equipe/.test(
      sql(`SELECT mensagem FROM mkt_avisos WHERE tipo = 'resumo_diario'`),
    ),
  r.corpo,
);

// ---------------------------------------------------------------- 11. promoção para agenda vazia
// Caio escreveu há pouco (texto livre), Fabio nunca escreveu (modelo com 3 variáveis) e Eva vira
// contato interno depois de a promoção ser criada (o envio dela é cancelado no disparo).
sql(`UPDATE mkt_configuracoes SET disparo_ligado = true WHERE empresa_id = '${EMP}'`);
const promo = JSON.parse(
  sql(`SELECT mkt_criar_promocao('${EMP}', NULL, '[
    {"telefone": "11955550001", "nome": "Caio Souza"},
    {"telefone": "11955550444", "nome": "Eva Lima"},
    {"telefone": "11955550445", "nome": "Fabio Reis"}
  ]'::jsonb, 20, 5, 'tc_promocao_agenda')`),
);
check("promoção criada para 3", promo.envios === 3, promo);
sql(
  `UPDATE mkt_envios SET agendado_para = '${hojeSP} 09:00-03' WHERE campanha_id = '${promo.campanha}'`,
);
sql(`INSERT INTO contatos_internos (empresa_id, telefone, nome, chave)
     VALUES ('${EMP}', '11955550444', 'Eva (equipe)', '')`);
const antes11 = (await logFake()).length;
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(`${hojeSP}T10:05:00-03:00`)}`);
const log11 = (await logFake())
  .slice(antes11)
  .filter((x) => x.method === "POST" && x.url.endsWith("/messages"));
const promoCaio = log11.find((x) => x.url.includes("/conversations/1990/"));
const promoFabio = log11.find((x) => x.body?.template_params?.name === "tc_promocao_agenda");
check(
  "promoção: Caio (escreveu há pouco) recebe o texto como mensagem comum",
  promoCaio &&
    !promoCaio.body.template_params &&
    promoCaio.body.content ===
      "Oi, Caio! Aqui é da Turbine Clean. Abriu um horário amanhã e consigo fazer o seu serviço com 20% de desconto, e mais 5% se pagar no Pix. Quer que eu reserve para você?",
  { disparo: r.corpo?.disparo, msgs: log11.map((x) => [x.url, x.body]) },
);
check(
  "promoção: modelo com nome, desconto e Pix",
  JSON.stringify(promoFabio?.body.template_params) ===
    JSON.stringify({
      name: "tc_promocao_agenda",
      category: "MARKETING",
      language: "pt_BR",
      processed_params: { body: { 1: "Fabio", 2: "20%", 3: "5%" } },
    }),
  promoFabio?.body,
);
check(
  "promoção: contato interno cancelado, nada enviado para ele",
  r.corpo?.disparo?.enviados === 2 &&
    sql(`SELECT e.status || '|' || e.erro FROM mkt_envios e
          WHERE e.campanha_id = '${promo.campanha}' AND e.normalized_phone = '5511955550444'`) ===
      "cancelado|contato interno da equipe",
  r.corpo?.disparo,
);
// Aviso da equipe para um número interno que também é contato de marketing: agora sai.
sql(`UPDATE mkt_configuracoes SET aviso_telefone = '11955550444' WHERE empresa_id = '${EMP}'`);
sql(`INSERT INTO mkt_avisos (empresa_id, tipo, titulo, mensagem)
     VALUES ('${EMP}', 'teste', 'Teste', 'aviso para o interno')`);
const antes11b = (await logFake()).length;
r = await rota("mkt-disparo");
check(
  "contato interno recebe os avisos da equipe",
  (await nexaAvisos(antes11b)).some((t) => t.includes("aviso para o interno")),
  r.corpo?.avisos,
);

// ---------------------------------------------------------------- 12. textos editados no app
// Pós-venda com o cliente tendo escrito há pouco: sai o texto editado (sem aprovação da Meta).
sql(`INSERT INTO mensagens_textos (empresa_id, chave, texto)
     VALUES ('${EMP}', 'livre_posvenda', 'Oi {nome}! Como ficou o estofado? Qualquer coisa é só falar.'),
            ('${EMP}', 'aviso_espera', 'Atenção: {cliente} aguarda há {minutos} min.')`);
sql(`INSERT INTO mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome,
       status, agendado_para, gatilho_ref, ordem)
     SELECT '${EMP}', '${C1C}', 'e6000000-0000-0000-0000-0000000000c1', id, normalized_phone, 'C1',
            'tc_posvenda_resultado', 'pendente', '${hojeSP} 09:00-03', 'C1:teste2:' || normalized_phone, 5
       FROM mkt_contatos WHERE normalized_phone = '5511955550001'`);
sql(`UPDATE mkt_lotes SET status = 'enviando' WHERE id = 'e6000000-0000-0000-0000-0000000000c1'`);
sql(`UPDATE mkt_campanhas SET status = 'enviando' WHERE id = '${C1C}'`);
const antes12 = (await logFake()).length;
r = await rota("mkt-disparo", `?agora=${encodeURIComponent(`${hojeSP}T10:10:00-03:00`)}`);
const log12 = (await logFake())
  .slice(antes12)
  .filter((x) => x.method === "POST" && x.url.endsWith("/messages") && !x.body?.template_params);
check(
  "pós-venda em texto livre usa o texto editado no app",
  log12.some(
    (x) => x.body?.content === "Oi Caio! Como ficou o estofado? Qualquer coisa é só falar.",
  ),
  { disparo: r.corpo?.disparo, msgs: log12.map((x) => x.body?.content) },
);
sql(`INSERT INTO conversas (empresa_id, conexao_id, chatwoot_conversation_id, status, aguardando_desde,
       ultima_atividade_em)
     VALUES ('${EMP}', 'c0000000-0000-0000-0000-000000000001', 99003, 'open', now() - interval '25 minutes',
       now() - interval '25 minutes')`);
r = await rota("mkt-disparo");
check(
  "aviso de cliente esperando usa o texto editado no app",
  /^Atenção: .+ aguarda há 2\d min\.$/.test(
    sql(`SELECT mensagem FROM mkt_avisos a JOIN conversas c ON c.id = a.conversa_id
          WHERE c.chatwoot_conversation_id = 99003`),
  ),
  r.corpo?.espera,
);

// ---------------------------------------------------------------- 13. notificações no celular
// Admin (espera de 5 min) e técnico com celular ativo; um celular antigo que cancelou (410).
const celular = () => {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { ecdh, auth: Buffer.from("segredo-auth-16b") };
};
const abrir = (cel, b64) => {
  const c = Buffer.from(b64, "base64");
  const h = (k, v) => createHmac("sha256", k).update(v).digest();
  const sal = c.subarray(0, 16);
  const asPub = c.subarray(21, 86);
  const dados = c.subarray(86);
  const ikm = h(
    h(cel.auth, cel.ecdh.computeSecret(asPub)),
    Buffer.concat([
      Buffer.from("WebPush: info\0"),
      cel.ecdh.getPublicKey(),
      asPub,
      Buffer.from([1]),
    ]),
  );
  const prk = h(sal, ikm);
  const dec = createDecipheriv(
    "aes-128-gcm",
    h(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16),
    h(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12),
  );
  dec.setAuthTag(dados.subarray(dados.length - 16));
  const claro = Buffer.concat([dec.update(dados.subarray(0, dados.length - 16)), dec.final()]);
  return JSON.parse(claro.subarray(0, -1).toString());
};
const celAdmin = celular();
const celTec = celular();
const celVelho = celular();
const ADM = "00000000-0000-0000-0000-00000000f001";
const TEC = "00000000-0000-0000-0000-00000000f002";
sql(
  `INSERT INTO auth.users (id, email) VALUES ('${ADM}', 'adm@push.test'), ('${TEC}', 'tec@push.test')`,
);
sql(
  `INSERT INTO usuarios_empresa (user_id, empresa_id, papel) VALUES ('${ADM}', '${EMP}', 'admin'), ('${TEC}', '${EMP}', 'tecnico')`,
);
const insc = (user, nome, cel) =>
  `('${EMP}', '${user}', 'http://127.0.0.1:3994/push/${nome}', '${cel.ecdh.getPublicKey().toString("base64url")}', '${cel.auth.toString("base64url")}')`;
// Banco de teste (descartável): libera o endereço http do serviço de push falso.
sql(`ALTER TABLE push_inscricoes DROP CONSTRAINT push_inscricoes_endpoint_check`);
sql(`INSERT INTO push_inscricoes (empresa_id, user_id, endpoint, p256dh, auth)
     VALUES ${insc(ADM, "admin", celAdmin)}, ${insc(TEC, "tec", celTec)}, ${insc(ADM, "velho", celVelho)}`);
sql(
  `INSERT INTO push_preferencias (empresa_id, user_id, espera_minutos) VALUES ('${EMP}', '${ADM}', 5)`,
);
// Caio escreveu (seção 7) e a conversa ficou com a equipe há 7 min; campanha esperando aprovação.
sql(`UPDATE conversas SET status = 'open', aguardando_desde = now() - interval '7 minutes'
      WHERE chatwoot_conversation_id = 1990`);
sql(`UPDATE whatsapp_messages SET created_at = now() - interval '8 minutes'
      WHERE conversa_id = (SELECT id FROM conversas WHERE chatwoot_conversation_id = 1990)`);
sql(`INSERT INTO mkt_campanhas (empresa_id, nome, tipo, mes_ref, status, grupos)
     VALUES ('${EMP}', 'Campanha do push', 'calendario', '2031-01-01', 'aguardando_aprovacao', '{C4}')`);
const antes13 = (await logFake()).length;
r = await rota("mkt-disparo");
const pushes = (await logFake()).slice(antes13).filter((x) => x.url.startsWith("/push/"));
const doAdmin = pushes
  .filter((x) => x.url === "/push/admin")
  .map((x) => abrir(celAdmin, x.bruto64));
check(
  "push: admin recebe cliente esperando e campanha, com a tela certa",
  doAdmin.some((n) => n.titulo === "Cliente esperando a equipe" && /^\/conversas\//.test(n.url)) &&
    doAdmin.some((n) => n.titulo === "Campanha esperando aprovação" && n.url === "/marketing") &&
    pushes.every(
      (x) =>
        /^vapid t=.+, k=.+/.test(x.headers.authorization) &&
        x.headers["content-encoding"] === "aes128gcm",
    ),
  { notificacoes: r.corpo?.notificacoes, doAdmin, urls: pushes.map((x) => x.url) },
);
check(
  "push: técnico não recebe conversa nem campanha",
  !pushes.some((x) => x.url === "/push/tec"),
  pushes.map((x) => x.url),
);
check(
  "push: celular que cancelou sai da lista",
  sql(`SELECT count(*) FROM push_inscricoes WHERE endpoint LIKE '%/push/velho'`) === "0",
);
const antes13b = (await logFake()).length;
r = await rota("mkt-disparo");
check(
  "push: a mesma notificação não se repete",
  (await logFake()).slice(antes13b).filter((x) => x.url.startsWith("/push/")).length === 0,
  r.corpo?.notificacoes,
);
// Avisos pelo WhatsApp desligados: nada de modelo de aviso.
sql(`UPDATE mkt_configuracoes SET aviso_whatsapp_ligado = false WHERE empresa_id = '${EMP}'`);
sql(
  `INSERT INTO mkt_avisos (empresa_id, tipo, titulo, mensagem) VALUES ('${EMP}', 'teste', 'Teste', 'não vai')`,
);
const antes13c = (await logFake()).length;
await rota("mkt-disparo");
check(
  "avisos pelo WhatsApp desligados: nenhuma mensagem sai",
  (await logFake()).slice(antes13c).filter((x) => x.body?.template_params?.name === "nexa_aviso")
    .length === 0,
);

if (falhas) {
  console.error(`\n${falhas} verificação(ões) falharam`);
  process.exit(1);
}
console.log("\nMarketing: tudo certo");
