-- Leads do site à prova de linha apagada ou inserida na planilha: cada cadastro passa a ser
-- identificado por data/hora + telefone (chave), não pelo número da linha. A leitura confere a
-- aba inteira e só grava o que ainda não existe. Cadastro cujo nome começa com "teste" é ignorado.
-- Só acrescenta; a única restrição trocada é a da linha (que muda quando alguém apaga linhas).

ALTER TABLE public.leads_site ADD COLUMN IF NOT EXISTS chave text;
-- Cadastros apagados do app (ex.: testes): a leitura não traz de volta.
ALTER TABLE public.leads_site_planilhas
  ADD COLUMN IF NOT EXISTS chaves_ignoradas text[] NOT NULL DEFAULT '{}';

-- Chave dos cadastros já lidos: data e hora de São Paulo + dígitos do telefone digitado (sem
-- telefone, o nome). Igual à que o servidor calcula.
UPDATE public.leads_site s
   SET chave = x.chave || CASE WHEN x.n > 1 THEN '#' || x.linha ELSE '' END
  FROM (
    SELECT id, linha, c AS chave, row_number() OVER (PARTITION BY planilha_id, c ORDER BY linha) AS n
      FROM (
        SELECT id, linha, planilha_id,
               to_char(cadastrado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS') || '|' ||
               coalesce(nullif(regexp_replace(coalesce(telefone_digitado, ''), '\D', '', 'g'), ''),
                        'nome:' || coalesce(nome, '')) AS c
          FROM public.leads_site
      ) b
  ) x
 WHERE s.id = x.id AND s.chave IS NULL;

ALTER TABLE public.leads_site ALTER COLUMN chave SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS leads_site_planilha_chave ON public.leads_site (planilha_id, chave);
-- O número da linha fica só como referência (muda quando apagam ou inserem linhas).
ALTER TABLE public.leads_site DROP CONSTRAINT IF EXISTS leads_site_planilha_id_linha_key;

-- Grava os cadastros da aba que ainda não existem (pela chave). O servidor manda a aba inteira a
-- cada leitura; linha apagada, inserida no meio ou aba encurtada não fazem perder nem duplicar.
CREATE OR REPLACE FUNCTION public.leads_site_registrar(_planilha uuid, _linhas jsonb, _ultima int)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.leads_site_planilhas;
  r record;
  primeiro uuid;
  novos int := 0;
  repetidos int := 0;
BEGIN
  SELECT * INTO p FROM public.leads_site_planilhas WHERE id = _planilha FOR UPDATE;
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'planilha não encontrada';
  END IF;
  FOR r IN
    SELECT t.*, k.chave_final FROM jsonb_to_recordset(coalesce(_linhas, '[]')) AS t(
      linha int, chave text, cadastrado_em timestamptz, nome text, telefone_digitado text,
      telefone text, servico text, utm_source text, utm_medium text, utm_campaign text,
      utm_term text, utm_content text, gclid text, gbraid text, wbraid text, fbclid text,
      pagina text)
    CROSS JOIN LATERAL (
      SELECT coalesce(nullif(t.chave, ''),
        to_char(t.cadastrado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI:SS') || '|' ||
        coalesce(nullif(regexp_replace(coalesce(t.telefone_digitado, ''), '\D', '', 'g'), ''),
                 'nome:' || coalesce(t.nome, ''))) AS chave_final
    ) k
     WHERE coalesce(t.nome, '') !~* '^\s*teste'
       AND NOT (k.chave_final = ANY (p.chaves_ignoradas))
       AND NOT EXISTS (SELECT 1 FROM public.leads_site s
                        WHERE s.planilha_id = p.id AND s.chave = k.chave_final)
     ORDER BY t.cadastrado_em, t.linha
  LOOP
    primeiro := NULL;
    IF r.telefone IS NOT NULL THEN
      SELECT s.id INTO primeiro FROM public.leads_site s
       WHERE s.empresa_id = p.empresa_id AND s.repetido_de IS NULL
         AND private.telefone_chave(s.telefone) = private.telefone_chave(r.telefone)
         AND s.cadastrado_em BETWEEN r.cadastrado_em - interval '30 minutes' AND r.cadastrado_em
       ORDER BY s.cadastrado_em LIMIT 1;
    END IF;
    INSERT INTO public.leads_site (empresa_id, planilha_id, linha, chave, lp, cadastrado_em, nome,
      telefone_digitado, telefone, servico, utm_source, utm_medium, utm_campaign, utm_term,
      utm_content, gclid, gbraid, wbraid, fbclid, pagina, situacao, repetido_de)
    VALUES (p.empresa_id, p.id, r.linha, r.chave_final, p.nome, r.cadastrado_em, left(r.nome, 120),
      left(r.telefone_digitado, 40), r.telefone, left(r.servico, 120), left(r.utm_source, 300),
      left(r.utm_medium, 300), left(r.utm_campaign, 300), left(r.utm_term, 300),
      left(r.utm_content, 300), left(r.gclid, 300), left(r.gbraid, 300), left(r.wbraid, 300),
      left(r.fbclid, 300), left(r.pagina, 2000),
      CASE WHEN r.telefone IS NULL THEN 'invalido' ELSE 'nao_chamou' END, primeiro)
    ON CONFLICT (planilha_id, chave) DO NOTHING;
    IF FOUND THEN
      novos := novos + 1;
      IF primeiro IS NOT NULL THEN repetidos := repetidos + 1; END IF;
    END IF;
  END LOOP;
  -- Quantas linhas a aba tem agora (pode diminuir quando apagam linhas).
  UPDATE public.leads_site_planilhas
     SET ultima_linha = greatest(1, coalesce(_ultima, ultima_linha)), lido_em = now(),
         erro = NULL, erro_em = NULL, updated_at = now()
   WHERE id = p.id;
  RETURN jsonb_build_object('novos', novos, 'repetidos', repetidos);
END $$;
REVOKE ALL ON FUNCTION public.leads_site_registrar(uuid, jsonb, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.leads_site_registrar(uuid, jsonb, int) TO service_role;
