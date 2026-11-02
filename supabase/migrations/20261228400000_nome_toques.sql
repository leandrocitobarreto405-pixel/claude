-- Nome certo nos toques (02/11/2026): o primeiro nome usado nas mensagens de campanha e lembretes
-- (mkt_contatos.primeiro_nome, variável {{1}} dos modelos) não pode ser abreviação ou palavra de
-- empresa/condomínio ("Cond", "Residencial", "Loja", "Clínica"…). Sem nome de pessoa, o contato
-- recebe a variante "_sn" do modelo (sem nome), como já acontecia para "Cliente", "Sr" etc.
CREATE OR REPLACE FUNCTION private.mkt_primeiro_nome(_nome text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN w ~ '^[a-zà-öø-ÿ][a-zà-öø-ÿ''-]{1,19}$'
     AND w ~ '[aeiouyáéíóúâêôãõ]'
     AND w NOT IN ('cliente', 'sr', 'sra', 'srta', 'dona', 'dr', 'dra', 'seu', 'senhor', 'senhora',
                   'whatsapp', 'contato', 'teste', 'nao', 'não', 'sem', 'nome', 'turbine', 'clean', 'nexa',
                   'casa', 'loja', 'empresa', 'amor', 'mae', 'mãe', 'pai', 'vo', 'vó', 'tia', 'tio',
                   'cond', 'condominio', 'condomínio', 'residencial', 'edificio', 'edifício', 'ed', 'bloco',
                   'apto', 'apartamento', 'predio', 'prédio', 'torre', 'portaria', 'sindico', 'síndico',
                   'sindica', 'síndica', 'ltda', 'me', 'mei', 'eireli', 'hotel', 'pousada', 'clinica',
                   'clínica', 'escritorio', 'escritório', 'igreja', 'academia', 'escola', 'colegio', 'colégio',
                   'hospital', 'imobiliaria', 'imobiliária', 'construtora', 'administradora', 'consultorio',
                   'consultório', 'restaurante', 'bar', 'salao', 'salão', 'studio', 'estudio', 'estúdio',
                   'lead', 'novo', 'nova', 'amigo', 'amiga', 'oi', 'ola', 'olá', 'bom', 'boa')
    THEN initcap(w)
  END
  FROM (SELECT lower(split_part(btrim(regexp_replace(coalesce(_nome, ''), '\s+', ' ', 'g')), ' ', 1)) AS w) s;
$$;
REVOKE ALL ON FUNCTION private.mkt_primeiro_nome(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.mkt_primeiro_nome(text) TO service_role;

-- Recalcula só os contatos cujo primeiro nome muda com a regra nova (vira NULL = sem nome).
UPDATE public.mkt_contatos
   SET primeiro_nome = private.mkt_primeiro_nome(nome)
 WHERE primeiro_nome IS DISTINCT FROM private.mkt_primeiro_nome(nome);
