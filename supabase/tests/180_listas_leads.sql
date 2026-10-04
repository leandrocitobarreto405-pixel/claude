-- Listas de leads: filtros acumulados por família, cliente também em orçamento, perdido por preço,
-- agendado, quem nunca recebe e o limite de uma mensagem de marketing a cada 30 dias.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.quem(_filtros jsonb, _promocao boolean DEFAULT false) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(nome, ',' ORDER BY nome), '')
    FROM private.mkt_publico('11111111-1111-1111-1111-111111111111', _filtros, _promocao)
$$;
CREATE FUNCTION pg_temp.podem(_filtros jsonb, _promocao boolean DEFAULT false) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(string_agg(nome, ',' ORDER BY nome), '')
    FROM private.mkt_publico('11111111-1111-1111-1111-111111111111', _filtros, _promocao) WHERE pode_receber
$$;
CREATE FUNCTION pg_temp.orc(_nome text, _fone text, _dias int, _valor numeric DEFAULT 400) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO public.quotes (empresa_id, cliente_nome, cliente_telefone, total, status, created_at)
  VALUES ('11111111-1111-1111-1111-111111111111', _nome, _fone, _valor, 'enviado', now() - make_interval(days => _dias));
$$;

-- Orçamentos (entram na base pelo gatilho do orçamento).
SELECT pg_temp.orc('Ana Souza', '11910000001', 5, 450);
SELECT pg_temp.orc('Beto Lima', '11910000002', 45);
SELECT pg_temp.orc('Fabi Reis', '11910000006', 2);
SELECT pg_temp.orc('Gil Rocha', '11910000007', 4);
SELECT pg_temp.orc('Hugo Dias', '11910000008', 6);
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_contatos WHERE origem_importacao = 'orcamento') = 5,
  'orçamento entra na base de contatos');
SELECT pg_temp.ok((SELECT orcamento_valor FROM private.mkt_publico('11111111-1111-1111-1111-111111111111',
  '{"orcamento": {}}') WHERE nome = 'Ana Souza') = 450, 'valor do orçamento');

-- Conversa sem orçamento (lead do WhatsApp há 15 dias).
INSERT INTO public.crm_leads (empresa_id, lead_name, phone, normalized_phone, first_contact_date, created_at,
  last_interaction_at, is_open)
VALUES ('11111111-1111-1111-1111-111111111111', 'Caio Melo', '11910000003', '5511910000003', current_date - 15,
  now() - interval '15 days', now() - interval '15 days', true);

-- Cliente há 100 dias que pediu orçamento novo há 3 dias: fica nas duas listas.
INSERT INTO public.mkt_contatos (empresa_id, nome, normalized_phone, tipo, ultimo_servico_em, ultimo_servico_tipo)
VALUES ('11111111-1111-1111-1111-111111111111', 'Dani Alves', '5511910000004', 'comprador',
        now() - interval '100 days', 'higienizacao');
SELECT pg_temp.orc('Dani Alves', '11910000004', 3);

-- Perdido por preço há 20 dias (orçamento de 30 dias): só em "perdido por preço".
INSERT INTO public.crm_leads (empresa_id, lead_name, phone, normalized_phone, first_contact_date, created_at,
  is_open, perdido_em, loss_reason_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'Edu Pinto', '11910000005', '5511910000005', current_date - 40,
  now() - interval '40 days', false, now() - interval '20 days',
  (SELECT id FROM public.config_options WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
     AND kind = 'crm_loss_reason' AND name = 'Concorrente mais barato' LIMIT 1));
SELECT pg_temp.orc('Edu Pinto', '11910000005', 30);

-- Fabi tem serviço marcado amanhã.
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c8000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', 'Fabi Reis', '11910000006');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id) VALUES
  ('e8000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111', '8006',
   'c8000000-0000-0000-0000-000000000006');
INSERT INTO public.visits (empresa_id, work_order_id, scheduled_date, scheduled_time, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'e8000000-0000-0000-0000-000000000006', current_date + 1, '09:00', 'Agendado');

-- Gil saiu das ofertas; Hugo recebeu promoção há 10 dias; Iara é cliente "sem pós-venda".
UPDATE public.mkt_contatos SET optout_em = now() WHERE nome = 'Gil Rocha';
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, status)
VALUES ('f8000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Promo antiga',
        'promocao', date_trunc('month', current_date), 'concluida');
INSERT INTO public.mkt_envios (empresa_id, campanha_id, contato_id, normalized_phone, template_nome, status, enviado_em)
SELECT empresa_id, 'f8000000-0000-0000-0000-000000000001', id, normalized_phone, 'tc_promocao_agenda', 'enviado',
       now() - interval '10 days'
  FROM public.mkt_contatos WHERE nome = 'Hugo Dias';
