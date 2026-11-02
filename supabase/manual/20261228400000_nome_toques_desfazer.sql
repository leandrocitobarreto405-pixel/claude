-- Desfaz a migração 20261228400000_nome_toques (só com OK do usuário): volta a regra anterior do
-- primeiro nome das campanhas e recalcula os contatos.
CREATE OR REPLACE FUNCTION private.mkt_primeiro_nome(_nome text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN w ~ '^[a-zà-öø-ÿ][a-zà-öø-ÿ''-]{1,19}$'
     AND w NOT IN ('cliente', 'sr', 'sra', 'srta', 'dona', 'dr', 'dra', 'seu', 'senhor', 'senhora',
                   'whatsapp', 'contato', 'teste', 'nao', 'não', 'sem', 'nome', 'turbine', 'clean',
                   'casa', 'loja', 'empresa', 'amor', 'mae', 'mãe', 'pai', 'vo', 'vó', 'tia', 'tio')
    THEN initcap(w)
  END
  FROM (SELECT lower(split_part(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), ' ', 1)) AS w) s;
$$;
UPDATE public.mkt_contatos
   SET primeiro_nome = private.mkt_primeiro_nome(nome)
 WHERE primeiro_nome IS DISTINCT FROM private.mkt_primeiro_nome(nome);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228400000';
