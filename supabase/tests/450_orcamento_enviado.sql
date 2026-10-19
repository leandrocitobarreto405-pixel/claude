-- Orçamento salvo = enviado: "enviado" leva o lead aberto (antes da etapa de orçamento) para
-- "Orçamento enviado" com histórico; rascunho, lead fechado ou já adiante não mudam; o ajuste
-- retroativo passa os rascunhos com telefone a "enviado" com a data do orçamento. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '11111111-1111-1111-1111-111111111111'
CREATE FUNCTION pg_temp.st(_nome text) RETURNS uuid LANGUAGE sql AS $$
  SELECT id FROM public.config_options WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
     AND kind = 'crm_status' AND name = _nome
$$;
CREATE FUNCTION pg_temp.status_do(_lead uuid) RETURNS text LANGUAGE sql AS $$
  SELECT o.name FROM public.crm_leads l JOIN public.config_options o ON o.id = l.status_id WHERE l.id = _lead
$$;

-- Cinco leads: novo, em atendimento, aguardando resposta (já adiante), fechado e um para o rascunho.
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, is_open, status_id, first_contact_date) VALUES
  ('a4500000-0000-0000-0000-000000000001', :'E', 'Lead Novo', '11945000001', '5511945000001', true, pg_temp.st('Novo contato'), '2026-10-05'),
  ('a4500000-0000-0000-0000-000000000002', :'E', 'Lead Atendimento', '11945000002', '5511945000002', true, pg_temp.st('Em atendimento'), '2026-10-05'),
  ('a4500000-0000-0000-0000-000000000003', :'E', 'Lead Aguardando', '11945000003', '5511945000003', true, pg_temp.st('Aguardando resposta'), '2026-10-05'),
  ('a4500000-0000-0000-0000-000000000004', :'E', 'Lead Fechado', '11945000004', '5511945000004', false, pg_temp.st('Desistiu'), '2026-10-05'),
  ('a4500000-0000-0000-0000-000000000005', :'E', 'Lead Rascunho', '11945000005', '5511945000005', true, pg_temp.st('Novo contato'), '2026-10-05');

-- 1) orçamento salvo como "enviado" (o que o app grava agora)
INSERT INTO public.quotes (id, empresa_id, cliente_nome, cliente_telefone, crm_lead_id, total, status) VALUES
  ('b4500000-0000-0000-0000-000000000001', :'E', 'Lead Novo', '11945000001', 'a4500000-0000-0000-0000-000000000001', 300, 'enviado'),
  ('b4500000-0000-0000-0000-000000000002', :'E', 'Lead Atendimento', '11945000002', 'a4500000-0000-0000-0000-000000000002', 300, 'enviado'),
  ('b4500000-0000-0000-0000-000000000003', :'E', 'Lead Aguardando', '11945000003', 'a4500000-0000-0000-0000-000000000003', 300, 'enviado'),
  ('b4500000-0000-0000-0000-000000000004', :'E', 'Lead Fechado', '11945000004', 'a4500000-0000-0000-0000-000000000004', 300, 'enviado');
SELECT pg_temp.ok(pg_temp.status_do('a4500000-0000-0000-0000-000000000001') = 'Orçamento enviado', 'Novo contato → Orçamento enviado');
SELECT pg_temp.ok(pg_temp.status_do('a4500000-0000-0000-0000-000000000002') = 'Orçamento enviado', 'Em atendimento → Orçamento enviado');
SELECT pg_temp.ok(pg_temp.status_do('a4500000-0000-0000-0000-000000000003') = 'Aguardando resposta', 'lead já adiante não volta');
SELECT pg_temp.ok(pg_temp.status_do('a4500000-0000-0000-0000-000000000004') = 'Desistiu', 'lead fechado não muda');
SELECT pg_temp.ok((SELECT orcamento_enviado_em IS NOT NULL FROM public.crm_leads WHERE id = 'a4500000-0000-0000-0000-000000000001'),
  'marco "orçamento enviado" no lead');
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_status_history
                    WHERE crm_lead_id = 'a4500000-0000-0000-0000-000000000001'
                      AND previous_status_name = 'Novo contato' AND new_status_name = 'Orçamento enviado'
                      AND change_source = 'Orçamento') = 1, 'histórico da mudança');
-- Salvar de novo (continua enviado) não duplica o histórico.
UPDATE public.quotes SET total = 310 WHERE id = 'b4500000-0000-0000-0000-000000000001';
UPDATE public.quotes SET status = 'enviado' WHERE id = 'b4500000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_status_history
                    WHERE crm_lead_id = 'a4500000-0000-0000-0000-000000000001') = 1, 'sem histórico repetido');

