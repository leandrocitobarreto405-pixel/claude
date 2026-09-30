-- Marketing pelo WhatsApp: importação, grupos, campanha (preparo, aprovação, janela, travas,
-- pausa), respostas e botões, falhas, orçamento e venda, indicação, gatilhos e isolamento.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

CREATE FUNCTION pg_temp.ct(_fone text) RETURNS public.mkt_contatos LANGUAGE sql AS $$
  SELECT * FROM public.mkt_contatos
   WHERE private.telefone_chave(normalized_phone) = private.telefone_chave(private.normalizar_telefone(_fone));
$$;

-- Mensagem do WhatsApp pelo webhook do Chatwoot.
CREATE FUNCTION pg_temp.msg(_id int, _conversa int, _fone text, _texto text, _tipo text DEFAULT 'incoming',
  _situacao text DEFAULT 'pending', _extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-mkt', 'm' || _id || coalesce(_extra->>'event', ''), jsonb_build_object(
    'event', coalesce(_extra->>'event', 'message_created'), 'id', _id, 'message_type', _tipo, 'content', _texto,
    'private', false, 'created_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'status', _extra->>'status', 'content_attributes', coalesce(_extra->'content_attributes', '{}'),
    'account', jsonb_build_object('id', 187966), 'inbox', jsonb_build_object('id', 12),
    'sender', CASE WHEN _tipo = 'incoming' THEN jsonb_build_object('id', 700 + _conversa, 'type', 'contact')
                   ELSE jsonb_build_object('id', 1, 'type', 'agent_bot') END,
    'conversation', jsonb_build_object('id', _conversa, 'inbox_id', 12, 'status', _situacao,
      'channel', 'Channel::Whatsapp',
      'meta', jsonb_build_object('sender', jsonb_build_object('id', 700 + _conversa,
        'name', 'Cliente ' || _conversa, 'phone_number', '+' || private.normalizar_telefone(_fone))))));
$$;

INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('88888888-8888-8888-8888-888888888888', 'Nexa', 187966, 'token-mkt');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('88888888-8888-8888-8888-888888888888', 12, '11111111-1111-1111-1111-111111111111');
INSERT INTO public.ia_configuracoes (empresa_id, ativo, espera_segundos)
VALUES ('11111111-1111-1111-1111-111111111111', true, 8);
INSERT INTO public.mkt_configuracoes (empresa_id, lote_tamanho, amostra_minima)
VALUES ('11111111-1111-1111-1111-111111111111', 2, 2);

-- 0. Primeiro nome confiável.
SELECT pg_temp.ok(private.mkt_primeiro_nome('  ana maria souza ') = 'Ana', 'primeiro nome');
SELECT pg_temp.ok(private.mkt_primeiro_nome('JOÃO') = 'João', 'acento e maiúscula');
SELECT pg_temp.ok(private.mkt_primeiro_nome('Cliente 123') IS NULL, 'nome genérico → sem nome');
SELECT pg_temp.ok(private.mkt_primeiro_nome('A') IS NULL, 'uma letra → sem nome');
SELECT pg_temp.ok(private.mkt_primeiro_nome('+55 11 9999') IS NULL, 'número → sem nome');

-- 1. Importação: dedup por telefone (com e sem o 9º dígito), comprador vence, inválido contado.
CREATE TEMP TABLE imp AS SELECT public.mkt_importar_contatos('11111111-1111-1111-1111-111111111111', '[
  {"telefone": "(11) 91000-0001", "nome": "Ana Higi", "tipo": "comprador", "servico_em": "2026-04-20", "servico_tipo": "Higienização"},
  {"telefone": "11910000002", "nome": "Bia Imper", "tipo": "comprador", "servico_em": "2025-09-20", "servico_tipo": "impermeabilização"},
  {"telefone": "11910000003", "nome": "Caio", "tipo": "comprador", "servico_em": "2026-01-10", "servico_tipo": "higienizacao"},
  {"telefone": "11910000004", "nome": "Dani", "tipo": "comprador", "servico_em": "2025-05-01"},
  {"telefone": "11910000005", "nome": "Edu", "tipo": "comprador"},
  {"telefone": "11910000006", "nome": "Fábio", "tipo": "nao_comprador", "entrada_em": "2026-09-01", "interesse": "Higienização"},
  {"telefone": "11910000007", "nome": "Gabi", "tipo": "nao_comprador", "entrada_em": "2026-03-01"},
  {"telefone": "11910000008", "nome": "Hugo", "tipo": "nao_comprador", "entrada_em": "2025-01-01"},
  {"telefone": "11910000009", "nome": "Iara", "tipo": "nao_comprador", "entrada_em": "2025-12-01"},
  {"telefone": "1191000-0011", "nome": "Cliente", "tipo": "nao_comprador", "entrada_em": "2026-08-01"},
  {"telefone": "11 1000-0011", "nome": "Kátia", "tipo": "comprador", "servico_em": "2026-02-01"},
  {"telefone": "123", "nome": "Ruim", "tipo": "comprador"}
]', 'planilha teste') AS r;
SELECT pg_temp.ok((SELECT (r->>'lidas')::int = 12 AND (r->>'invalidas')::int = 1 AND (r->>'novos')::int = 10
                     AND (r->>'atualizados')::int = 1 FROM imp), 'contagem da importação: ' || (SELECT r::text FROM imp));
