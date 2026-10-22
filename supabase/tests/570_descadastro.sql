-- Descadastro de marketing (migração 20261130120000): pedido escrito pelo cliente marca o contato,
-- a base de marketing fica igual nos dois sentidos, o marketing pendente é cancelado (o pós-venda
-- C1 não) e quem entra depois na base já vem marcado. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

\set E '57000000-0000-0000-0000-00000000000e'
\set A '57000000-0000-0000-0000-0000000000a1'
\set B '57000000-0000-0000-0000-0000000000b1'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 570');
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, profile_name) VALUES
  (:'A', :'E', '5511970005701', 'Perfil A'),
  (:'B', :'E', '5511970005702', 'Perfil B');
INSERT INTO public.mkt_contatos (id, empresa_id, nome, tipo, normalized_phone)
VALUES ('57000000-0000-0000-0000-0000000000c1', :'E', 'Contato Fictício', 'comprador', '5511970005701');
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, templates, datas_disparo, status)
VALUES ('57000000-0000-0000-0000-0000000000d1', :'E', 'Oferta', 'calendario', '2026-10-01', '{C5}',
        '{"C5": "tc_reativacao_cliente"}', '{2026-10-30}', 'aprovada');
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, gatilho, template_nome, status)
VALUES ('57000000-0000-0000-0000-0000000000d2', :'E', 'Pós-venda', 'gatilho', '2026-10-01', 'C1',
        'tc_posvenda_resultado', 'enviando');
INSERT INTO public.mkt_envios (id, empresa_id, campanha_id, contato_id, normalized_phone, grupo, template_nome, status) VALUES
  ('57000000-0000-0000-0000-0000000000e1', :'E', '57000000-0000-0000-0000-0000000000d1',
   '57000000-0000-0000-0000-0000000000c1', '5511970005701', 'C5', 'tc_reativacao_cliente', 'pendente'),
  ('57000000-0000-0000-0000-0000000000e2', :'E', '57000000-0000-0000-0000-0000000000d2',
   '57000000-0000-0000-0000-0000000000c1', '5511970005701', 'C1', 'tc_posvenda_resultado', 'pendente');

-- Mesmos casos de src/lib/descadastro.test.ts.
SELECT pg_temp.ok(private.mkt_pedido_saida(m, r) = esperado, 'frase: ' || m)
  FROM (VALUES
    ('Não quero mais ofertas', false, true), ('Pare de mandar mensagem', false, true),
    ('para de me mandar isso', false, true), ('Quero sair da lista', false, true),
    ('Me tira da lista por favor', false, true), ('Não me mande mais nada', false, true),
    ('Não me mandem mais promoções', false, true), ('quero me descadastrar', false, true),
    ('PARAR', false, true), ('Sair', false, true), ('não quero receber mensagens', false, true),
    ('Não quero mais', false, true), ('não quero mais, obrigada', false, true),
    ('Não quero mais, já fiz com outra empresa', true, true),
    ('Não quero mais o orçamento de terça', false, false),
    ('não quero receber o técnico sábado, pode ser domingo?', false, false),
    ('Me tira uma dúvida', false, false), ('almofadas removíveis', false, false),
    ('Para quando tem horário?', false, false), ('Pode parar o carro na garagem', false, false)
  ) AS v(m, r, esperado);

-- Mensagem de atendimento não marca ninguém.
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_type, text_content)
VALUES (:'E', :'A', 'Recebida', 'Texto', 'Me tira uma dúvida sobre a garantia');
SELECT pg_temp.ok((SELECT marketing_optout_em FROM public.whatsapp_contacts WHERE id = :'A') IS NULL,
  'atendimento não marca');

-- Pedido escrito: marca o contato, a base de marketing, cancela a oferta e mantém o pós-venda C1.
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_type, text_content)
VALUES (:'E', :'A', 'Recebida', 'Texto', 'Por favor, pare de mandar promoção');
SELECT pg_temp.ok((SELECT marketing_optout_em IS NOT NULL AND marketing_optout_origem = 'cliente'
                     AND marketing_optout_confirmado_em IS NULL
                     FROM public.whatsapp_contacts WHERE id = :'A'), 'contato marcado pelo cliente');
