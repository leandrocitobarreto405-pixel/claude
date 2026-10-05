-- Campanhas criadas pelo app: lotes com as listas quentes primeiro e as frias por último, etiqueta
-- própria da campanha, ordem na estimativa e "quem responde" (Alice ou equipe), trocável a qualquer
-- momento.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.tarefas(_conversa int) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(t.tipo || ':' || t.situacao, ',' ORDER BY t.tipo, t.situacao), '')
    FROM public.ia_tarefas t JOIN public.conversas c ON c.id = t.conversa_id
   WHERE c.chatwoot_conversation_id = _conversa
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


INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('88888888-8888-8888-8888-888888888888', 'Nexa', 187966, 'token-mkt');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id) VALUES
  ('88888888-8888-8888-8888-888888888888', 12, '11111111-1111-1111-1111-111111111111');
INSERT INTO public.ia_configuracoes (empresa_id, ativo, espera_segundos)
VALUES ('11111111-1111-1111-1111-111111111111', true, 8);
INSERT INTO public.mkt_configuracoes (empresa_id, lote_tamanho)
VALUES ('11111111-1111-1111-1111-111111111111', 2);

-- Base: Ana cliente há 200 dias; Bia cliente há 400 dias; Eva orçamento há 20 dias; Caio orçamento
-- há 400 dias; Davi conversou há 10 dias.
INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, ultimo_servico_em,
  ultimo_servico_tipo, orcamento_em, lead_entrada_em) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Ana Lima', 'Ana', '5511940000001', 'comprador', now() - interval '200 days', 'desconhecido', NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Bia Reis', 'Bia', '5511940000002', 'comprador', now() - interval '400 days', 'desconhecido', NULL, NULL),
  ('11111111-1111-1111-1111-111111111111', 'Eva Dias', 'Eva', '5511940000003', 'nao_comprador', NULL, NULL, now() - interval '20 days', NULL),
  ('11111111-1111-1111-1111-111111111111', 'Caio Melo', 'Caio', '5511940000004', 'nao_comprador', NULL, NULL, now() - interval '400 days', NULL),
  ('11111111-1111-1111-1111-111111111111', 'Davi Paz', 'Davi', '5511940000005', 'nao_comprador', NULL, NULL, NULL, now() - interval '10 days');

-- 1. Campanha nova com as listas escolhidas fora de ordem (frias primeiro na tela).
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, quem_responde, listas, templates)
VALUES ('f9300000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Outubro geral',
        'calendario', date_trunc('month', current_date), 'equipe',
        '[{"grupo": "CV", "familia": "conversa"}, {"grupo": "N3", "familia": "orcamento", "de": 365},
          {"grupo": "C4", "familia": "clientes", "de": 90, "ate": 365}, {"grupo": "N1", "familia": "orcamento", "ate": 90},
          {"grupo": "C5", "familia": "clientes", "de": 365}]',
        '{"C4": "tc_oferta_trimestral", "C5": "tc_reativacao_cliente", "N1": "tc_orcamento_retomada",
          "N3": "tc_orcamento_retomada", "CV": "tc_conversa_retomada"}');
CREATE TEMP TABLE est AS SELECT public.mkt_preparar_campanha('f9300000-0000-0000-0000-000000000001') AS r;
CREATE FUNCTION pg_temp.lotes() RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(l.numero || ':' || c.primeiro_nome, ' ' ORDER BY l.numero, e.ordem)
    FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id JOIN public.mkt_contatos c ON c.id = e.contato_id
   WHERE e.campanha_id = 'f9300000-0000-0000-0000-000000000001'
$$;
SELECT pg_temp.ok(pg_temp.lotes() = '1:Ana 1:Bia 2:Eva 2:Caio 3:Davi', 'quentes primeiro, frias por último: ' || pg_temp.lotes());
SELECT pg_temp.ok((SELECT string_agg(o->>'grupo' || ':' || (o->>'primeiro_lote') || '-' || (o->>'ultimo_lote')
                                     || CASE WHEN (o->>'fria')::boolean THEN ':fria' ELSE '' END, ' ')
                     FROM est, jsonb_array_elements(r->'ordem') o)
                  = 'C4:1-1 C5:1-1 N1:2-2 N3:2-2:fria CV:3-3:fria',
  'ordem na estimativa: ' || (SELECT (r->'ordem')::text FROM est));
SELECT pg_temp.ok((SELECT bool_and(etiqueta_chatwoot = 'camp-' || to_char(date_trunc('month', current_date), 'YYYY-MM')
                                     || '-f93000-l' || numero)
                     FROM public.mkt_lotes WHERE campanha_id = 'f9300000-0000-0000-0000-000000000001'),
  'etiqueta própria da campanha');

-- 2. Quem responde = equipe: a resposta tira a Alice da conversa, com nota interna.
UPDATE public.mkt_campanhas SET status = 'enviando' WHERE id = 'f9300000-0000-0000-0000-000000000001';
UPDATE public.mkt_envios SET status = 'enviado', enviado_em = now() - interval '1 hour'
 WHERE campanha_id = 'f9300000-0000-0000-0000-000000000001';
SELECT pg_temp.msg(9501, 601, '11940000001', 'Quero aproveitar!');
SELECT pg_temp.ok(pg_temp.tarefas(601) = 'passar_para_humano:pendente,responder:ignorada',
  'equipe: Alice sai: ' || pg_temp.tarefas(601));
SELECT pg_temp.ok((SELECT t.dados->>'nota' LIKE '%Outubro geral%atendida pela equipe%' FROM public.ia_tarefas t
                    JOIN public.conversas c ON c.id = t.conversa_id
                   WHERE c.chatwoot_conversation_id = 601 AND t.tipo = 'passar_para_humano'), 'nota para a equipe');
-- Opt-out não vai para a equipe (só sai das ofertas).
SELECT pg_temp.msg(9502, 602, '11940000002', 'Não quero mais ofertas');
SELECT pg_temp.ok(pg_temp.tarefas(602) NOT LIKE '%passar_para_humano%', 'opt-out não vai para a equipe');

-- 3. Trocada para Alice com a campanha em andamento: a próxima resposta fica com a Alice.
UPDATE public.mkt_campanhas SET quem_responde = 'alice' WHERE id = 'f9300000-0000-0000-0000-000000000001';
SELECT pg_temp.msg(9503, 603, '11940000003', 'Me mostre as datas');
SELECT pg_temp.ok(pg_temp.tarefas(603) = 'responder:pendente', 'alice: Alice responde: ' || pg_temp.tarefas(603));

-- 4. Só 'alice' ou 'equipe'; as do calendário continuam com a Alice.
DO $$ BEGIN
  UPDATE public.mkt_campanhas SET quem_responde = 'outro' WHERE id = 'f9300000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'FALHOU: aceitou quem_responde inválido';
EXCEPTION WHEN check_violation THEN NULL; END $$;
INSERT INTO public.mkt_campanhas (empresa_id, nome, tipo, mes_ref)
VALUES ('11111111-1111-1111-1111-111111111111', 'Calendário', 'calendario', date_trunc('month', current_date));
SELECT pg_temp.ok((SELECT quem_responde FROM public.mkt_campanhas WHERE nome = 'Calendário') = 'alice', 'padrão Alice');
ROLLBACK;