SELECT pg_temp.ok((pg_temp.ct('11910000011')).tipo = 'comprador', 'mesmo telefone (sem o 9): comprador vence');
SELECT pg_temp.ok((pg_temp.ct('11910000011')).nome = 'Cliente' AND (pg_temp.ct('11910000011')).primeiro_nome IS NULL,
  'nome genérico mantido, sem primeiro nome');
SELECT pg_temp.ok((pg_temp.ct('11910000001')).ultimo_servico_tipo = 'higienizacao'
               AND (pg_temp.ct('11910000002')).ultimo_servico_tipo = 'impermeabilizacao'
               AND (pg_temp.ct('11910000004')).ultimo_servico_tipo = 'desconhecido', 'tipo do serviço');
-- Reimportar não duplica.
SELECT public.mkt_importar_contatos('11111111-1111-1111-1111-111111111111',
  '[{"telefone": "5511910000001", "nome": "Outro Nome", "tipo": "nao_comprador"}]', 'de novo');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_contatos) = 10, 'sem duplicar');
SELECT pg_temp.ok((pg_temp.ct('11910000001')).tipo = 'comprador' AND (pg_temp.ct('11910000001')).nome = 'Ana Higi',
  'comprador não vira não comprador; nome não é trocado');

-- 2. Lead novo entra como não comprador; cliente do Nexa com OS concluída e paga vira comprador.
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, service_interest)
VALUES ('a3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Otávio', '11910000015',
        '5511910000015', 'Impermeabilização');
SELECT pg_temp.ok((pg_temp.ct('11910000015')).tipo = 'nao_comprador'
               AND (pg_temp.ct('11910000015')).crm_lead_id = 'a3000000-0000-0000-0000-000000000001', 'lead → base');
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Otávio Lima', '(11) 91000-0015');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date)
VALUES ('e3000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '9301',
        'c3000000-0000-0000-0000-000000000001', 649.90, '2026-10-05');
INSERT INTO public.visits (empresa_id, work_order_id, scheduled_date, scheduled_time, status, service_type_id,
  completion_date, completion_time)
VALUES ('11111111-1111-1111-1111-111111111111', 'e3000000-0000-0000-0000-000000000001', '2026-10-08', '09:00',
        'Concluído', (SELECT id FROM public.config_options WHERE kind = 'service_type' AND name = 'Impermeabilização'
                        AND empresa_id = '11111111-1111-1111-1111-111111111111'), '2026-10-08', '11:00');
SELECT pg_temp.ok((pg_temp.ct('11910000015')).tipo = 'nao_comprador', 'concluída sem pagamento: ainda não comprador');
INSERT INTO public.payments (empresa_id, work_order_id, payment_channel, payment_date, gross_amount, net_amount,
  payment_status, is_active)
VALUES ('11111111-1111-1111-1111-111111111111', 'e3000000-0000-0000-0000-000000000001', 'Pix', '2026-10-08',
        649.90, 649.90, 'Pago', true);
SELECT pg_temp.ok((pg_temp.ct('11910000015')).tipo = 'comprador'
               AND (pg_temp.ct('11910000015')).ultimo_servico_tipo = 'impermeabilizacao'
               AND (pg_temp.ct('11910000015')).pos_venda_em = '2026-10-08 12:00-03'
               AND (pg_temp.ct('11910000015')).ultima_work_order_id = 'e3000000-0000-0000-0000-000000000001'
               AND (pg_temp.ct('11910000015')).customer_id = 'c3000000-0000-0000-0000-000000000001',
  'OS concluída e paga → comprador: ' || row_to_json(pg_temp.ct('11910000015'))::text);

-- 3. Grupos (referência 10/10/2026).
-- Exclusões: opt-out, sem pós-venda, em negociação.
SELECT public.mkt_importar_contatos('11111111-1111-1111-1111-111111111111', '[
  {"telefone": "11910000020", "nome": "Opt", "tipo": "comprador", "servico_em": "2026-01-10"},
  {"telefone": "11910000021", "nome": "Semp", "tipo": "comprador", "servico_em": "2026-01-10"},
  {"telefone": "11910000022", "nome": "Nego", "tipo": "nao_comprador", "entrada_em": "2026-09-01"}
]', 'exclusões');
UPDATE public.mkt_contatos SET optout_em = now() WHERE normalized_phone = '5511910000020';
UPDATE public.mkt_contatos SET sem_pos_venda = true WHERE normalized_phone = '5511910000021';
INSERT INTO public.crm_leads (empresa_id, lead_name, phone, normalized_phone, status_id, is_open)
VALUES ('11111111-1111-1111-1111-111111111111', 'Nego', '11910000022', '5511910000022',
        (SELECT id FROM public.config_options WHERE kind = 'crm_status' AND name = 'Em negociação'
           AND empresa_id = '11111111-1111-1111-1111-111111111111'), true);
CREATE TEMP TABLE grp AS SELECT public.mkt_calcular_grupos('11111111-1111-1111-1111-111111111111', '2026-10-10') AS r;
SELECT pg_temp.ok(
  (pg_temp.ct('11910000001')).grupo_atual = 'C2' AND (pg_temp.ct('11910000002')).grupo_atual = 'C3'
  AND (pg_temp.ct('11910000003')).grupo_atual = 'C4' AND (pg_temp.ct('11910000004')).grupo_atual = 'C5'
  AND (pg_temp.ct('11910000005')).grupo_atual = 'C5' AND (pg_temp.ct('11910000006')).grupo_atual = 'N1'
  AND (pg_temp.ct('11910000007')).grupo_atual = 'N2' AND (pg_temp.ct('11910000008')).grupo_atual = 'N3'
  AND (pg_temp.ct('11910000009')).grupo_atual IS NULL AND (pg_temp.ct('11910000011')).grupo_atual = 'C4'
  AND (pg_temp.ct('11910000015')).grupo_atual = 'C1',
  'grupos: ' || (SELECT string_agg(right(normalized_phone, 2) || '=' || coalesce(grupo_atual, '-'), ' ' ORDER BY normalized_phone)
                   FROM public.mkt_contatos));