SELECT pg_temp.ok((SELECT optout_em IS NOT NULL FROM public.mkt_contatos
                    WHERE id = '57000000-0000-0000-0000-0000000000c1'), 'base de marketing marcada');
SELECT pg_temp.ok((SELECT status FROM public.mkt_envios WHERE id = '57000000-0000-0000-0000-0000000000e1') = 'cancelado',
  'oferta pendente cancelada');
SELECT pg_temp.ok((SELECT status FROM public.mkt_envios WHERE id = '57000000-0000-0000-0000-0000000000e2') = 'pendente',
  'pós-venda C1 continua');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_tarefas
                    WHERE empresa_id = :'E' AND tipo = 'etiqueta_optout') = 1, 'etiqueta no Chatwoot');

-- Segunda mensagem igual não mexe em nada (já está marcado).
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_type, text_content)
VALUES (:'E', :'A', 'Recebida', 'Texto', 'PARAR');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_tarefas WHERE empresa_id = :'E') = 1, 'sem tarefa repetida');

-- A equipe liga de novo: a base de marketing volta junto.
UPDATE public.whatsapp_contacts SET marketing_optout_em = NULL, marketing_optout_origem = NULL WHERE id = :'A';
SELECT pg_temp.ok((SELECT optout_em FROM public.mkt_contatos
                    WHERE id = '57000000-0000-0000-0000-0000000000c1') IS NULL, 'religado na base');

-- Saída pela base (botão da campanha, bloqueio no WhatsApp): o contato fica marcado como "marketing".
UPDATE public.mkt_contatos SET optout_em = now() WHERE id = '57000000-0000-0000-0000-0000000000c1';
SELECT pg_temp.ok((SELECT marketing_optout_origem FROM public.whatsapp_contacts WHERE id = :'A') = 'marketing',
  'saída pela base vai para o contato');

-- Quem pediu para sair e só depois entra na base de marketing já entra marcado.
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, direction, message_type, text_content)
VALUES (:'E', :'B', 'Recebida', 'Texto', 'não me mande mais mensagens');
INSERT INTO public.mkt_contatos (id, empresa_id, nome, tipo, normalized_phone)
VALUES ('57000000-0000-0000-0000-0000000000c2', :'E', 'Outro Fictício', 'comprador', '11970005702');
SELECT pg_temp.ok((SELECT optout_em IS NOT NULL FROM public.mkt_contatos
                    WHERE id = '57000000-0000-0000-0000-0000000000c2'), 'entra na base já marcado');

-- Listas sem quem saiu; pós-venda C1 sem o filtro de opt-out no disparo.
SELECT pg_temp.ok(pg_get_functiondef('private.mkt_publico(uuid,jsonb,boolean,date)'::regprocedure)
  LIKE '%AND NOT x.optout%', 'listas sem quem saiu');
SELECT pg_temp.ok(pg_get_functiondef('public.mkt_listas_contagem(jsonb)'::regprocedure)
  LIKE '%WHERE NOT x.optout%', 'contagem sem quem saiu');
SELECT pg_temp.ok(pg_get_functiondef('public.mkt_reservar_envios(integer,timestamp with time zone)'::regprocedure)
  LIKE '%mkt_envio_pos_venda%', 'reserva não cancela o C1');
SELECT pg_temp.ok(pg_get_functiondef('public.mkt_confirmar_envio(uuid,timestamp with time zone)'::regprocedure)
  LIKE '%mkt_envio_pos_venda%', 'confirmação não cancela o C1');

-- Origem só com os valores previstos; confirmação da Alice começa desligada.
DO $$
BEGIN
  UPDATE public.whatsapp_contacts SET marketing_optout_origem = 'chute'
   WHERE id = '57000000-0000-0000-0000-0000000000a1';
  RAISE EXCEPTION 'FALHOU: origem inválida aceita';
EXCEPTION WHEN check_violation THEN NULL;
END $$;
INSERT INTO public.ia_configuracoes (empresa_id) VALUES (:'E');
SELECT pg_temp.ok((SELECT NOT descadastro_resposta FROM public.ia_configuracoes WHERE empresa_id = :'E'),
  'resposta da Alice começa desligada');
ROLLBACK;
