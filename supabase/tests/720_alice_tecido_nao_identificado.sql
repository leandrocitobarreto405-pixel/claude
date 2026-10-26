-- Tecido não identificado (migração 20261216120000): padrão "equipe" (como hoje, inclusive no Modelo
-- Nexa e em empresa nova), só aceita equipe/A/B/C. Dados fictícios.
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

INSERT INTO public.ia_configuracoes (empresa_id, ativo, nome, instrucoes, perguntas_frequentes)
VALUES ('99999999-9999-4999-8999-999999999999', false, 'Alice', 'roteiro', '')
ON CONFLICT (empresa_id) DO NOTHING;

SELECT pg_temp.ok((SELECT tecido_nao_identificado = 'equipe' FROM public.ia_configuracoes
                    WHERE empresa_id = '99999999-9999-4999-8999-999999999999'),
                  'modelo começa passando para a equipe');

UPDATE public.ia_configuracoes SET tecido_nao_identificado = 'B'
 WHERE empresa_id = '99999999-9999-4999-8999-999999999999';
SELECT pg_temp.ok((SELECT tecido_nao_identificado = 'B' FROM public.ia_configuracoes
                    WHERE empresa_id = '99999999-9999-4999-8999-999999999999'), 'aceita B');

SELECT pg_temp.deve_falhar(
  $$UPDATE public.ia_configuracoes SET tecido_nao_identificado = 'D'
     WHERE empresa_id = '99999999-9999-4999-8999-999999999999'$$, 'classe que não existe');
SELECT pg_temp.deve_falhar(
  $$UPDATE public.ia_configuracoes SET tecido_nao_identificado = NULL
     WHERE empresa_id = '99999999-9999-4999-8999-999999999999'$$, 'vazio');

ROLLBACK;