SELECT pg_temp.ok((pg_temp.ct('11910000020')).grupo_atual IS NULL AND (pg_temp.ct('11910000021')).grupo_atual IS NULL
               AND (pg_temp.ct('11910000022')).grupo_atual IS NULL, 'opt-out, sem pós-venda e negociação ficam fora');
SELECT pg_temp.ok((SELECT motivo_fora FROM public.mkt_grupos_historico h JOIN public.mkt_contatos c ON c.id = h.contato_id
                    WHERE c.normalized_phone = '5511910000022' AND h.mes_ref = '2026-10-01') = 'em negociação',
  'histórico guarda o motivo');
SELECT pg_temp.ok((SELECT (r->'grupos'->>'C4')::int FROM grp) = 2, 'contagem por grupo: ' || (SELECT r::text FROM grp));

-- 4. Campanha: preparo (compradores primeiro, lotes de 2, variante sem nome, datas terça a quinta).
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, tema, grupos, datas_disparo, templates)
VALUES ('d4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Primavera', 'calendario',
        '2026-10-01', 'Primavera: ácaros e alergia', '{C4,N1}', '{2026-10-20,2026-10-21,2026-10-22}',
        '{"C4": "tc_oferta_trimestral", "N1": "tc_orcamento_retomada"}');
CREATE TEMP TABLE prep AS SELECT public.mkt_preparar_campanha('d4000000-0000-0000-0000-000000000001', '2026-10-10') AS r;
SELECT pg_temp.ok((SELECT (r->>'total')::int = 3 AND (r->>'lotes')::int = 2 AND (r->>'sem_nome')::int = 1
                     AND (r->>'custo')::numeric = 0.96 FROM prep), 'estimativa: ' || (SELECT r::text FROM prep));
SELECT pg_temp.ok((SELECT string_agg(l.numero || ':' || l.data_prevista || ':' || e.grupo || ':' || e.template_nome,
                                     ' ' ORDER BY l.numero, e.ordem)
                     FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id
                    WHERE e.campanha_id = 'd4000000-0000-0000-0000-000000000001')
  = '1:2026-10-20:C4:tc_oferta_trimestral_sn 1:2026-10-20:C4:tc_oferta_trimestral 2:2026-10-21:N1:tc_orcamento_retomada',
  'lotes: ' || (SELECT string_agg(l.numero || ':' || l.data_prevista || ':' || e.grupo || ':' || e.template_nome, ' ' ORDER BY l.numero, e.ordem)
                  FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id));
SELECT pg_temp.ok((SELECT status FROM public.mkt_campanhas WHERE id = 'd4000000-0000-0000-0000-000000000001')
  = 'aguardando_aprovacao', 'aguardando aprovação');
SELECT pg_temp.ok((SELECT etiqueta_chatwoot FROM public.mkt_lotes WHERE numero = 1
                    AND campanha_id = 'd4000000-0000-0000-0000-000000000001') = 'camp-2026-10-l1', 'etiqueta do lote');
-- Limite por grupo e datas extras (lote de 1: 3 lotes nas 3 datas; com 4 contatos, a 4ª é a próxima terça).
UPDATE public.mkt_configuracoes SET lote_tamanho = 1;
SELECT public.mkt_importar_contatos('11111111-1111-1111-1111-111111111111',
  '[{"telefone": "11910000031", "nome": "Nina", "tipo": "nao_comprador", "entrada_em": "2026-09-15"}]', 'x');
SELECT public.mkt_preparar_campanha('d4000000-0000-0000-0000-000000000001', '2026-10-10');
SELECT pg_temp.ok((SELECT array_agg(data_prevista ORDER BY numero)::text FROM public.mkt_lotes
                    WHERE campanha_id = 'd4000000-0000-0000-0000-000000000001')
  = '{2026-10-20,2026-10-21,2026-10-22,2026-10-27}', 'datas extras: próxima terça');
UPDATE public.mkt_campanhas SET limites = '{"N1": 1}' WHERE id = 'd4000000-0000-0000-0000-000000000001';
UPDATE public.mkt_configuracoes SET lote_tamanho = 2;
SELECT public.mkt_preparar_campanha('d4000000-0000-0000-0000-000000000001', '2026-10-10');
SELECT pg_temp.ok((SELECT string_agg(c.nome, ',') FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
                    WHERE e.campanha_id = 'd4000000-0000-0000-0000-000000000001' AND e.grupo = 'N1') = 'Nina',
  'limite por grupo (a entrada mais recente primeiro)');

-- 5. Aprovação: só até a véspera; agenda às 10h, espaçado.
DO $$ BEGIN
  PERFORM public.mkt_aprovar_campanha('d4000000-0000-0000-0000-000000000001', NULL, '2026-10-20');
  RAISE EXCEPTION 'FALHOU: aprovou no dia do disparo';
