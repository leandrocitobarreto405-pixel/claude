-- Franquia da Alice (decisão de 26/10/2026).
-- 1. Conversa = conversa em que a Alice mandou pelo menos uma mensagem no mês (mês de São Paulo).
--    alice_uso_mensal guarda uma linha por empresa, mês e conversa (custo somado de cada resposta).
-- 2. Plano: conversas incluídas (150), preço da conversa excedente (R$ 3,50 no Profissional + Alice)
--    e se trava (só o Profissional + Alice; Interna e Nexa Gestão só medem).
-- 3. Na franquia: a Alice para e a conversa nova vai para a equipe; com "continuar depois da
--    franquia", segue até o teto mensal em R$ da empresa. Excedente só calculado (nada é cobrado).
-- 4. Conversa que passar de R$ 5 de IA vai para a equipe (só em plano que trava). Cotação do dólar
--    fixa (5,65), editável pela Nexa.
-- 5. Avisos no sininho (só no app, para a equipe) em 80% e 100% e no teto em R$.

ALTER TABLE public.planos
  ADD COLUMN IF NOT EXISTS alice_conversas_incluidas integer CHECK (alice_conversas_incluidas IS NULL OR alice_conversas_incluidas >= 1),
  ADD COLUMN IF NOT EXISTS alice_preco_excedente numeric(10,2) CHECK (alice_preco_excedente IS NULL OR alice_preco_excedente >= 0),
  ADD COLUMN IF NOT EXISTS alice_trava_franquia boolean NOT NULL DEFAULT false;
UPDATE public.planos SET alice_conversas_incluidas = 150, alice_preco_excedente = 3.50, alice_trava_franquia = true
 WHERE codigo = 'profissional_alice';
UPDATE public.planos SET alice_conversas_incluidas = 150, alice_preco_excedente = NULL, alice_trava_franquia = false
 WHERE codigo IN ('nexa_gestao', 'interna');

ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS continuar_apos_franquia boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS teto_excedente_reais numeric(10,2) CHECK (teto_excedente_reais IS NULL OR teto_excedente_reais >= 0);

INSERT INTO public.configuracoes_plataforma (chave, valor, descricao) VALUES
  ('alice_cotacao_dolar', '5.65', 'Cotação do dólar para o custo da Alice em reais (revise a cada 30 dias)'),
  ('alice_teto_custo_conversa_reais', '5', 'Conversa da Alice que passar deste custo (R$) vai para a equipe (só no Profissional + Alice)')
ON CONFLICT (chave) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.alice_uso_mensal (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  mes date NOT NULL,
  conversa_id uuid NOT NULL,
  primeira_resposta_em timestamptz,
  ultima_resposta_em timestamptz,
  respostas integer NOT NULL DEFAULT 0,
  custo_usd numeric(12,6) NOT NULL DEFAULT 0,
  excedente boolean NOT NULL DEFAULT false,
  para_equipe_em timestamptz,
  para_equipe_motivo text,
  PRIMARY KEY (empresa_id, mes, conversa_id)
);
CREATE INDEX IF NOT EXISTS idx_alice_uso_mensal_caras ON public.alice_uso_mensal (mes, custo_usd DESC);
ALTER TABLE public.alice_uso_mensal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alice_uso_mensal FROM anon, authenticated;
GRANT SELECT ON public.alice_uso_mensal TO authenticated;
GRANT ALL ON public.alice_uso_mensal TO service_role;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'alice_uso_mensal' AND policyname = 'alice_uso_mensal_select') THEN
    CREATE POLICY alice_uso_mensal_select ON public.alice_uso_mensal FOR SELECT TO authenticated
      USING (empresa_id = (SELECT private.empresa_ativa()) OR (SELECT private.is_nexa_admin()));
  END IF;
END $p$;