-- Orçamento desligado do lead: volta ao status anterior (sem outro orçamento enviado).
UPDATE public.quotes SET crm_lead_id = NULL WHERE id = 'b4500000-0000-0000-0000-000000000002';
SELECT pg_temp.ok(pg_temp.status_do('a4500000-0000-0000-0000-000000000002') = 'Em atendimento',
  'desligar o orçamento volta o lead ao status anterior');
UPDATE public.quotes SET crm_lead_id = 'a4500000-0000-0000-0000-000000000002' WHERE id = 'b4500000-0000-0000-0000-000000000002';
SELECT pg_temp.ok(pg_temp.status_do('a4500000-0000-0000-0000-000000000002') = 'Orçamento enviado',
  'ligar de novo volta a Orçamento enviado');

-- 2) rascunho não mexe no lead; "convertido" só pelo botão (não vira "Orçamento enviado")
INSERT INTO public.quotes (id, empresa_id, cliente_nome, cliente_telefone, crm_lead_id, total, status, created_at) VALUES
  ('b4500000-0000-0000-0000-000000000005', :'E', 'Lead Rascunho', '11945000005', 'a4500000-0000-0000-0000-000000000005', 500, 'rascunho', '2026-10-06 10:00:00-03'),
  ('b4500000-0000-0000-0000-000000000006', :'E', 'Sem telefone', NULL, NULL, 200, 'rascunho', '2026-10-06 11:00:00-03'),
  ('b4500000-0000-0000-0000-000000000007', :'E', 'Antigo', '11945000007', NULL, 200, 'rascunho', '2026-09-20 11:00:00-03');
SELECT pg_temp.ok(pg_temp.status_do('a4500000-0000-0000-0000-000000000005') = 'Novo contato', 'rascunho não muda o lead');
SELECT pg_temp.ok((SELECT orcamento_enviado_em IS NULL AND orcamento_em IS NOT NULL FROM public.crm_leads
                    WHERE id = 'a4500000-0000-0000-0000-000000000005'), 'rascunho só marca "orçamento"');

-- 3) ajuste retroativo (o mesmo arquivo que roda na produção)
\ir ../../scripts/orcamentos/enviado-retroativo.sql
SELECT pg_temp.ok((SELECT status FROM public.quotes WHERE id = 'b4500000-0000-0000-0000-000000000005') = 'enviado',
  'rascunho com telefone desde 01/10 vira enviado');
SELECT pg_temp.ok((SELECT status FROM public.quotes WHERE id = 'b4500000-0000-0000-0000-000000000006') = 'rascunho',
  'sem telefone continua rascunho');
SELECT pg_temp.ok((SELECT status FROM public.quotes WHERE id = 'b4500000-0000-0000-0000-000000000007') = 'rascunho',
  'antes de 01/10 continua rascunho');
SELECT pg_temp.ok(pg_temp.status_do('a4500000-0000-0000-0000-000000000005') = 'Orçamento enviado', 'lead do retroativo → Orçamento enviado');
SELECT pg_temp.ok((SELECT orcamento_enviado_em = '2026-10-06 10:00:00-03' FROM public.crm_leads
                    WHERE id = 'a4500000-0000-0000-0000-000000000005'), 'data do envio = data do orçamento');
SELECT pg_temp.ok((SELECT notes LIKE 'Orçamento enviado (ajuste de 19/10/2026%' FROM public.crm_status_history
                    WHERE crm_lead_id = 'a4500000-0000-0000-0000-000000000005'), 'histórico diz que foi o ajuste');

-- 4) proposta: guardar o documento não muda a situação
UPDATE public.quotes SET status = 'aprovado' WHERE id = 'b4500000-0000-0000-0000-000000000002';
UPDATE public.quotes SET proposta_documento_id = 'doc-1', proposta_url = 'https://docs.google.com/document/d/doc-1',
       proposta_gerada_em = now() WHERE id = 'b4500000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((SELECT status FROM public.quotes WHERE id = 'b4500000-0000-0000-0000-000000000002') = 'aprovado',
  'proposta não muda a situação do orçamento');
SELECT pg_temp.ok((SELECT generated_work_order_id IS NULL FROM public.quotes WHERE id = 'b4500000-0000-0000-0000-000000000002'),
  'proposta não cria OS');

ROLLBACK;