EXCEPTION WHEN OTHERS THEN IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF; END $$;
SELECT public.mkt_aprovar_campanha('d4000000-0000-0000-0000-000000000001', NULL, '2026-10-19');
SELECT pg_temp.ok((SELECT array_agg(agendado_para ORDER BY agendado_para)::text FROM public.mkt_envios
                    WHERE campanha_id = 'd4000000-0000-0000-0000-000000000001')
  = (SELECT ARRAY[timestamptz '2026-10-20 10:00-03', timestamptz '2026-10-20 10:00:08-03', timestamptz '2026-10-21 10:00-03']::text),
  'agendado: ' || (SELECT array_agg(agendado_para ORDER BY agendado_para)::text FROM public.mkt_envios));

-- 6. Janela e flag: nada sai com a flag desligada, fora de terça a quinta, antes das 10h ou à noite.
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-20 10:05-03')) = 0, 'flag desligada');
UPDATE public.mkt_configuracoes SET disparo_ligado = true;
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-20 09:59-03')) = 0, 'antes das 10h');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-24 10:30-03')) = 0, 'sábado');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-21 21:30-03')) = 0, 'à noite');
CREATE TEMP TABLE res AS SELECT * FROM public.mkt_reservar_envios(10, '2026-10-20 10:05-03');
SELECT pg_temp.ok((SELECT count(*) FROM res) = 2 AND (SELECT count(*) FROM res WHERE variante_sn) = 1
               AND (SELECT primeiro_nome FROM res WHERE NOT variante_sn) = 'Caio',
  'terça 10h05: lote 1 inteiro (' || (SELECT count(*) FROM res) || ')');
SELECT pg_temp.ok((SELECT status FROM public.mkt_campanhas WHERE id = 'd4000000-0000-0000-0000-000000000001') = 'enviando'
               AND (SELECT status FROM public.mkt_lotes WHERE campanha_id = 'd4000000-0000-0000-0000-000000000001' AND numero = 1)
                   = 'enviando', 'campanha e lote enviando');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-20 10:06-03')) = 0, 'reservado não repete');
SELECT pg_temp.ok(public.mkt_confirmar_envio((SELECT envio_id FROM res WHERE NOT variante_sn), '2026-10-20 10:05:30-03'),
  'conferência antes de enviar: pode sair');

-- 7. Resultado e trava: 1 erro em 2 (50% > 5%) com amostra mínima 2 pausa o lote e a campanha.
SELECT public.mkt_registrar_envio((SELECT envio_id FROM res WHERE NOT variante_sn), true, NULL, 501, 9001);
SELECT pg_temp.ok((SELECT status FROM public.mkt_lotes WHERE campanha_id = 'd4000000-0000-0000-0000-000000000001' AND numero = 1)
  = 'enviando', 'um envio certo: segue');
SELECT public.mkt_registrar_envio((SELECT envio_id FROM res WHERE variante_sn), false, '(#131026) Message undeliverable', NULL, NULL);
SELECT pg_temp.ok((SELECT status FROM public.mkt_lotes WHERE campanha_id = 'd4000000-0000-0000-0000-000000000001' AND numero = 1)
  = 'pausado' AND (SELECT status FROM public.mkt_campanhas WHERE id = 'd4000000-0000-0000-0000-000000000001') = 'pausada',
  'erro acima de 5%: pausa automática');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_avisos WHERE tipo = 'pausa_automatica') = 1, 'aviso da pausa');
SELECT pg_temp.ok((SELECT bloqueio FROM public.mkt_envios WHERE id = (SELECT envio_id FROM res WHERE variante_sn)),
  '131026 conta como bloqueio');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-21 10:05-03')) = 0, 'pausada não envia');
SELECT public.mkt_retomar('d4000000-0000-0000-0000-000000000001', NULL);
SELECT pg_temp.ok((SELECT status FROM public.mkt_campanhas WHERE id = 'd4000000-0000-0000-0000-000000000001') = 'enviando',
  'retomada');
SELECT pg_temp.ok((SELECT status FROM public.mkt_lotes WHERE campanha_id = 'd4000000-0000-0000-0000-000000000001' AND numero = 1)
  = 'concluido', 'retomado sem nada para sair: lote concluído');

-- 8. Resposta ao disparo: lead com origem "WhatsApp campanha" e campanha do CRM; resposta de
-- cliente antigo vai para a Alice (não para a equipe).
UPDATE public.mkt_envios SET enviado_em = now() - interval '1 hour' WHERE chatwoot_message_id = 9001;
SELECT pg_temp.msg(9001, 501, '11910000003', 'Oferta trimestral', 'outgoing');
SELECT pg_temp.msg(9002, 501, '11910000003', 'Quero ver as datas');
SELECT pg_temp.ok((SELECT respondido_em IS NOT NULL AND botao_clicado = 'quero ver as datas' AND crm_lead_id IS NOT NULL
                     FROM public.mkt_envios WHERE chatwoot_message_id = 9001), 'resposta ligada ao envio');
SELECT pg_temp.ok((SELECT o.name FROM public.crm_leads l JOIN public.config_options o ON o.id = l.sales_origin_id
                    WHERE l.id = (SELECT crm_lead_id FROM public.mkt_envios WHERE chatwoot_message_id = 9001))
  = 'WhatsApp campanha', 'origem WhatsApp campanha');
SELECT pg_temp.ok((SELECT l.campaign_id = k.crm_campaign_id FROM public.crm_leads l, public.mkt_campanhas k
                    WHERE l.id = (SELECT crm_lead_id FROM public.mkt_envios WHERE chatwoot_message_id = 9001)
                      AND k.id = 'd4000000-0000-0000-0000-000000000001'), 'campanha do CRM no lead');
