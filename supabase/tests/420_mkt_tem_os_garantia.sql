-- Marketing sem clientes: OS recente ou em aberto ("tem OS") sai de conversa/orçamento e da promoção;
-- garantia/reclamação em aberto sai de tudo; na hora do envio o pendente é cancelado; aviso só no app
-- para serviço passado ainda "Agendado". Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'
-- Lista de conversa (+ clientes) e promoção: motivo por nome.
CREATE FUNCTION pg_temp.motivo(_nome text, _promocao boolean) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(motivo, 'pode')
    FROM private.mkt_publico('11111111-1111-1111-1111-111111111111',
           '{"conversa": {"de": 0, "ate": 400}, "clientes": {"de": 0, "ate": 400}}', _promocao, NULL)
   WHERE nome = _nome
$$;
CREATE FUNCTION pg_temp.na_lista(_nome text) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM private.mkt_publico('11111111-1111-1111-1111-111111111111',
           '{"conversa": {"de": 0, "ate": 400}, "clientes": {"de": 0, "ate": 400}}', false, NULL) WHERE nome = _nome)
$$;

INSERT INTO public.mkt_configuracoes (empresa_id, disparo_ligado, dias_disparo, hora_disparo, hora_limite)
VALUES (:'E', true, '{1,2,3,4,5,6,7}', 8, 21)
ON CONFLICT (empresa_id) DO UPDATE SET disparo_ligado = true, dias_disparo = '{1,2,3,4,5,6,7}', hora_disparo = 8, hora_limite = 21;
UPDATE public.empresas SET implantacao_liberada_em = now() WHERE id = :'E';

-- Quatro pessoas que conversaram (lead) há 20 dias:
--  Aberta: OS com visita de 10 dias atrás ainda "Agendado" (serviço feito e não concluído no app)
--  Recente: OS concluída, venda há 30 dias
--  Antiga: OS concluída, venda há 100 dias (volta a entrar normalmente)
--  Garantia: sem OS, retorno pendente de garantia
INSERT INTO public.customers (id, empresa_id, full_name, phone) VALUES
  ('c4200000-0000-0000-0000-000000000001', :'E', 'Aberta Fictícia', '11942000001'),
  ('c4200000-0000-0000-0000-000000000002', :'E', 'Recente Fictícia', '11942000002'),
  ('c4200000-0000-0000-0000-000000000003', :'E', 'Antiga Fictícia', '11942000003');
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, first_contact_date, created_at, last_interaction_at) VALUES
  ('a4200000-0000-0000-0000-000000000001', :'E', 'Aberta Fictícia', '11942000001', '5511942000001', true, current_date - 20, now() - interval '20 days', now() - interval '20 days'),
  ('a4200000-0000-0000-0000-000000000002', :'E', 'Recente Fictícia', '11942000002', '5511942000002', true, current_date - 20, now() - interval '20 days', now() - interval '20 days'),
  ('a4200000-0000-0000-0000-000000000003', :'E', 'Antiga Fictícia', '11942000003', '5511942000003', true, current_date - 20, now() - interval '20 days', now() - interval '20 days'),
  ('a4200000-0000-0000-0000-000000000004', :'E', 'Garantia Fictícia', '11942000004', '5511942000004', true, current_date - 20, now() - interval '20 days', now() - interval '20 days');
-- O lead cria o contato de marketing (gatilho); só acerta nome e primeiro nome.
UPDATE public.mkt_contatos c
   SET nome = l.lead_name, primeiro_nome = split_part(l.lead_name, ' ', 1), crm_lead_id = l.id
  FROM public.crm_leads l
 WHERE l.id::text LIKE 'a4200000-%' AND c.empresa_id = l.empresa_id
   AND private.telefone_chave(c.normalized_phone) = private.telefone_chave(l.normalized_phone);
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_contatos WHERE nome LIKE '% Fictícia') = 4, 'quatro contatos de marketing');
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date) VALUES
  ('e4200000-0000-0000-0000-000000000001', :'E', '42001', 'c4200000-0000-0000-0000-000000000001', 300, current_date - 12),
  ('e4200000-0000-0000-0000-000000000002', :'E', '42002', 'c4200000-0000-0000-0000-000000000002', 300, current_date - 30),
  ('e4200000-0000-0000-0000-000000000003', :'E', '42003', 'c4200000-0000-0000-0000-000000000003', 300, current_date - 100);
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status) VALUES
  ('f4200000-0000-0000-0000-000000000001', :'E', 'e4200000-0000-0000-0000-000000000001', current_date - 10, '09:00', 'Agendado'),
  ('f4200000-0000-0000-0000-000000000002', :'E', 'e4200000-0000-0000-0000-000000000002', current_date - 28, '09:00', 'Concluído'),
  ('f4200000-0000-0000-0000-000000000003', :'E', 'e4200000-0000-0000-0000-000000000003', current_date - 98, '09:00', 'Concluído');
