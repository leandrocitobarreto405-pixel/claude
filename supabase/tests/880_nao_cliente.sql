-- "Não é cliente" e origem do orçamento (migração 20261228210000). Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '88000000-0000-4000-8000-00000000000e'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Empresa Fictícia 880');
SELECT private.garantir_motivos_sem_desfecho(:'E');
SELECT pg_temp.ok((SELECT count(*) FROM public.config_options WHERE empresa_id = :'E'
  AND kind = 'crm_loss_reason' AND name IN ('Não é cliente', 'Cliente antigo / pós-venda')
  AND (metadata->>'nao_conta')::boolean) = 2, 'empresa nova ganha os dois motivos que não contam');
SELECT private.garantir_motivos_sem_desfecho(:'E');
SELECT pg_temp.ok((SELECT count(*) FROM public.config_options WHERE empresa_id = :'E'
  AND kind = 'crm_loss_reason' AND name = 'Não é cliente') = 1, 'rodar de novo não duplica');
INSERT INTO public.crm_leads (id, empresa_id, lead_name, phone, normalized_phone, orcamento_origem)
VALUES ('88000000-0000-4000-8000-0000000000a1', :'E', 'Lead Fictício', '11988000001', '5511988000001', 'conversa');
DO $$ BEGIN
  INSERT INTO public.crm_leads (empresa_id, lead_name, orcamento_origem)
  VALUES ('88000000-0000-4000-8000-00000000000e', 'X', 'outra');
  RAISE EXCEPTION 'FALHOU: origem inválida passou';
EXCEPTION WHEN check_violation THEN NULL; END $$;
INSERT INTO public.whatsapp_contacts (id, empresa_id, normalized_phone, nao_cliente_em, nao_cliente_motivo)
VALUES ('88000000-0000-4000-8000-0000000000c1', :'E', '5511988000002', now(), 'propaganda');
SELECT pg_temp.ok((SELECT nao_cliente_motivo FROM public.whatsapp_contacts WHERE id = '88000000-0000-4000-8000-0000000000c1') = 'propaganda', 'contato marcado');
ROLLBACK;