INSERT INTO public.customers (empresa_id, full_name, phone)
VALUES ('11111111-1111-1111-1111-111111111111', 'Caio', '11910000003');
UPDATE public.whatsapp_contacts SET is_existing_customer = true WHERE normalized_phone = '5511910000003';
SELECT pg_temp.msg(9003, 501, '11910000003', 'Pode ser sábado?');
SELECT pg_temp.ok((SELECT string_agg(t.tipo || ':' || t.situacao, ',' ORDER BY t.created_at) FROM public.ia_tarefas t
                    JOIN public.conversas c ON c.id = t.conversa_id WHERE c.chatwoot_conversation_id = 501)
  LIKE '%responder:pendente%', 'cliente antigo respondendo campanha: a Alice atende');

-- 9. Orçamento e venda ligados ao envio; indicação vira crédito quando o indicado compra.
INSERT INTO public.quotes (empresa_id, cliente_nome, cliente_telefone, crm_lead_id, subtotal, total)
VALUES ('11111111-1111-1111-1111-111111111111', 'Caio', '11910000003',
        (SELECT crm_lead_id FROM public.mkt_envios WHERE chatwoot_message_id = 9001), 360, 360);
SELECT pg_temp.ok((SELECT quote_id IS NOT NULL FROM public.mkt_envios WHERE chatwoot_message_id = 9001), 'orçamento ligado');
INSERT INTO public.indicacoes (empresa_id, indicador_contato_id, indicado_nome, indicado_phone)
VALUES ('11111111-1111-1111-1111-111111111111', (pg_temp.ct('11910000003')).id, 'Paula', '11910000040');
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Caio S', '11910000003'),
  ('c3000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Paula', '11 1000-0040');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date) VALUES
  ('e3000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '9302',
   'c3000000-0000-0000-0000-000000000002', 359.90, current_date),
  ('e3000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '9303',
   'c3000000-0000-0000-0000-000000000003', 300, current_date);
INSERT INTO public.payments (empresa_id, work_order_id, payment_channel, payment_date, gross_amount, net_amount,
  payment_status, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'e3000000-0000-0000-0000-000000000002', 'Pix', current_date, 359.90, 359.90, 'Pago', true),
  ('11111111-1111-1111-1111-111111111111', 'e3000000-0000-0000-0000-000000000003', 'Pix', current_date, 300, 300, 'Pago', true);
SELECT pg_temp.ok((SELECT work_order_id = 'e3000000-0000-0000-0000-000000000002' AND valor_venda = 359.90
                     FROM public.mkt_envios WHERE chatwoot_message_id = 9001), 'venda ligada ao envio');
SELECT pg_temp.ok((SELECT indicado_usou_em IS NOT NULL FROM public.indicacoes WHERE indicado_phone = '5511910000040')
               AND (pg_temp.ct('11910000003')).credito_indicacao_pct = 15, 'indicado comprou: crédito de 15%');

-- 10. Botões: opt-out (cancela pendentes, tarefa de etiqueta), recusou, problema (prioridade).
SELECT pg_temp.msg(9004, 501, '11910000003', 'Não quero mais ofertas');
SELECT pg_temp.ok((pg_temp.ct('11910000003')).optout_em IS NOT NULL, 'opt-out gravado');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_tarefas WHERE tipo = 'etiqueta_optout') = 1, 'tarefa da etiqueta optout');
-- Pós-venda com problema.
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, gatilho, template_nome, status)
VALUES ('d4000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Pós-venda', 'gatilho',
        '2026-10-01', 'C1', 'tc_posvenda_resultado', 'enviando');
INSERT INTO public.mkt_envios (empresa_id, campanha_id, contato_id, normalized_phone, grupo, template_nome, status, enviado_em)
VALUES ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000002', (pg_temp.ct('11910000015')).id,
        '5511910000015', 'C1', 'tc_posvenda_resultado', 'enviado', now() - interval '2 hours');
SELECT pg_temp.msg(9101, 502, '11910000015', 'Tive um problema');
SELECT pg_temp.ok((pg_temp.ct('11910000015')).sem_pos_venda
               AND (SELECT sem_pos_venda FROM public.whatsapp_contacts WHERE normalized_phone = '5511910000015'),
  'problema: sem pós-venda');
SELECT pg_temp.ok((SELECT string_agg(t.tipo || ':' || t.situacao, ',' ORDER BY t.tipo, t.situacao) FROM public.ia_tarefas t
                    JOIN public.conversas c ON c.id = t.conversa_id WHERE c.chatwoot_conversation_id = 502)
  = 'passar_para_humano:pendente,responder:ignorada', 'problema: Alice sai, vai para a equipe');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_tarefas WHERE tipo = 'prioridade_urgente') = 1
               AND (SELECT count(*) FROM public.mkt_avisos WHERE tipo = 'problema_pos_venda') = 1, 'prioridade e aviso');

-- 11. Falha de entrega informada depois (message_updated failed): erro; 131050 = opt-out.
UPDATE public.mkt_envios SET status = 'enviado', enviado_em = now(), chatwoot_message_id = 9201, erro = NULL,
       bloqueio = false WHERE id = (SELECT envio_id FROM res WHERE variante_sn);
SELECT pg_temp.msg(9201, 503, '11910000011', 'Mensagem', 'outgoing', 'pending',
  '{"event": "message_updated", "status": "failed", "content_attributes": {"external_error": "(#131050) User stopped marketing"}}');
SELECT pg_temp.ok((SELECT status = 'erro' AND bloqueio FROM public.mkt_envios WHERE chatwoot_message_id = 9201),
  'falha de entrega registrada');
