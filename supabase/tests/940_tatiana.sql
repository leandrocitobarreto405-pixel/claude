-- Tatiana, fase 2 (migração 20261228310000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid)
RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers', json_build_object('x-empresa-id', _empresa)::text, false);
$$;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set E '94000000-0000-4000-8000-00000000000e'
\set Q1 '94000000-0000-4000-8000-0000000000b1'
\set L1 '94000000-0000-4000-8000-0000000000a1'
\set L2 '94000000-0000-4000-8000-0000000000a2'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 940');
INSERT INTO auth.users (email) VALUES ('dona@p940.test'), ('maria@p940.test'), ('carol@p940.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'E'::uuid, 'admin'::papel_empresa FROM auth.users WHERE email = 'dona@p940.test'
UNION ALL SELECT id, :'E'::uuid, 'atendente'::papel_empresa FROM auth.users WHERE email = 'maria@p940.test'
UNION ALL SELECT id, :'E'::uuid, 'atendente'::papel_empresa FROM auth.users WHERE email = 'carol@p940.test';

-- 1a. Orçamento enviado antes de o lead existir: o lead novo pega o orçamento e ganha a marca (app).
INSERT INTO public.quotes (id, empresa_id, cliente_nome, cliente_telefone, total, status, lucro_percentual)
VALUES (:'Q1', :'E', 'Cliente Fictício', '(11) 99400-0001', 300, 'enviado', 30);
SELECT pg_temp.ok((SELECT crm_lead_id FROM public.quotes WHERE id = :'Q1') IS NULL, 'orçamento nasce sem lead');
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, first_contact_date)
VALUES (:'L1', :'E', 'Lead Fictício 1', '11994000001', '5511994000001', current_date);
SELECT pg_temp.ok((SELECT crm_lead_id FROM public.quotes WHERE id = :'Q1') = :'L1'::uuid, 'lead novo pega o orçamento');
SELECT pg_temp.ok((SELECT orcamento_enviado_em IS NOT NULL AND orcamento_origem = 'app' FROM public.crm_leads WHERE id = :'L1'),
                  'lead marcado como orçamento enviado pelo app');

-- 1b. Preço passado pela equipe na conversa marca o lead (conversa); Alice e cliente não marcam.
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, first_contact_date)
VALUES (:'L2', :'E', 'Lead Fictício 2', '11994000002', '5511994000002', current_date);
\set W '94000000-0000-4000-8000-0000000000d1'
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone) VALUES (:'W', :'E', '5511994000002');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, crm_lead_id, direction, remetente_tipo, privada, text_content, message_timestamp, origem)
VALUES (:'E', :'W', :'L2', 'Enviada', 'agent_bot', false, 'Fica R$ 250,00 no Pix', now() - interval '3 hours', 'chatwoot'),
       (:'E', :'W', :'L2', 'Recebida', 'contact', false, 'Vi por R$ 200 em outro lugar', now() - interval '2 hours', 'chatwoot');
SELECT pg_temp.ok((SELECT orcamento_enviado_em IS NULL FROM public.crm_leads WHERE id = :'L2'), 'Alice e cliente não marcam');
INSERT INTO public.whatsapp_messages (empresa_id, whatsapp_contact_id, crm_lead_id, direction, remetente_tipo, privada, text_content, message_timestamp, origem)
VALUES (:'E', :'W', :'L2', 'Enviada', 'user', false, 'O valor fica R$ 320,00 em até 5x', now() - interval '1 hour', 'chatwoot');
SELECT pg_temp.ok((SELECT orcamento_origem = 'conversa' AND orcamento_enviado_em IS NOT NULL FROM public.crm_leads WHERE id = :'L2'),
                  'equipe passou preço: marcado (conversa)');
-- Recalcular os marcos não apaga a marca da conversa.
SELECT private.atualizar_marcos_lead(:'L2');
SELECT pg_temp.ok((SELECT orcamento_origem = 'conversa' AND orcamento_enviado_em IS NOT NULL FROM public.crm_leads WHERE id = :'L2'),
                  'recalcular mantém a marca da conversa');
-- Áudio transcrito depois também marca (lead sem marca).
UPDATE public.crm_leads SET orcamento_enviado_em = NULL, orcamento_origem = NULL WHERE id = :'L2';
INSERT INTO public.whatsapp_messages (id, empresa_id, whatsapp_contact_id, crm_lead_id, direction, remetente_tipo, privada, message_type, message_timestamp, origem)
VALUES ('94000000-0000-4000-8000-0000000000c1', :'E', :'W', :'L2', 'Enviada', 'user', false, 'Áudio', now(), 'chatwoot');
UPDATE public.whatsapp_messages SET transcricao = 'fica trezentos e vinte, 320 reais no cartão' WHERE id = '94000000-0000-4000-8000-0000000000c1';
SELECT pg_temp.ok((SELECT orcamento_origem = 'conversa' FROM public.crm_leads WHERE id = :'L2'), 'áudio transcrito com preço marca');

