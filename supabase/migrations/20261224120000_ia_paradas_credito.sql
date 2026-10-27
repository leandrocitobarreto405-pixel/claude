-- Alarme de crédito da IA (27/10/2026, para todas as empresas). De 12 a 19/10 a conta da IA ficou sem
-- crédito e 65 respostas foram para a equipe sem nenhum aviso.
-- 1. ia_paradas: um período por empresa e provedor (IA ou voz) enquanto a conta recusar por falta de
--    crédito ou chave recusada. Abre no primeiro erro, fecha na primeira resposta que der certo
--    (de qualquer empresa: a conta é a mesma). Guarda as conversas que foram para a equipe por isso.
-- 2. Na abertura (só IA), aviso no sininho da empresa: "A Alice está pausada; as conversas estão indo
--    para a equipe". Ao fechar, "A Alice voltou a responder".
-- 3. Aviso à Nexa (push para nexa_admin): no primeiro erro e de novo a cada 2 horas enquanto durar
--    (a função diz quando avisar; quem envia é o app).
-- Só tabela e funções novas; nada existente muda.

CREATE TABLE IF NOT EXISTS public.ia_paradas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  provedor text NOT NULL CHECK (provedor IN ('ia', 'voz')),
  causa text NOT NULL CHECK (causa IN ('credito', 'autenticacao')),
  inicio timestamptz NOT NULL DEFAULT now(),
  ultimo_erro_em timestamptz NOT NULL DEFAULT now(),
  fim timestamptz,
  erros integer NOT NULL DEFAULT 1,
  conversas uuid[] NOT NULL DEFAULT '{}',
  avisado_nexa_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ia_paradas_aberta ON public.ia_paradas (empresa_id, provedor) WHERE fim IS NULL;
CREATE INDEX IF NOT EXISTS idx_ia_paradas_empresa ON public.ia_paradas (empresa_id, inicio DESC);
ALTER TABLE public.ia_paradas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ia_paradas FROM anon, authenticated;
GRANT SELECT ON public.ia_paradas TO authenticated;
GRANT ALL ON public.ia_paradas TO service_role;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ia_paradas' AND policyname = 'ia_paradas_select') THEN
    CREATE POLICY ia_paradas_select ON public.ia_paradas FOR SELECT TO authenticated
      USING (empresa_id = (SELECT private.empresa_ativa()) OR (SELECT private.is_nexa_admin()));
  END IF;
END $p$;

