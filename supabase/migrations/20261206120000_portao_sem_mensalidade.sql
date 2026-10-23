-- Portão: empresa sem mensalidade (vazia ou R$ 0) nunca fica em atraso (pedido de 23/10/2026).
-- 1. private.mensalidade_vigente(empresa): a mensalidade da assinatura; sem ela, a do plano
--    (NULL = a definir, como o Nexa Gestão hoje).
-- 2. private.empresa_situacao: inadimplente com mensalidade vazia ou R$ 0 conta como "ok"
--    (sem carência, sem somente leitura e sem bloqueio por falta de pagamento). Cancelar pela
--    Nexa continua bloqueando.
-- 3. assinaturas: o banco recusa marcar "inadimplente" quando a mensalidade é vazia ou R$ 0.
-- 4. private.instalar_travas_somente_leitura(): põe a trava de somente leitura em toda tabela
--    com empresa_id que ainda não tem (a agenda dos técnicos entrou depois do portão).
-- Nenhum dado existente muda.

CREATE OR REPLACE FUNCTION private.mensalidade_vigente(_emp uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(a.valor_mensal, p.preco_mensal)
    FROM public.assinaturas a JOIN public.planos p ON p.id = a.plano_id
   WHERE a.empresa_id = _emp AND a.vigencia_inicio <= private.hoje_sp()
     AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= private.hoje_sp())
   ORDER BY a.vigencia_inicio DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.mensalidade_vigente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.mensalidade_vigente(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.empresa_situacao(_emp uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ativa boolean;
  st text;
  desde date;
  hoje date := private.hoje_sp();
BEGIN
  SELECT e.ativo INTO ativa FROM public.empresas e WHERE e.id = _emp;
  IF NOT coalesce(ativa, false) THEN RETURN 'bloqueada'; END IF;
  SELECT a.status, coalesce(a.inadimplente_desde, a.proximo_vencimento) INTO st, desde
    FROM public.assinaturas a
   WHERE a.empresa_id = _emp AND a.vigencia_inicio <= hoje
     AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= hoje)
   ORDER BY a.vigencia_inicio DESC LIMIT 1;
  IF st = 'cancelada' THEN RETURN 'bloqueada'; END IF;
  IF st = 'inadimplente' THEN
    -- Sem mensalidade definida (ou R$ 0) não existe atraso de pagamento.
    IF coalesce(private.mensalidade_vigente(_emp), 0) <= 0 THEN RETURN 'ok'; END IF;
    RETURN CASE WHEN hoje - coalesce(desde, hoje) > 7 THEN 'somente_leitura' ELSE 'aviso' END;
  END IF;
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION private.assinaturas_sem_mensalidade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  valor numeric;
BEGIN
  IF NEW.status <> 'inadimplente' THEN RETURN NEW; END IF;
  SELECT coalesce(NEW.valor_mensal, p.preco_mensal) INTO valor FROM public.planos p WHERE p.id = NEW.plano_id;
  IF coalesce(valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Empresa sem mensalidade definida (vazia ou R$ 0) não fica inadimplente.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.assinaturas_sem_mensalidade() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_assinaturas_sem_mensalidade ON public.assinaturas;
CREATE TRIGGER trg_assinaturas_sem_mensalidade BEFORE INSERT OR UPDATE ON public.assinaturas
  FOR EACH ROW EXECUTE FUNCTION private.assinaturas_sem_mensalidade();

-- Trava de somente leitura em toda tabela com empresa_id (idempotente; migrações novas chamam).
CREATE OR REPLACE FUNCTION private.instalar_travas_somente_leitura()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t record;
  n integer := 0;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'empresa_id' AND tb.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('assinaturas', 'contratos_comissao', 'conversas_leituras',
                                'push_inscricoes', 'push_preferencias')
       AND NOT EXISTS (SELECT 1 FROM pg_trigger g
                        WHERE g.tgrelid = format('public.%I', c.table_name)::regclass
                          AND g.tgname = 'trg_zz_somente_leitura')
  LOOP
    EXECUTE format('CREATE TRIGGER trg_zz_somente_leitura BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION private.somente_leitura_guarda()', t.table_name);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.instalar_travas_somente_leitura() FROM PUBLIC, anon, authenticated;
SELECT private.instalar_travas_somente_leitura();