-- 3. Cobranças e recados: cada pessoa vê as suas; o admin vê tudo; ninguém grava direto.
INSERT INTO public.comercial_cobrancas (empresa_id, crm_lead_id, user_id, tipo, texto)
SELECT :'E'::uuid, :'L1'::uuid, id, 'orcamento_sem_app', 'Preço passado na conversa sem orçamento no app' FROM auth.users WHERE email = 'maria@p940.test'
UNION ALL
SELECT :'E'::uuid, :'L2'::uuid, id, 'cadastro', 'Completar o cadastro' FROM auth.users WHERE email = 'carol@p940.test';
INSERT INTO public.comercial_recados (empresa_id, user_id, dia, frase)
SELECT :'E'::uuid, id, current_date, 'Bom dia, Maria! Bora vender 💙' FROM auth.users WHERE email = 'maria@p940.test';

SELECT pg_temp.como('maria@p940.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_cobrancas) = 1, 'Maria vê só a dela');
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_recados) = 1, 'Maria vê o recado dela');
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_decisoes) = 0, 'atendente não vê decisões');
SELECT public.comercial_resolver_cobranca((SELECT id FROM public.comercial_cobrancas LIMIT 1), 'ja_certo', 'já criei');
DO $$ BEGIN
  UPDATE public.comercial_cobrancas SET situacao = 'pendente';
  RAISE EXCEPTION 'FALHOU: gravou direto';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
SELECT pg_temp.ok((SELECT situacao = 'ja_certo' AND motivo = 'já criei' AND resolvida_em IS NOT NULL
                     FROM public.comercial_cobrancas WHERE tipo = 'orcamento_sem_app' AND empresa_id = :'E'),
                  'resolvida com motivo');

-- Maria não resolve a cobrança da Carol.
SELECT pg_temp.como('maria@p940.test', :'E');
SET ROLE authenticated;
DO $$ BEGIN
  PERFORM public.comercial_resolver_cobranca(
    (SELECT c.id FROM public.comercial_cobrancas c WHERE c.tipo = 'cadastro'), 'resolvida', NULL);
  RAISE EXCEPTION 'FALHOU: resolveu a de outra pessoa';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
END $$;
RESET ROLE;

SELECT pg_temp.como('dona@p940.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_cobrancas) = 2, 'admin vê as duas');
SELECT public.comercial_resolver_cobranca((SELECT id FROM public.comercial_cobrancas WHERE tipo = 'cadastro'), 'resolvida');
RESET ROLE;
SELECT pg_temp.ok((SELECT situacao = 'resolvida' FROM public.comercial_cobrancas WHERE tipo = 'cadastro' AND empresa_id = :'E'),
                  'admin resolve');

-- 3b. Equipe única: acerto da equipe (sem pessoa) aparece e é resolvido por qualquer atendente.
INSERT INTO public.comercial_configuracoes (empresa_id, ligado, equipe_unica) VALUES (:'E', true, false)
ON CONFLICT (empresa_id) DO UPDATE SET equipe_unica = false;
INSERT INTO public.comercial_cobrancas (empresa_id, crm_lead_id, user_id, tipo, texto)
VALUES (:'E', :'L1', NULL, 'pagamento', 'Pagamento não lançado');
SELECT pg_temp.como('carol@p940.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_cobrancas WHERE tipo = 'pagamento') = 0,
                  'sem equipe única, acerto sem dono só o admin vê');
RESET ROLE;
UPDATE public.comercial_configuracoes SET equipe_unica = true WHERE empresa_id = :'E';
SELECT pg_temp.como('carol@p940.test', :'E');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.comercial_cobrancas WHERE tipo = 'pagamento') = 1,
                  'equipe única: a atendente vê o acerto da equipe');
SELECT public.comercial_resolver_cobranca((SELECT id FROM public.comercial_cobrancas WHERE tipo = 'pagamento'), 'resolvida');
RESET ROLE;
SELECT pg_temp.ok((SELECT situacao = 'resolvida' AND resolvida_por = (SELECT id FROM auth.users WHERE email = 'carol@p940.test')
                     FROM public.comercial_cobrancas WHERE tipo = 'pagamento' AND empresa_id = :'E'),
                  'equipe única: quem resolveu fica gravado');

-- 4. Tarefa da Tatiana (trilha G) em crm_followups.
INSERT INTO public.crm_followups (empresa_id, crm_lead_id, scheduled_at, status, responsavel, trilha, etapa, origem, mensagem, motivo, prioridade)
VALUES (:'E', :'L2', now() + interval '12 hours', 'Pendente', 'equipe', 'G', 'G1', 'gerente', 'Oi! Separei um horário…', 'pediu desconto', 1);
SELECT pg_temp.ok((SELECT count(*) FROM public.crm_followups WHERE empresa_id = :'E' AND trilha = 'G') = 1, 'tarefa G gravada');

-- 5. Pushes novos aceitos.
INSERT INTO public.push_envios (empresa_id, user_id, tipo, ref, titulo)
SELECT :'E'::uuid, id, 'tatiana_tarefas', 'teste', 'A Tatiana separou 1 tarefa pra você hoje' FROM auth.users WHERE email = 'maria@p940.test';

ROLLBACK;