-- Erro de crédito/chave numa resposta: abre (ou soma no) período da empresa e diz se é hora de avisar
-- a Nexa (nenhum aviso deste provedor nas últimas 2 horas). "desde" = início do período aberto mais
-- antigo do provedor (em qualquer empresa).
CREATE OR REPLACE FUNCTION public.ia_registrar_parada(_emp uuid, _provedor text, _causa text, _conversa uuid DEFAULT NULL)
RETURNS TABLE (parada_id uuid, nova boolean, desde timestamptz, avisar_nexa boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p public.ia_paradas;
  e_nova boolean := false;
  avisar boolean;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ia_paradas:' || _provedor));
  SELECT * INTO p FROM public.ia_paradas WHERE empresa_id = _emp AND provedor = _provedor AND fim IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.ia_paradas (empresa_id, provedor, causa, conversas)
    VALUES (_emp, _provedor, _causa, CASE WHEN _conversa IS NULL THEN '{}'::uuid[] ELSE ARRAY[_conversa] END)
    RETURNING * INTO p;
    e_nova := true;
    IF _provedor = 'ia' THEN
      INSERT INTO public.mkt_avisos (empresa_id, tipo, titulo, mensagem, so_no_app, referencia)
      VALUES (_emp, 'alice_pausada', 'A Alice está pausada',
              'A Alice está pausada; as conversas estão indo para a equipe.', true, 'ia-parada:' || p.id)
      ON CONFLICT (empresa_id, tipo, referencia) WHERE referencia IS NOT NULL DO NOTHING;
    END IF;
  ELSE
    UPDATE public.ia_paradas
       SET erros = erros + 1, ultimo_erro_em = now(), causa = _causa,
           conversas = CASE WHEN _conversa IS NULL OR _conversa = ANY (conversas) THEN conversas
                            ELSE conversas || _conversa END
     WHERE id = p.id;
  END IF;
  avisar := NOT EXISTS (SELECT 1 FROM public.ia_paradas
                         WHERE provedor = _provedor AND fim IS NULL AND avisado_nexa_em > now() - interval '2 hours');
  IF avisar THEN
    UPDATE public.ia_paradas SET avisado_nexa_em = now() WHERE id = p.id;
  END IF;
  RETURN QUERY SELECT p.id, e_nova,
    (SELECT min(x.inicio) FROM public.ia_paradas x WHERE x.provedor = _provedor AND x.fim IS NULL), avisar;
END $$;
REVOKE ALL ON FUNCTION public.ia_registrar_parada(uuid, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_registrar_parada(uuid, text, text, uuid) TO service_role;

-- Resposta que deu certo (ou teste da conta que passou): fecha os períodos abertos do provedor em
-- todas as empresas e avisa cada empresa (IA) que a Alice voltou. Devolve o que fechou.
CREATE OR REPLACE FUNCTION public.ia_encerrar_paradas(_provedor text)
RETURNS TABLE (empresa_id uuid, inicio timestamptz, fim timestamptz, conversas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
DECLARE r record;
BEGIN
  FOR r IN UPDATE public.ia_paradas p SET fim = now()
            WHERE p.provedor = _provedor AND p.fim IS NULL
        RETURNING p.id, p.empresa_id, p.inicio, p.fim, cardinality(p.conversas) AS n
  LOOP
    IF _provedor = 'ia' THEN
      INSERT INTO public.mkt_avisos (empresa_id, tipo, titulo, mensagem, so_no_app, referencia)
      VALUES (r.empresa_id, 'alice_voltou', 'A Alice voltou a responder',
              format('A Alice voltou a responder. Enquanto estava pausada, %s conversa(s) foram para a equipe.', r.n),
              true, 'ia-volta:' || r.id)
      ON CONFLICT (empresa_id, tipo, referencia) WHERE referencia IS NOT NULL DO NOTHING;
    END IF;
    empresa_id := r.empresa_id; inicio := r.inicio; fim := r.fim; conversas := r.n;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.ia_encerrar_paradas(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_encerrar_paradas(text) TO service_role;

-- Repetição de 2 em 2 horas (rotina de cada minuto): marca o aviso se já passou o tempo.
CREATE OR REPLACE FUNCTION public.ia_parada_hora_de_avisar(_provedor text)
RETURNS TABLE (desde timestamptz, causa text, empresas integer, conversas integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
#variable_conflict use_column
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ia_paradas:' || _provedor));
  IF NOT EXISTS (SELECT 1 FROM public.ia_paradas WHERE provedor = _provedor AND fim IS NULL)
     OR EXISTS (SELECT 1 FROM public.ia_paradas WHERE provedor = _provedor AND fim IS NULL
                   AND avisado_nexa_em > now() - interval '2 hours') THEN
    RETURN;
  END IF;
  UPDATE public.ia_paradas SET avisado_nexa_em = now()
   WHERE id = (SELECT id FROM public.ia_paradas WHERE provedor = _provedor AND fim IS NULL
                ORDER BY inicio LIMIT 1);
  RETURN QUERY
    SELECT min(p.inicio), (array_agg(p.causa ORDER BY p.ultimo_erro_em DESC))[1],
           count(*)::integer, coalesce(sum(cardinality(p.conversas)), 0)::integer
      FROM public.ia_paradas p WHERE p.provedor = _provedor AND p.fim IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.ia_parada_hora_de_avisar(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ia_parada_hora_de_avisar(text) TO service_role;

-- Trava de somente leitura (toda tabela nova com empresa_id).
SELECT private.instalar_travas_somente_leitura();