CREATE OR REPLACE FUNCTION private.mes_sp(_t timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT date_trunc('month', (_t AT TIME ZONE 'America/Sao_Paulo'))::date;
$$;

CREATE OR REPLACE FUNCTION private.config_numero(_chave text, _padrao numeric)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT (valor #>> '{}')::numeric FROM public.configuracoes_plataforma WHERE chave = _chave), _padrao);
$$;
REVOKE ALL ON FUNCTION private.config_numero(text, numeric) FROM PUBLIC, anon;

-- Franquia do plano vigente da empresa (sem assinatura vigente: sem franquia).
CREATE OR REPLACE FUNCTION private.alice_franquia(_emp uuid,
  OUT incluidas integer, OUT preco numeric, OUT trava boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.alice_conversas_incluidas, p.alice_preco_excedente, p.alice_trava_franquia
    FROM public.assinaturas a JOIN public.planos p ON p.id = a.plano_id
   WHERE a.empresa_id = _emp AND a.status <> 'cancelada'
     AND a.vigencia_inicio <= private.hoje_sp()
     AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= private.hoje_sp())
   ORDER BY a.vigencia_inicio DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.alice_franquia(uuid) FROM PUBLIC, anon;

-- Aviso no sininho (só no app), uma vez por mês por tipo.
CREATE OR REPLACE FUNCTION private.alice_aviso_franquia(_emp uuid, _mes date, _tipo text, _titulo text, _mensagem text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.mkt_avisos WHERE empresa_id = _emp AND tipo = _tipo
              AND created_at >= (_mes::timestamp AT TIME ZONE 'America/Sao_Paulo')) THEN
    RETURN;
  END IF;
  INSERT INTO public.mkt_avisos (empresa_id, tipo, titulo, mensagem, so_no_app)
  VALUES (_emp, _tipo, _titulo, _mensagem, true);
END $$;
REVOKE ALL ON FUNCTION private.alice_aviso_franquia(uuid, date, text, text, text) FROM PUBLIC, anon, authenticated;

-- Cada resposta da Alice soma o custo na conversa do mês; a primeira mensagem enviada conta a conversa.
CREATE OR REPLACE FUNCTION private.alice_contar_uso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m date := private.mes_sp(NEW.created_at);
  respondeu boolean;
  nova boolean := false;
  f record;
  usadas integer;
BEGIN
  IF NEW.conversa_id IS NULL THEN RETURN NEW; END IF;
  respondeu := NEW.erro IS NULL AND EXISTS (
    SELECT 1 FROM unnest(NEW.mensagens_enviadas) x WHERE x NOT LIKE '[não enviado%');
  nova := respondeu AND NOT EXISTS (
    SELECT 1 FROM public.alice_uso_mensal WHERE empresa_id = NEW.empresa_id AND mes = m
       AND conversa_id = NEW.conversa_id AND primeira_resposta_em IS NOT NULL);
  INSERT INTO public.alice_uso_mensal AS u (empresa_id, mes, conversa_id, custo_usd, respostas,
                                             primeira_resposta_em, ultima_resposta_em)
  VALUES (NEW.empresa_id, m, NEW.conversa_id, coalesce(NEW.custo_usd, 0),
          CASE WHEN respondeu THEN 1 ELSE 0 END,
          CASE WHEN respondeu THEN NEW.created_at END, CASE WHEN respondeu THEN NEW.created_at END)
  ON CONFLICT (empresa_id, mes, conversa_id) DO UPDATE
     SET custo_usd = u.custo_usd + EXCLUDED.custo_usd,
         respostas = u.respostas + EXCLUDED.respostas,
         primeira_resposta_em = coalesce(u.primeira_resposta_em, EXCLUDED.primeira_resposta_em),
         ultima_resposta_em = coalesce(EXCLUDED.ultima_resposta_em, u.ultima_resposta_em);
  -- Avisos de 80% e 100% (só em plano que trava, quando esta conversa acabou de contar).
  IF nova THEN
    SELECT * INTO f FROM private.alice_franquia(NEW.empresa_id);
    IF f.trava AND f.incluidas IS NOT NULL THEN
      SELECT count(*) INTO usadas FROM public.alice_uso_mensal
       WHERE empresa_id = NEW.empresa_id AND mes = m AND primeira_resposta_em IS NOT NULL;
      IF usadas >= f.incluidas THEN
        PERFORM private.alice_aviso_franquia(NEW.empresa_id, m, 'alice_franquia_100',
          format('Alice: %s de %s conversas este mês', usadas, f.incluidas),
          'A franquia do mês acabou. Conversas novas vão para a equipe, a não ser que "Continuar depois da franquia" esteja ligado (Configurações › Alice).');
      ELSIF usadas >= ceil(f.incluidas * 0.8) THEN
        PERFORM private.alice_aviso_franquia(NEW.empresa_id, m, 'alice_franquia_80',
          format('Alice: %s de %s conversas este mês', usadas, f.incluidas),
          'A Alice já usou 80% das conversas do mês. Ao chegar no limite, conversas novas vão para a equipe.');
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.alice_contar_uso() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_ia_execucoes_uso AFTER INSERT ON public.ia_execucoes
  FOR EACH ROW EXECUTE FUNCTION private.alice_contar_uso();

-- Antes de chamar a IA: a Alice pode responder esta conversa? (servidor, chave de serviço)
CREATE OR REPLACE FUNCTION public.alice_pode_responder(_emp uuid, _conversa uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m date := private.mes_sp(now());
  f record;
  u public.alice_uso_mensal;
  usadas integer;
  excedentes integer;
  cfg record;
  cotacao numeric := private.config_numero('alice_cotacao_dolar', 5.65);
  teto_conversa numeric := private.config_numero('alice_teto_custo_conversa_reais', 5);
  base jsonb;
BEGIN
  SELECT * INTO f FROM private.alice_franquia(_emp);
  SELECT * INTO u FROM public.alice_uso_mensal WHERE empresa_id = _emp AND mes = m AND conversa_id = _conversa;
  SELECT count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL),
         count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL AND excedente)
    INTO usadas, excedentes
    FROM public.alice_uso_mensal WHERE empresa_id = _emp AND mes = m;
  base := jsonb_build_object('usadas', usadas, 'franquia', f.incluidas, 'trava', coalesce(f.trava, false));
  IF NOT coalesce(f.trava, false) OR f.incluidas IS NULL THEN
    RETURN base || jsonb_build_object('pode', true);
  END IF;
  -- Conversa que já contou neste mês: só o teto de custo por conversa.
  IF u.primeira_resposta_em IS NOT NULL OR u.excedente THEN
    IF u.custo_usd * cotacao > teto_conversa THEN
      UPDATE public.alice_uso_mensal SET para_equipe_em = coalesce(para_equipe_em, now()), para_equipe_motivo = 'custo'
       WHERE empresa_id = _emp AND mes = m AND conversa_id = _conversa;
      RETURN base || jsonb_build_object('pode', false, 'motivo', 'custo',
        'nota', format('Esta conversa passou de R$ %s de custo da IA no mês: a Alice parou e a conversa ficou com a equipe.', teto_conversa));
    END IF;
    RETURN base || jsonb_build_object('pode', true);
  END IF;
  IF usadas < f.incluidas THEN
    RETURN base || jsonb_build_object('pode', true);
  END IF;
  SELECT continuar_apos_franquia, teto_excedente_reais INTO cfg FROM public.ia_configuracoes WHERE empresa_id = _emp;
  IF coalesce(cfg.continuar_apos_franquia, false) AND cfg.teto_excedente_reais IS NOT NULL
     AND (excedentes + 1) * coalesce(f.preco, 0) <= cfg.teto_excedente_reais THEN
    INSERT INTO public.alice_uso_mensal (empresa_id, mes, conversa_id, excedente)
    VALUES (_emp, m, _conversa, true)
    ON CONFLICT (empresa_id, mes, conversa_id) DO UPDATE SET excedente = true;
    RETURN base || jsonb_build_object('pode', true, 'excedente', true);
  END IF;
  INSERT INTO public.alice_uso_mensal AS x (empresa_id, mes, conversa_id, para_equipe_em, para_equipe_motivo)
  VALUES (_emp, m, _conversa, now(), CASE WHEN coalesce(cfg.continuar_apos_franquia, false) THEN 'teto' ELSE 'franquia' END)
  ON CONFLICT (empresa_id, mes, conversa_id) DO UPDATE
     SET para_equipe_em = coalesce(x.para_equipe_em, now()), para_equipe_motivo = EXCLUDED.para_equipe_motivo;
  IF coalesce(cfg.continuar_apos_franquia, false) THEN
    PERFORM private.alice_aviso_franquia(_emp, m, 'alice_franquia_teto',
      'Alice: teto do excedente atingido',
      format('O excedente do mês chegou ao teto de R$ %s. Conversas novas vão para a equipe até o próximo mês ou até aumentar o teto (Configurações › Alice).', cfg.teto_excedente_reais));
    RETURN base || jsonb_build_object('pode', false, 'motivo', 'teto',
      'nota', 'O excedente da Alice chegou ao teto do mês: conversa nova com a equipe.');
  END IF;
  RETURN base || jsonb_build_object('pode', false, 'motivo', 'franquia',
    'nota', format('A Alice usou as %s conversas do mês: conversa nova com a equipe.', f.incluidas));
END $$;
REVOKE ALL ON FUNCTION public.alice_pode_responder(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alice_pode_responder(uuid, uuid) TO service_role;

-- Medidor da empresa aberta: "Alice: X de 150 conversas este mês".
CREATE OR REPLACE FUNCTION public.alice_uso_do_mes()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  m date := private.mes_sp(now());
  f record;
  usadas integer;
  excedentes integer;
BEGIN
  IF emp IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO f FROM private.alice_franquia(emp);
  SELECT count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL),
         count(*) FILTER (WHERE primeira_resposta_em IS NOT NULL AND excedente)
    INTO usadas, excedentes
    FROM public.alice_uso_mensal WHERE empresa_id = emp AND mes = m;
  RETURN jsonb_build_object('mes', m, 'usadas', usadas, 'franquia', f.incluidas,
    'trava', coalesce(f.trava, false), 'preco_excedente', f.preco, 'excedentes', excedentes,
    'valor_excedente', round(excedentes * coalesce(f.preco, 0), 2));
END $$;
REVOKE ALL ON FUNCTION public.alice_uso_do_mes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alice_uso_do_mes() TO authenticated, service_role;

-- Painel Nexa › Consumo: franquia de cada empresa e as conversas mais caras do mês.
CREATE OR REPLACE FUNCTION public.alice_franquia_empresas(_mes date)
RETURNS TABLE (empresa_id uuid, conversas integer, franquia integer, trava boolean,
               excedentes integer, valor_excedente numeric, para_equipe integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Acesso restrito à Nexa' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT e.id,
         (SELECT count(*)::integer FROM public.alice_uso_mensal u WHERE u.empresa_id = e.id AND u.mes = date_trunc('month', _mes)::date AND u.primeira_resposta_em IS NOT NULL),
         f.incluidas, coalesce(f.trava, false),
         (SELECT count(*)::integer FROM public.alice_uso_mensal u WHERE u.empresa_id = e.id AND u.mes = date_trunc('month', _mes)::date AND u.primeira_resposta_em IS NOT NULL AND u.excedente),
         round((SELECT count(*) FROM public.alice_uso_mensal u WHERE u.empresa_id = e.id AND u.mes = date_trunc('month', _mes)::date AND u.primeira_resposta_em IS NOT NULL AND u.excedente) * coalesce(f.preco, 0), 2),
         (SELECT count(*)::integer FROM public.alice_uso_mensal u WHERE u.empresa_id = e.id AND u.mes = date_trunc('month', _mes)::date AND u.para_equipe_em IS NOT NULL)
    FROM public.empresas e
    LEFT JOIN LATERAL private.alice_franquia(e.id) f ON true
   WHERE e.ativo;
END $$;
REVOKE ALL ON FUNCTION public.alice_franquia_empresas(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alice_franquia_empresas(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.alice_conversas_caras(_mes date, _limite integer DEFAULT 10)
RETURNS TABLE (empresa_id uuid, empresa text, conversa_id uuid, primeira_resposta_em timestamptz,
               respostas integer, custo_usd numeric, custo_reais numeric, para_equipe_motivo text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cotacao numeric := private.config_numero('alice_cotacao_dolar', 5.65);
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Acesso restrito à Nexa' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT u.empresa_id, e.nome, u.conversa_id, u.primeira_resposta_em, u.respostas, u.custo_usd,
         round(u.custo_usd * cotacao, 2), u.para_equipe_motivo
    FROM public.alice_uso_mensal u JOIN public.empresas e ON e.id = u.empresa_id
   WHERE u.mes = date_trunc('month', _mes)::date AND NOT e.eh_teste
   ORDER BY u.custo_usd DESC
   LIMIT least(greatest(coalesce(_limite, 10), 1), 50);
END $$;
REVOKE ALL ON FUNCTION public.alice_conversas_caras(date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.alice_conversas_caras(date, integer) TO authenticated;

-- Mês corrente e o anterior a partir do que a Alice já fez (para o medidor começar certo).
INSERT INTO public.alice_uso_mensal (empresa_id, mes, conversa_id, primeira_resposta_em, ultima_resposta_em, respostas, custo_usd)
SELECT x.empresa_id, private.mes_sp(x.created_at), x.conversa_id,
       min(x.created_at) FILTER (WHERE x.erro IS NULL AND EXISTS (SELECT 1 FROM unnest(x.mensagens_enviadas) t WHERE t NOT LIKE '[não enviado%')),
       max(x.created_at) FILTER (WHERE x.erro IS NULL AND EXISTS (SELECT 1 FROM unnest(x.mensagens_enviadas) t WHERE t NOT LIKE '[não enviado%')),
       count(*) FILTER (WHERE x.erro IS NULL AND EXISTS (SELECT 1 FROM unnest(x.mensagens_enviadas) t WHERE t NOT LIKE '[não enviado%'))::integer,
       sum(coalesce(x.custo_usd, 0))
  FROM public.ia_execucoes x
 WHERE x.conversa_id IS NOT NULL AND x.created_at >= (date_trunc('month', private.hoje_sp()) - interval '1 month')
 GROUP BY 1, 2, 3
ON CONFLICT (empresa_id, mes, conversa_id) DO NOTHING;

-- Trava de somente leitura (tabela com empresa_id; a gravação é do servidor e passa).
SELECT private.instalar_travas_somente_leitura();