SELECT pg_temp.ok((pg_temp.ct('11910000011')).optout_em IS NOT NULL, '131050 vira opt-out');

-- 12. Gatilhos: C1 no dia seguinte (manual com a flag desligada; na fila com a flag ligada); C3 e lembrete.
UPDATE public.mkt_contatos SET sem_pos_venda = false, optout_em = NULL WHERE normalized_phone = '5511910000015';
DELETE FROM public.mkt_envios WHERE campanha_id = 'd4000000-0000-0000-0000-000000000002';
CREATE TEMP TABLE g1 AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-10-09') AS r;
SELECT pg_temp.ok((SELECT (r->'C1'->>'novos')::int = 1 AND (r->'C1'->>'automatico')::boolean = false FROM g1),
  'C1 no dia seguinte: ' || (SELECT r::text FROM g1));
SELECT pg_temp.ok((SELECT status || ':' || template_nome FROM public.mkt_envios WHERE gatilho_ref LIKE 'C1:%')
  = 'manual:tc_posvenda_resultado', 'flag desligada: fica para envio manual');
SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-10-09');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_envios WHERE gatilho_ref LIKE 'C1:%') = 1, 'gatilho não repete');
-- C3: Bia (imper em 20/09/2025) está na janela (05/10 a 20/10/2026): em 09/10, com a flag desligada, ficou manual.
SELECT pg_temp.ok((SELECT status || ':' || template_nome FROM public.mkt_envios WHERE gatilho_ref LIKE 'C3:%')
  = 'manual:tc_imper_13meses', 'C3 com a flag desligada fica manual');
DELETE FROM public.mkt_envios WHERE gatilho_ref LIKE 'C3:%';
UPDATE public.mkt_configuracoes SET gatilho_c3_ligado = true;
CREATE TEMP TABLE g3 AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-10-06') AS r;
SELECT pg_temp.ok((SELECT (r->'C3'->>'novos')::int FROM g3) = 1
               AND (SELECT status FROM public.mkt_envios WHERE gatilho_ref LIKE 'C3:%') = 'pendente',
  'C3 com a flag ligada vai para a fila: ' || (SELECT r::text FROM g3));
UPDATE public.mkt_envios SET status = 'enviado', enviado_em = now() - interval '25 hours' WHERE gatilho_ref LIKE 'C3:%';
CREATE TEMP TABLE g3l AS SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-10-07') AS r;
SELECT pg_temp.ok((SELECT (r->'C3L'->>'novos')::int FROM g3l) = 1
               AND (SELECT template_nome FROM public.mkt_envios WHERE gatilho_ref LIKE 'C3L:%') = 'tc_imper_13meses_lembrete',
  'lembrete do C3 depois de 24 h sem resposta');
SELECT public.mkt_gerar_gatilhos('11111111-1111-1111-1111-111111111111', '2026-10-08');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_envios WHERE gatilho_ref LIKE 'C3L:%') = 1, 'lembrete uma vez só');

-- 13. Relatório por campanha.
SELECT pg_temp.ok((SELECT enviados = 1 AND respostas = 1 AND orcamentos = 1 AND vendas = 1 AND valor_vendido = 359.90
                     AND optouts = 2 AND bloqueios = 1 AND erros = 1 FROM public.vw_mkt_campanhas_relatorio
                    WHERE campanha_id = 'd4000000-0000-0000-0000-000000000001'),
  'relatório: ' || (SELECT row_to_json(r)::text FROM public.vw_mkt_campanhas_relatorio r
                     WHERE campanha_id = 'd4000000-0000-0000-0000-000000000001'));

-- 13b. Travas que os passos acima não isolam (depois do relatório, para não mexer nos números).
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, templates, datas_disparo, status)
VALUES ('d4000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Travas', 'calendario',
        '2026-10-01', '{C5}', '{"C5": "tc_reativacao_cliente"}', '{2026-10-20}', 'aprovada');
INSERT INTO public.mkt_lotes (id, empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, status) VALUES
  ('f4000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003',
   1, 'camp-t-l1', '2026-10-19', 'aprovado'),
  ('f4000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003',
   2, 'camp-t-l2', '2026-10-19', 'aprovado'),
  ('f4000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003',
   3, 'camp-t-l3', '2026-10-19', 'aprovado');
INSERT INTO public.mkt_envios (id, empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome,
  status, agendado_para) VALUES
  ('f5000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003',
   'f4000000-0000-0000-0000-000000000001', (pg_temp.ct('11910000004')).id, '5511910000004', 'C5', 'tc_reativacao_cliente',
   'pendente', '2026-10-19 10:00-03');
-- Segunda-feira e depois da hora limite (19h) não saem; quem saiu depois do preparo é cancelado.
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-19 10:30-03')
                    WHERE envio_id = 'f5000000-0000-0000-0000-000000000001') = 0, 'segunda-feira');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-21 19:30-03')
                    WHERE envio_id = 'f5000000-0000-0000-0000-000000000001') = 0, 'depois das 19h');
UPDATE public.mkt_contatos SET optout_em = now() WHERE normalized_phone = '5511910000004';
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-21 10:30-03')
                    WHERE envio_id = 'f5000000-0000-0000-0000-000000000001') = 0, 'opt-out depois do preparo: não sai');
SELECT pg_temp.ok((SELECT status || ':' || erro FROM public.mkt_envios WHERE id = 'f5000000-0000-0000-0000-000000000001')
                   = 'cancelado:opt-out', 'opt-out depois do preparo: cancelado');