INSERT INTO public.crm_followups (empresa_id, crm_lead_id, scheduled_at, responsavel, notes)
VALUES (:'E', 'a4200000-0000-0000-0000-000000000004', now() + interval '1 day', 'equipe', 'Garantia: mancha voltou no sofá');

-- ---------------------------------------------------------------- 1) listas e promoção
SELECT pg_temp.ok(pg_temp.motivo('Aberta Fictícia', false) = 'tem OS', 'visita passada ainda Agendado: fora de conversa com motivo "tem OS" (' || pg_temp.motivo('Aberta Fictícia', false) || ')');
SELECT pg_temp.ok(pg_temp.motivo('Aberta Fictícia', true) = 'tem OS', 'e fora da promoção');
SELECT pg_temp.ok(pg_temp.motivo('Recente Fictícia', false) = 'tem OS', 'venda há 30 dias: fora de conversa');
SELECT pg_temp.ok(pg_temp.motivo('Antiga Fictícia', false) = 'pode', 'venda há 100 dias e tudo concluído: entra normalmente (' || pg_temp.motivo('Antiga Fictícia', false) || ')');
SELECT pg_temp.ok(pg_temp.motivo('Garantia Fictícia', false) = 'garantia/reclamação em aberto', 'garantia pendente: fora das listas com o motivo');
SELECT pg_temp.ok(pg_temp.motivo('Garantia Fictícia', true) = 'garantia/reclamação em aberto', 'garantia pendente: fora da promoção');

-- ---------------------------------------------------------------- 2) campanha preparada
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, grupos, datas_disparo, listas) VALUES
  ('fa420000-0000-0000-0000-000000000001', :'E', 'Conversas', 'calendario', date_trunc('month', current_date), '{}',
   ARRAY[current_date + 30], '[{"grupo": "CV", "familia": "conversa", "ate": 400}]');
SELECT public.mkt_preparar_campanha('fa420000-0000-0000-0000-000000000001');
SELECT pg_temp.ok((SELECT string_agg(c.nome, ',' ORDER BY c.nome) FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
                    WHERE e.campanha_id = 'fa420000-0000-0000-0000-000000000001') = 'Antiga Fictícia',
  'campanha de conversa só com quem não tem OS nem garantia: ' || coalesce((SELECT string_agg(c.nome, ',' ORDER BY c.nome)
     FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id WHERE e.campanha_id = 'fa420000-0000-0000-0000-000000000001'), '-'));

-- ---------------------------------------------------------------- 3) na hora do envio
-- A Antiga passa a ter OS nova e a Recente ganha garantia: os pendentes são cancelados antes de reservar.
INSERT INTO public.work_orders (id, empresa_id, os_number, customer_id, total_gross_value, sale_date) VALUES
  ('e4200000-0000-0000-0000-000000000004', :'E', '42004', 'c4200000-0000-0000-0000-000000000003', 200, current_date);
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status) VALUES
  ('f4200000-0000-0000-0000-000000000004', :'E', 'e4200000-0000-0000-0000-000000000004', current_date + 3, '09:00', 'Agendado');
-- Um lembrete (gatilho) pendente para a Garantia, para provar que o lembrete também cai.
INSERT INTO public.mkt_campanhas (id, empresa_id, nome, tipo, mes_ref, gatilho, template_nome, status) VALUES
  ('fa420000-0000-0000-0000-000000000002', :'E', 'Lembrete C2', 'gatilho', date_trunc('month', current_date), 'C2', 'tc_higienizacao_6meses', 'aprovada');
