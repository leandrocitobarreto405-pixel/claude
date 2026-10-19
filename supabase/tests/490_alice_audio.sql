-- Alice em áudio: tudo começa desligado, limites com os padrões aprovados, voz só Chirp 3 HD,
-- ativar exige voz, conversa sem marca de "só texto", uso com RLS por empresa. Dados fictícios.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set A '11111111-1111-1111-1111-111111111111'
\set B '49000000-0000-0000-0000-00000000000b'
INSERT INTO public.empresas (id, nome) VALUES (:'B', 'Empresa Fictícia Áudio');
INSERT INTO public.ia_configuracoes (empresa_id) VALUES (:'B');

-- 1) padrões: desligado, sem voz, 350 caracteres, 25 s, R$ 5,00, US$ 1 = R$ 5,50
SELECT pg_temp.ok(
  (SELECT NOT audio_ativo AND audio_voz IS NULL AND audio_max_caracteres = 350
      AND audio_max_segundos = 25 AND audio_limite_diario_reais = 5.00 AND audio_cotacao_dolar = 5.50
     FROM public.ia_configuracoes WHERE empresa_id = :'B'),
  'padrões do áudio');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.ia_configuracoes WHERE audio_ativo),
  'nenhuma empresa com áudio ligado');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.conversas WHERE alice_so_texto_em IS NOT NULL),
  'nenhuma conversa marcada como só texto');

-- 2) ativar sem voz é recusado; voz fora do padrão é recusada
DO $$ BEGIN
  UPDATE public.ia_configuracoes SET audio_ativo = true
   WHERE empresa_id = '49000000-0000-0000-0000-00000000000b';
  RAISE EXCEPTION 'FALHOU: ativou sem voz';
EXCEPTION WHEN check_violation THEN NULL; END $$;
DO $$ BEGIN
  UPDATE public.ia_configuracoes SET audio_voz = 'en-US-Standard-A'
   WHERE empresa_id = '49000000-0000-0000-0000-00000000000b';
  RAISE EXCEPTION 'FALHOU: aceitou voz fora do padrão';
EXCEPTION WHEN check_violation THEN NULL; END $$;
UPDATE public.ia_configuracoes SET audio_voz = 'pt-BR-Chirp3-HD-Kore', audio_ativo = true
 WHERE empresa_id = :'B';
SELECT pg_temp.ok((SELECT audio_ativo FROM public.ia_configuracoes WHERE empresa_id = :'B'),
  'ativa com voz Chirp 3 HD');

-- 3) uso: situação válida, leitura só da própria empresa
INSERT INTO public.ia_audios_uso (empresa_id, voz, situacao, caracteres, custo_reais, texto_falado)
VALUES (:'B', 'pt-BR-Chirp3-HD-Kore', 'enviado', 70, 0.0116, 'Frase fictícia.');
DO $$ BEGIN
  INSERT INTO public.ia_audios_uso (empresa_id, voz, situacao)
  VALUES ('49000000-0000-0000-0000-00000000000b', 'pt-BR-Chirp3-HD-Kore', 'outra');
  RAISE EXCEPTION 'FALHOU: situação inválida entrou';
EXCEPTION WHEN check_violation THEN NULL; END $$;
SELECT pg_temp.ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.ia_audios_uso'::regclass),
  'RLS ligado em ia_audios_uso');
SELECT pg_temp.ok(
  NOT has_table_privilege('authenticated', 'public.ia_audios_uso', 'INSERT'),
  'authenticated não grava uso');
SELECT pg_temp.ok(
  NOT has_table_privilege('anon', 'public.ia_audios_uso', 'SELECT'),
  'anon não lê uso');

ROLLBACK;
\echo '490 áudio da Alice: ok'