UPDATE public.mkt_contatos SET optout_em = NULL WHERE normalized_phone = '5511910000004';
-- Gatilho com a flag desligada não sai, nem se estiver na fila.
UPDATE public.mkt_configuracoes SET gatilho_c1_ligado = false;
INSERT INTO public.mkt_lotes (id, empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, status)
VALUES ('f4000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000002',
        90, 'gat-c1', '2026-10-20', 'aprovado');
INSERT INTO public.mkt_envios (id, empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome,
  status, agendado_para)
VALUES ('f5000000-0000-0000-0000-000000000009', '11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000002',
        'f4000000-0000-0000-0000-000000000009', (pg_temp.ct('11910000005')).id, '5511910000005', 'C1',
        'tc_posvenda_resultado', 'pendente', '2026-10-20 09:00-03');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-20 10:30-03')
                    WHERE envio_id = 'f5000000-0000-0000-0000-000000000009') = 0, 'gatilho C1 desligado não sai');
-- Pausa por erro (sem bloqueio) e pausa por opt-out (sem erro), cada uma sozinha.
INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome,
  status, enviado_em, erro) VALUES
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000002',
   (pg_temp.ct('11910000006')).id, '5511910000006', 'C5', 'tc_reativacao_cliente', 'enviado', now() - interval '1 hour', NULL),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000002',
   (pg_temp.ct('11910000007')).id, '5511910000007', 'C5', 'tc_reativacao_cliente', 'erro', NULL, 'timeout'),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000003',
   (pg_temp.ct('11910000008')).id, '5511910000008', 'C5', 'tc_reativacao_cliente', 'enviado', now() - interval '1 hour', NULL),
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000003',
   (pg_temp.ct('11910000031')).id, '5511910000031', 'C5', 'tc_reativacao_cliente', 'enviado', now() - interval '1 hour', NULL);
UPDATE public.mkt_contatos SET optout_em = now() WHERE normalized_phone = '5511910000031';
SELECT private.mkt_checar_lote('f4000000-0000-0000-0000-000000000002');
SELECT private.mkt_checar_lote('f4000000-0000-0000-0000-000000000003');
SELECT pg_temp.ok((SELECT motivo_pausa FROM public.mkt_lotes WHERE id = 'f4000000-0000-0000-0000-000000000002')
                   LIKE 'pausa automática: erros de envio%', 'pausa só por erro');
SELECT pg_temp.ok((SELECT motivo_pausa FROM public.mkt_lotes WHERE id = 'f4000000-0000-0000-0000-000000000003')
                   LIKE 'pausa automática: opt-out + bloqueio%', 'pausa só por opt-out');
-- Marketing nos últimos 30 dias tira do grupo; venda só conta até 30 dias depois do envio.
CREATE TEMP TABLE grp2 AS SELECT public.mkt_calcular_grupos('11111111-1111-1111-1111-111111111111', '2026-10-10') AS r;
SELECT pg_temp.ok((pg_temp.ct('11910000006')).grupo_atual IS NULL
               AND (SELECT motivo_fora FROM public.mkt_grupos_historico h JOIN public.mkt_contatos c ON c.id = h.contato_id
                     WHERE c.normalized_phone = '5511910000006' AND h.mes_ref = '2026-10-01') = 'marketing nos últimos 30 dias',
  'marketing recente fica fora');
UPDATE public.mkt_envios SET enviado_em = now() - interval '40 days'
 WHERE lote_id = 'f4000000-0000-0000-0000-000000000003' AND normalized_phone = '5511910000008';
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c3000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', 'Hugo', '11910000008');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date) VALUES
  ('e3000000-0000-0000-0000-000000000008', '11111111-1111-1111-1111-111111111111', '9308',
   'c3000000-0000-0000-0000-000000000008', 500, current_date);
INSERT INTO public.payments (empresa_id, work_order_id, payment_channel, payment_date, gross_amount, net_amount,
  payment_status, is_active) VALUES
  ('11111111-1111-1111-1111-111111111111', 'e3000000-0000-0000-0000-000000000008', 'Pix', current_date, 500, 500, 'Pago', true);
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_envios WHERE work_order_id = 'e3000000-0000-0000-0000-000000000008') = 0,
  'venda 40 dias depois do envio não conta');

-- Pausar no meio: o que já estava reservado volta para a fila na conferência antes do envio.
SELECT public.mkt_retomar('d4000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000001');
INSERT INTO public.mkt_envios (id, empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome,
  status, agendado_para) VALUES
  ('f5000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003',
   'f4000000-0000-0000-0000-000000000001', (pg_temp.ct('11910000004')).id, '5511910000004', 'C5', 'tc_reativacao_cliente',
   'pendente', '2026-10-20 10:00-03');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, '2026-10-21 10:30-03')
                    WHERE envio_id = 'f5000000-0000-0000-0000-000000000004') = 1, 'reservado');
SELECT public.mkt_pausar('d4000000-0000-0000-0000-000000000003', NULL, 'teste');
SELECT pg_temp.ok(NOT public.mkt_confirmar_envio('f5000000-0000-0000-0000-000000000004', '2026-10-21 10:30:08-03'),
  'pausado no meio: não sai');
SELECT pg_temp.ok((SELECT status FROM public.mkt_envios WHERE id = 'f5000000-0000-0000-0000-000000000004') = 'pendente',
  'volta para a fila');