INSERT INTO public.mkt_lotes (id, empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, status) VALUES
  ('fb420000-0000-0000-0000-000000000002', :'E', 'fa420000-0000-0000-0000-000000000002', 1, 'gat-c2-teste', current_date, 'aprovado');
INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome, variante_sn, ordem, status, agendado_para)
SELECT :'E', 'fa420000-0000-0000-0000-000000000002', 'fb420000-0000-0000-0000-000000000002', c.id, c.normalized_phone, 'C2', 'tc_higienizacao_6meses', false, 0, 'pendente', now()
  FROM public.mkt_contatos c WHERE c.nome = 'Garantia Fictícia';
INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo, template_nome, variante_sn, ordem, status, agendado_para)
SELECT :'E', 'fa420000-0000-0000-0000-000000000002', 'fb420000-0000-0000-0000-000000000002', c.id, c.normalized_phone, 'C2', 'tc_higienizacao_6meses', false, 1, 'pendente', now()
  FROM public.mkt_contatos c WHERE c.nome = 'Aberta Fictícia';
UPDATE public.mkt_campanhas SET status = 'aprovada' WHERE id = 'fa420000-0000-0000-0000-000000000001';
UPDATE public.mkt_lotes SET status = 'aprovado' WHERE campanha_id = 'fa420000-0000-0000-0000-000000000001';
UPDATE public.mkt_envios SET agendado_para = now() WHERE campanha_id = 'fa420000-0000-0000-0000-000000000001';
-- Fora do horário (3h): só confere e cancela, nada é reservado.
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, (current_date + time '03:00')::timestamp AT TIME ZONE 'America/Sao_Paulo')) = 0,
  'de madrugada nada é reservado');
SELECT pg_temp.ok((SELECT status || '/' || coalesce(erro, '') FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
                    WHERE e.campanha_id = 'fa420000-0000-0000-0000-000000000001' AND c.nome = 'Antiga Fictícia') = 'cancelado/tem OS',
  'campanha: quem passou a ter OS é cancelado com "tem OS"');
SELECT pg_temp.ok((SELECT status || '/' || coalesce(erro, '') FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
                    WHERE e.campanha_id = 'fa420000-0000-0000-0000-000000000002' AND c.nome = 'Garantia Fictícia') = 'cancelado/garantia/reclamação em aberto',
  'lembrete: garantia em aberto é cancelada');
SELECT pg_temp.ok((SELECT status FROM public.mkt_envios e JOIN public.mkt_contatos c ON c.id = e.contato_id
                    WHERE e.campanha_id = 'fa420000-0000-0000-0000-000000000002' AND c.nome = 'Aberta Fictícia') = 'pendente',
  'lembrete: "tem OS" não cancela lembrete (só garantia)');

-- ---------------------------------------------------------------- 4) aviso só no app
SELECT pg_temp.ok(public.avisos_servicos_nao_concluidos() = 1, 'um aviso para a visita de 10 dias atrás ainda Agendado');
SELECT pg_temp.ok((SELECT mensagem FROM public.mkt_avisos WHERE tipo = 'servico_nao_concluido' AND referencia = 'visita:f4200000-0000-0000-0000-000000000001')
                  = 'Serviço de ' || to_char(current_date - 10, 'DD/MM') || ' da OS 42001 ainda não foi concluído.',
  'texto do aviso');
SELECT pg_temp.ok((SELECT so_no_app FROM public.mkt_avisos WHERE referencia = 'visita:f4200000-0000-0000-0000-000000000001'), 'aviso só no app');
SELECT pg_temp.ok(public.avisos_servicos_nao_concluidos() = 0, 'segunda rodada não repete o aviso');
-- Visita de hoje ainda Agendado: nada (só depois de 1 dia).
INSERT INTO public.visits (id, empresa_id, work_order_id, scheduled_date, scheduled_time, status) VALUES
  ('f4200000-0000-0000-0000-000000000005', :'E', 'e4200000-0000-0000-0000-000000000004', current_date, '09:00', 'Agendado');
SELECT pg_temp.ok(public.avisos_servicos_nao_concluidos() = 0, 'visita de hoje não gera aviso');
SELECT pg_temp.ok(public.avisos_servicos_nao_concluidos(current_date + 1) = 1, 'no dia seguinte gera');
ROLLBACK;
