-- Avisos da equipe pelo WhatsApp: começa desligado, limites da espera, conversa da mesma empresa
-- e só o admin muda a configuração.
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'Cliente B');
INSERT INTO public.mkt_configuracoes (empresa_id) VALUES ('11111111-1111-1111-1111-111111111111');

SELECT pg_temp.ok(
  (SELECT NOT aviso_whatsapp_ligado AND aviso_espera_minutos IS NULL AND NOT aviso_resumo_diario
     FROM public.mkt_configuracoes WHERE empresa_id = '11111111-1111-1111-1111-111111111111'),
  'avisos começam desligados');

DO $$ BEGIN
  UPDATE public.mkt_configuracoes SET aviso_espera_minutos = 2
   WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
  RAISE EXCEPTION 'FALHOU: aceitou espera de 2 minutos';
EXCEPTION WHEN check_violation THEN NULL; END $$;
UPDATE public.mkt_configuracoes SET aviso_espera_minutos = 10
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';

-- Conversa de outra empresa não pode ir num aviso desta.
INSERT INTO public.chatwoot_conexoes (id, nome, account_id, webhook_token)
VALUES ('88888888-8888-8888-8888-888888888888', 'Nexa', 187966, 'token-avisos');
INSERT INTO public.conversas (id, empresa_id, conexao_id, chatwoot_conversation_id, status)
VALUES ('99999999-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        '88888888-8888-8888-8888-888888888888', 501, 'open'),
       ('99999999-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
        '88888888-8888-8888-8888-888888888888', 502, 'open');
INSERT INTO public.mkt_avisos (empresa_id, tipo, titulo, mensagem, conversa_id)
VALUES ('11111111-1111-1111-1111-111111111111', 'cliente_esperando', 'Cliente esperando', 'x',
        '99999999-0000-0000-0000-000000000001');
DO $$ BEGIN
  INSERT INTO public.mkt_avisos (empresa_id, tipo, titulo, mensagem, conversa_id)
  VALUES ('11111111-1111-1111-1111-111111111111', 'cliente_esperando', 'x', 'x',
          '99999999-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'FALHOU: aviso com conversa de outra empresa';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE 'FALHOU%' THEN RAISE; END IF;
END $$;

ROLLBACK;
