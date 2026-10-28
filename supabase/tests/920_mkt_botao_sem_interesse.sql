-- Botões do envio "não recebeu orçamento" (migração 20261228260000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.msg(_id int, _conversa int, _fone text, _texto text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.receber_evento_chatwoot('token-920', 'm920-' || _id, jsonb_build_object(
    'event', 'message_created', 'id', _id, 'message_type', 'incoming', 'content', _texto,
    'private', false, 'created_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'account', jsonb_build_object('id', 920920), 'inbox', jsonb_build_object('id', 920),
    'sender', jsonb_build_object('id', 9200 + _conversa, 'type', 'contact'),
    'conversation', jsonb_build_object('id', _conversa, 'inbox_id', 920, 'status', 'pending',
      'channel', 'Channel::Whatsapp',
      'meta', jsonb_build_object('sender', jsonb_build_object('id', 9200 + _conversa,
        'name', 'Cliente ' || _conversa, 'phone_number', '+' || _fone)))));
$$;

\set E '92000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 920');
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('92000000-0000-4000-8000-0000000000c0', 'Fictícia', 920920, 'token-920');
INSERT INTO public.chatwoot_inboxes (conexao_id, inbox_id, empresa_id)
VALUES ('92000000-0000-4000-8000-0000000000c0', 920, :'E');
INSERT INTO public.mkt_configuracoes (empresa_id) VALUES (:'E');
SELECT pg_temp.ok((SELECT botoes->>'nao tenho interesse' = 'sem_interesse' AND botoes->>'quero meu orcamento' = 'interesse'
                     FROM public.mkt_configuracoes WHERE empresa_id = :'E'), 'botões novos no padrão');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.mkt_configuracoes
                               WHERE NOT (botoes ? 'nao tenho interesse' AND botoes ? 'quero meu orcamento')),
                  'empresas que já existiam ganharam os botões');

INSERT INTO public.mkt_contatos (id, empresa_id, nome, normalized_phone, tipo) VALUES
  ('92000000-0000-4000-8000-0000000000a1', :'E', 'Ana Fictícia', '5511920000001', 'nao_comprador'),
  ('92000000-0000-4000-8000-0000000000a2', :'E', 'Bia Fictícia', '5511920000002', 'nao_comprador');
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, status, quem_responde)
VALUES ('92000000-0000-4000-8000-0000000000b1', :'E', 'Não recebeu orçamento', 'calendario', '2026-10-01', 'enviando', 'alice');
INSERT INTO public.mkt_envios (empresa_id, campanha_id, contato_id, normalized_phone, grupo, template_nome, status, enviado_em) VALUES
  (:'E', '92000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-0000000000a1', '5511920000001', 'CV', 'tc_sem_orcamento', 'enviado', now() - interval '1 hour'),
  (:'E', '92000000-0000-4000-8000-0000000000b1', '92000000-0000-4000-8000-0000000000a2', '5511920000002', 'CV', 'tc_sem_orcamento', 'enviado', now() - interval '1 hour');

-- "Não tenho interesse": sai das campanhas e o lead vira perdido.
SELECT pg_temp.msg(1, 9201, '5511920000001', 'Não tenho interesse');
SELECT pg_temp.ok((SELECT optout_em IS NOT NULL FROM public.mkt_contatos WHERE id = '92000000-0000-4000-8000-0000000000a1'),
                  'saiu das próximas campanhas');
SELECT pg_temp.ok((SELECT l.perdido_em IS NOT NULL AND NOT l.is_open AND o.name = 'Não tem interesse'
                     FROM public.crm_leads l JOIN public.config_options o ON o.id = l.loss_reason_id
                    WHERE l.empresa_id = :'E' AND l.normalized_phone = '5511920000001'), 'lead perdido: Não tem interesse');
SELECT pg_temp.ok((SELECT botao_clicado FROM public.mkt_envios WHERE contato_id = '92000000-0000-4000-8000-0000000000a1')
                  = 'nao tenho interesse', 'botão registrado');

-- "Quero meu orçamento": interesse, nada muda no lead.
SELECT pg_temp.msg(2, 9202, '5511920000002', 'Quero meu orçamento');
SELECT pg_temp.ok((SELECT optout_em IS NULL FROM public.mkt_contatos WHERE id = '92000000-0000-4000-8000-0000000000a2'),
                  'interesse não descadastra');
SELECT pg_temp.ok((SELECT perdido_em IS NULL AND is_open FROM public.crm_leads
                    WHERE empresa_id = :'E' AND normalized_phone = '5511920000002'), 'lead segue aberto');
SELECT pg_temp.ok((SELECT count(*) FROM public.config_options
                    WHERE empresa_id = :'E' AND kind = 'crm_loss_reason' AND name = 'Não tem interesse') = 1,
                  'motivo criado uma vez');
ROLLBACK;