SELECT public.mkt_retomar('d4000000-0000-0000-0000-000000000003', NULL);
UPDATE public.mkt_configuracoes SET disparo_ligado = false;
UPDATE public.mkt_envios SET status = 'enviando' WHERE id = 'f5000000-0000-0000-0000-000000000004';
UPDATE public.mkt_lotes SET status = 'enviando' WHERE id = 'f4000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok(NOT public.mkt_confirmar_envio('f5000000-0000-0000-0000-000000000004', '2026-10-21 10:31-03'),
  'flag desligada no meio: não sai');
UPDATE public.mkt_configuracoes SET disparo_ligado = true;

-- Botões cancelam o que estava na fila; resposta a envio de mais de 7 dias não conta.
INSERT INTO public.mkt_envios (id, empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome,
  status, agendado_para) VALUES
  ('f5000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003',
   'f4000000-0000-0000-0000-000000000001', (pg_temp.ct('11910000006')).id, '5511910000006', 'C5', 'tc_reativacao_cliente',
   'pendente', '2026-10-27 10:00-03');
SELECT pg_temp.msg(9401, 504, '11910000006', 'Não quero mais ofertas');
SELECT pg_temp.ok((SELECT status || ':' || erro FROM public.mkt_envios WHERE id = 'f5000000-0000-0000-0000-000000000006')
  = 'cancelado:opt-out', 'botão de opt-out cancela a fila');
INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome,
  status, enviado_em) VALUES
  ('11111111-1111-1111-1111-111111111111', 'd4000000-0000-0000-0000-000000000003', 'f4000000-0000-0000-0000-000000000003',
   (pg_temp.ct('11910000009')).id, '5511910000009', 'C5', 'tc_reativacao_cliente', 'enviado', now() - interval '1 hour');
SELECT pg_temp.msg(9402, 505, '11910000009', 'Agora não');
SELECT pg_temp.ok((pg_temp.ct('11910000009')).recusou_grupo = 'C5', '"Agora não" guarda o grupo recusado');
SELECT pg_temp.msg(9403, 506, '11910000008', 'Oi, quero orçamento');
SELECT pg_temp.ok((SELECT respondido_em IS NULL FROM public.mkt_envios
                    WHERE lote_id = 'f4000000-0000-0000-0000-000000000003' AND normalized_phone = '5511910000008'),
  'resposta 40 dias depois não é da campanha');
-- Quem saiu depois do cálculo dos grupos não entra no preparo (o preparo recalcula e ainda filtra).
UPDATE public.mkt_contatos SET optout_em = now() WHERE normalized_phone = '5511910000001';
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, templates, datas_disparo)
VALUES ('d4000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Sem opt-out', 'calendario',
        '2026-11-01', '{C2}', '{"C2": "tc_x"}', '{2026-11-17}');
SELECT public.mkt_preparar_campanha('d4000000-0000-0000-0000-000000000004', '2026-10-10');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_envios WHERE campanha_id = 'd4000000-0000-0000-0000-000000000004'
                      AND normalized_phone = '5511910000001') = 0, 'opt-out depois do cálculo fica fora do preparo');

-- O servidor (chave de serviço) grava indicação e contato direto (índices por telefone).
SET LOCAL ROLE service_role;
INSERT INTO public.indicacoes (empresa_id, indicador_contato_id, indicado_nome, indicado_phone)
VALUES ('11111111-1111-1111-1111-111111111111', (pg_temp.ct('11910000005')).id, 'Rui', '11 91000-0050');
UPDATE public.mkt_contatos SET indicado_por_contato_id = (pg_temp.ct('11910000005')).id
 WHERE normalized_phone = '5511910000007';
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) FROM public.indicacoes WHERE indicado_phone = '5511910000050') = 1,
  'servidor grava indicação');

-- 14. Condição da campanha até 25%.
DO $$ BEGIN
  UPDATE public.mkt_campanhas SET condicao_pct = 30 WHERE id = 'd4000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: aceitou condição de 30%%';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- 15. Isolamento: a empresa B não vê nada da Turbine nem chama as funções.
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000b8', 'b@mkt.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES ('00000000-0000-0000-0000-0000000000b8', '22222222-2222-2222-2222-222222222222', 'admin');
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b8","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_contatos) = 0 AND (SELECT count(*) FROM public.mkt_envios) = 0
               AND (SELECT count(*) FROM public.mkt_campanhas) = 0 AND (SELECT count(*) FROM public.vw_mkt_campanhas_relatorio) = 0,
  'B não vê a Turbine');
WITH u AS (UPDATE public.mkt_configuracoes SET disparo_ligado = true
            WHERE empresa_id = '11111111-1111-1111-1111-111111111111' RETURNING 1)
SELECT pg_temp.ok(count(*) = 0, 'B não liga o disparo da Turbine') FROM u;
RESET ROLE;
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-0000000000a8', 'at@mkt.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
VALUES ('00000000-0000-0000-0000-0000000000a8', '11111111-1111-1111-1111-111111111111', 'atendente');
UPDATE public.mkt_configuracoes SET disparo_ligado = false;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a8","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_configuracoes) = 1, 'atendente vê a configuração');
WITH u AS (UPDATE public.mkt_configuracoes SET disparo_ligado = true RETURNING 1)
SELECT pg_temp.ok(count(*) = 0, 'atendente não liga o disparo') FROM u;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b8","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM public.mkt_calcular_grupos('11111111-1111-1111-1111-111111111111', NULL);
  RAISE EXCEPTION 'FALHOU: usuário chamou o motor de grupos';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;

ROLLBACK;