INSERT INTO public.mkt_contatos (empresa_id, nome, normalized_phone, tipo, ultimo_servico_em, ultimo_servico_tipo,
  sem_pos_venda)
VALUES ('11111111-1111-1111-1111-111111111111', 'Iara Nunes', '5511910000009', 'comprador',
        now() - interval '20 days', 'impermeabilizacao', true);

-- 1. Filtros acumulados.
SELECT pg_temp.ok(pg_temp.quem('{"orcamento": {"ate": 10}}') = 'Ana Souza,Dani Alves,Gil Rocha,Hugo Dias',
  'orçamento até 10 dias: ' || pg_temp.quem('{"orcamento": {"ate": 10}}'));
SELECT pg_temp.ok(pg_temp.quem('{"orcamento": {"ate": 60}}') = 'Ana Souza,Beto Lima,Dani Alves,Gil Rocha,Hugo Dias',
  'orçamento até 60 dias inclui o de 45');
SELECT pg_temp.ok(pg_temp.quem('{"orcamento": {"de": 31, "ate": 90}}') = 'Beto Lima', 'entre 31 e 90 dias');
SELECT pg_temp.ok(pg_temp.quem('{"conversa": {"ate": 10}}') = '', 'conversa até 10 dias: ninguém');
SELECT pg_temp.ok(pg_temp.quem('{"conversa": {"ate": 20}}') = 'Caio Melo', 'conversa até 20 dias');
SELECT pg_temp.ok(pg_temp.quem('{"clientes": {"ate": 30}}') = 'Iara Nunes', 'clientes até 30 dias');
SELECT pg_temp.ok(pg_temp.quem('{"clientes": {"ate": 180}}') = 'Dani Alves,Iara Nunes', 'clientes até 6 meses');
SELECT pg_temp.ok(pg_temp.quem('{"perdido_preco": {}}') = 'Edu Pinto', 'perdido por preço (concorrente)');
SELECT pg_temp.ok(pg_temp.quem('{"agendado": {}}') = 'Fabi Reis', 'agendado');
SELECT pg_temp.ok(position('Edu' IN pg_temp.quem('{"orcamento": {}}')) = 0, 'perdido por preço sai do orçamento');
SELECT pg_temp.ok(position('Fabi' IN pg_temp.quem('{"orcamento": {}}')) = 0, 'agendado sai do orçamento');

-- 2. Juntar famílias sem repetir pessoa; quem pode receber agora.
SELECT pg_temp.ok(pg_temp.quem('{"orcamento": {"ate": 10}, "clientes": {}}')
  = 'Ana Souza,Dani Alves,Gil Rocha,Hugo Dias,Iara Nunes', 'Dani aparece uma vez só');
SELECT pg_temp.ok(pg_temp.podem('{"orcamento": {"ate": 10}, "conversa": {"ate": 30}}') = 'Ana Souza,Caio Melo,Dani Alves',
  'podem receber: ' || pg_temp.podem('{"orcamento": {"ate": 10}, "conversa": {"ate": 30}}'));
SELECT pg_temp.ok((SELECT motivo FROM private.mkt_publico('11111111-1111-1111-1111-111111111111', '{"orcamento": {}}')
  WHERE nome = 'Hugo Dias') = 'recebeu marketing há 10 dias', 'limite de 30 dias');
SELECT pg_temp.ok((SELECT motivo FROM private.mkt_publico('11111111-1111-1111-1111-111111111111', '{"clientes": {}}')
  WHERE nome = 'Iara Nunes') = 'cliente marcado sem pós-venda', 'sem pós-venda nunca recebe');
SELECT pg_temp.ok((SELECT motivo FROM private.mkt_publico('11111111-1111-1111-1111-111111111111', '{"agendado": {}}', true)
  WHERE nome = 'Fabi Reis') = 'tem serviço marcado', 'agendado não recebe promoção');
UPDATE public.mkt_configuracoes SET limite_marketing_dias = 7 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO public.mkt_configuracoes (empresa_id, limite_marketing_dias)
VALUES ('11111111-1111-1111-1111-111111111111', 7) ON CONFLICT (empresa_id) DO NOTHING;
SELECT pg_temp.ok((SELECT pode_receber FROM private.mkt_publico('11111111-1111-1111-1111-111111111111',
  '{"orcamento": {}}') WHERE nome = 'Hugo Dias'), 'limite editável (7 dias)');

ROLLBACK;
