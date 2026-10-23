-- Faturas do Asaas (migração 20261207120000): nenhuma fatura sem valor nem para assinatura sem
-- mensalidade; aviso repetido do Asaas conta uma vez; vencida → inadimplente (carência no portão);
-- pagamento → paga e volta a ativa; quem lê. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
CREATE FUNCTION pg_temp.deve_falhar(_sql text, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'FALHOU (deveria ter sido bloqueado): %', _msg;
END $$;
CREATE FUNCTION pg_temp.como(_email text, _empresa uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
           json_build_object('sub', (SELECT id FROM auth.users WHERE email = _email), 'role', 'authenticated')::text, false),
         set_config('request.headers',
           CASE WHEN _empresa IS NULL THEN '{}' ELSE json_build_object('x-empresa-id', _empresa)::text END, false);
$$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated;

\set P '63000000-0000-0000-0000-00000000000a'
\set G '63000000-0000-0000-0000-00000000000b'
\set O '63000000-0000-0000-0000-00000000000c'
INSERT INTO public.empresas (id, nome) VALUES
  (:'P', 'Fictícia Paga 630'), (:'G', 'Fictícia Gestão 630'), (:'O', 'Fictícia Outra 630');
INSERT INTO public.assinaturas (id, empresa_id, plano_id, status, vigencia_inicio)
SELECT '63000000-0000-0000-0000-0000000000a1', :'P', id, 'ativa', private.hoje_sp() - 60
  FROM public.planos WHERE codigo = 'basico';
INSERT INTO public.assinaturas (id, empresa_id, plano_id, status, vigencia_inicio, gratis_ate)
SELECT '63000000-0000-0000-0000-0000000000b1', :'G', id, 'trial', private.hoje_sp() - 60, private.hoje_sp() - 1
  FROM public.planos WHERE codigo = 'nexa_gestao';
INSERT INTO public.assinaturas (id, empresa_id, plano_id, valor_mensal, status, vigencia_inicio)
SELECT '63000000-0000-0000-0000-0000000000c1', :'O', id, 0, 'ativa', private.hoje_sp() - 60
  FROM public.planos WHERE codigo = 'completo';

-- Nenhuma fatura sem valor, nem para assinatura sem mensalidade (vazia ou R$ 0), nem de outra empresa.
SELECT pg_temp.deve_falhar($$INSERT INTO public.faturas (empresa_id, assinatura_id, competencia, valor, vencimento)
  VALUES ('63000000-0000-0000-0000-00000000000a', '63000000-0000-0000-0000-0000000000a1', '2026-11-01', 0, '2026-11-10')$$,
  'fatura de R$ 0');
SELECT pg_temp.deve_falhar($$INSERT INTO public.faturas (empresa_id, assinatura_id, competencia, valor, vencimento)
  VALUES ('63000000-0000-0000-0000-00000000000a', '63000000-0000-0000-0000-0000000000a1', '2026-11-01', NULL, '2026-11-10')$$,
  'fatura sem valor');
SELECT pg_temp.deve_falhar($$INSERT INTO public.faturas (empresa_id, assinatura_id, competencia, valor, vencimento)
  VALUES ('63000000-0000-0000-0000-00000000000b', '63000000-0000-0000-0000-0000000000b1', '2026-11-01', 100, '2026-11-10')$$,
  'fatura com mensalidade a definir');
SELECT pg_temp.deve_falhar($$INSERT INTO public.faturas (empresa_id, assinatura_id, competencia, valor, vencimento)
  VALUES ('63000000-0000-0000-0000-00000000000c', '63000000-0000-0000-0000-0000000000c1', '2026-11-01', 100, '2026-11-10')$$,
  'fatura com mensalidade R$ 0');
SELECT pg_temp.deve_falhar($$INSERT INTO public.faturas (empresa_id, assinatura_id, competencia, valor, vencimento)
  VALUES ('63000000-0000-0000-0000-00000000000c', '63000000-0000-0000-0000-0000000000a1', '2026-11-01', 50, '2026-11-10')$$,
  'fatura de outra empresa');

-- Fatura válida (R$ 50) e uma só por mês.
INSERT INTO public.faturas (id, empresa_id, assinatura_id, competencia, valor, vencimento, gateway_cobranca_id)
VALUES ('63000000-0000-0000-0000-0000000000f1', :'P', '63000000-0000-0000-0000-0000000000a1',
        date_trunc('month', private.hoje_sp())::date, 50, private.hoje_sp() - 10, 'pay_ficticio_630');
SELECT pg_temp.deve_falhar($$INSERT INTO public.faturas (empresa_id, assinatura_id, competencia, valor, vencimento)
  VALUES ('63000000-0000-0000-0000-00000000000a', '63000000-0000-0000-0000-0000000000a1',
          date_trunc('month', private.hoje_sp())::date, 50, private.hoje_sp())$$, 'duas faturas no mesmo mês');

-- Venceu: fatura vencida e assinatura inadimplente desde o vencimento (10 dias → somente leitura).
SELECT pg_temp.ok(public.registrar_evento_pagamento('evt_630_1', 'PAYMENT_OVERDUE', 'pay_ficticio_630',
  '{"payment": {"id": "pay_ficticio_630", "billingType": "BOLETO"}}')->>'resultado' = 'processado', 'vencida processada');
SELECT pg_temp.ok((SELECT status = 'vencida' AND forma = 'boleto' FROM public.faturas WHERE id = '63000000-0000-0000-0000-0000000000f1'),
  'fatura vencida');
SELECT pg_temp.ok((SELECT status = 'inadimplente' AND inadimplente_desde = private.hoje_sp() - 10
                     FROM public.assinaturas WHERE id = '63000000-0000-0000-0000-0000000000a1'), 'inadimplente desde o vencimento');
SELECT pg_temp.ok(private.empresa_situacao(:'P') = 'somente_leitura', 'portão aplica a carência');

-- O mesmo aviso de novo não faz nada.
SELECT pg_temp.ok(public.registrar_evento_pagamento('evt_630_1', 'PAYMENT_OVERDUE', 'pay_ficticio_630', '{}')->>'resultado' = 'duplicado',
  'aviso repetido');
SELECT pg_temp.ok((SELECT count(*) FROM public.pagamentos_eventos WHERE evento_id = 'evt_630_1') = 1, 'guardado uma vez');

-- Pagou: fatura paga e assinatura volta a ativa.
SELECT pg_temp.ok(public.registrar_evento_pagamento('evt_630_2', 'PAYMENT_RECEIVED', 'pay_ficticio_630',
  '{"payment": {"id": "pay_ficticio_630", "value": 50, "billingType": "PIX", "paymentDate": "2026-10-20"}}')->>'resultado' = 'processado',
  'pagamento processado');
SELECT pg_temp.ok((SELECT status = 'paga' AND pago_em = '2026-10-20' AND valor_pago = 50 AND forma = 'pix'
                     FROM public.faturas WHERE id = '63000000-0000-0000-0000-0000000000f1'), 'fatura paga');
SELECT pg_temp.ok((SELECT status = 'ativa' AND inadimplente_desde IS NULL
                     FROM public.assinaturas WHERE id = '63000000-0000-0000-0000-0000000000a1'), 'volta a ativa');
SELECT pg_temp.ok(private.empresa_situacao(:'P') = 'ok', 'empresa ok');

-- Aviso atrasado de vencida não desfaz o pagamento; cobrança que não é nossa fica registrada.
SELECT pg_temp.ok(public.registrar_evento_pagamento('evt_630_3', 'PAYMENT_OVERDUE', 'pay_ficticio_630', '{}')->>'resultado' = 'ignorado',
  'vencida depois de paga');
SELECT pg_temp.ok((SELECT status FROM public.faturas WHERE id = '63000000-0000-0000-0000-0000000000f1') = 'paga', 'continua paga');
SELECT pg_temp.ok(public.registrar_evento_pagamento('evt_630_4', 'PAYMENT_RECEIVED', 'pay_de_fora', '{}')->>'resultado' = 'sem_fatura',
  'cobrança desconhecida');
SELECT pg_temp.deve_falhar($$SELECT public.registrar_evento_pagamento('', 'PAYMENT_RECEIVED', 'x', '{}')$$, 'evento sem id');

-- Quem lê: admin da empresa vê a fatura dela; outra empresa não; eventos só a Nexa; ninguém da tela grava.
INSERT INTO auth.users (email) VALUES ('admin630@p.test'), ('admin630@o.test'), ('nexa630@nexa.test');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'P', 'admin' FROM auth.users WHERE email = 'admin630@p.test';
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
SELECT id, :'O', 'admin' FROM auth.users WHERE email = 'admin630@o.test';
INSERT INTO public.plataforma_usuarios (user_id, papel)
SELECT id, 'nexa_admin' FROM auth.users WHERE email = 'nexa630@nexa.test';
SELECT pg_temp.como('admin630@p.test', :'P');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.faturas) = 1, 'admin vê a fatura da empresa');
SELECT pg_temp.ok((SELECT count(*) FROM public.pagamentos_eventos) = 0, 'admin não vê os eventos');
SELECT pg_temp.deve_falhar($$UPDATE public.faturas SET status = 'paga'$$, 'tela não altera fatura');
SELECT pg_temp.deve_falhar($$SELECT public.registrar_evento_pagamento('evt_x', 'PAYMENT_RECEIVED', 'pay_ficticio_630', '{}')$$,
  'tela não registra evento');
RESET ROLE;
SELECT pg_temp.como('admin630@o.test', :'O');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.faturas) = 0, 'outra empresa não vê');
RESET ROLE;
SELECT pg_temp.como('nexa630@nexa.test');
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT count(*) FROM public.pagamentos_eventos WHERE evento_id LIKE 'evt_630_%') = 4, 'Nexa vê os eventos');
RESET ROLE;

-- E-mail de cobrança nasce desligado.
SELECT pg_temp.ok((SELECT valor = 'false'::jsonb FROM public.configuracoes_plataforma WHERE chave = 'cobranca_emails_ativo'),
  'e-mail desligado');
ROLLBACK;
