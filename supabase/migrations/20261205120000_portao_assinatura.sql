-- Fase B, item 2: portão da assinatura (decisão F de 23/10/2026).
-- 1. private.empresa_situacao(empresa): ok | aviso (inadimplente, até 7 dias de carência) |
--    somente_leitura (inadimplente há mais de 7 dias) | bloqueada (assinatura cancelada ou
--    empresas.ativo = false). Empresa sem assinatura vigente: ok (regra de transição).
-- 2. private.empresa_ativa(): empresa bloqueada não abre para ninguém, menos o admin da Nexa
--    (corrige empresas.ativo, que só era filtrado no navegador).
-- 3. Somente leitura: um gatilho em cada tabela com empresa_id recusa gravar, alterar e apagar
--    feito por usuário logado da empresa (o servidor, os webhooks e o admin da Nexa continuam).
--    As mensagens que chegam continuam sendo guardadas (webhook = servidor).
-- 4. private.empresa_operante(empresa) = liberada pela Nexa E situação ok/aviso: a Alice e os
--    disparos conferem isso no lugar de só implantacao_liberada_em (pausam em somente leitura e
--    bloqueada).
-- 5. public.situacao_assinatura(empresa): o aviso no app (dias até o somente leitura).
-- Nenhum dado existente muda.

-- ================================================================ 1. situação
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
    RETURN CASE WHEN hoje - coalesce(desde, hoje) > 7 THEN 'somente_leitura' ELSE 'aviso' END;
  END IF;
  RETURN 'ok';
END $$;
REVOKE ALL ON FUNCTION private.empresa_situacao(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.empresa_situacao(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.empresa_operante(_emp uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.empresa_liberada(_emp) AND private.empresa_situacao(_emp) IN ('ok', 'aviso');
$$;
REVOKE ALL ON FUNCTION private.empresa_operante(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.empresa_operante(uuid) TO authenticated, service_role;

-- Leitura pelo servidor (Alice): o schema private não é exposto pela API.
CREATE OR REPLACE FUNCTION public.empresa_operante(_emp uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.empresa_operante(_emp);
$$;
REVOKE ALL ON FUNCTION public.empresa_operante(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.empresa_operante(uuid) TO service_role;

-- ================================================================ 2. empresa bloqueada não abre
CREATE OR REPLACE FUNCTION private.empresa_ativa()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  bruto text;
  pedida uuid;
  unica uuid;
  total int;
BEGIN
  IF uid IS NULL THEN
    RETURN NULL;
  END IF;

  bruto := nullif(current_setting('request.headers', true), '')::json ->> 'x-empresa-id';
  IF bruto IS NOT NULL AND bruto ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    pedida := bruto::uuid;
    IF private.is_nexa_admin(uid) AND EXISTS (SELECT 1 FROM public.empresas WHERE id = pedida) THEN
      RETURN pedida;
    END IF;
    IF EXISTS (SELECT 1 FROM public.usuarios_empresa WHERE user_id = uid AND empresa_id = pedida)
       AND private.empresa_situacao(pedida) <> 'bloqueada' THEN
      RETURN pedida;
    END IF;
    RETURN NULL;
  END IF;

  SELECT count(*), min(empresa_id::text)::uuid INTO total, unica
    FROM public.usuarios_empresa WHERE user_id = uid;
  IF total = 1 AND NOT private.is_nexa_admin(uid) AND private.empresa_situacao(unica) <> 'bloqueada' THEN
    RETURN unica;
  END IF;
  RETURN NULL;
END $function$;

-- ================================================================ 3. somente leitura
CREATE OR REPLACE FUNCTION private.somente_leitura_guarda()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  emp uuid;
BEGIN
  -- Só usuário logado pela tela; servidor (service_role), webhooks e rotinas seguem gravando.
  IF current_user <> 'authenticated' THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  emp := CASE WHEN TG_OP = 'DELETE' THEN OLD.empresa_id ELSE NEW.empresa_id END;
  IF emp IS NOT NULL AND private.empresa_situacao(emp) = 'somente_leitura'
     AND NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Empresa em modo somente leitura: a assinatura está em atraso há mais de 7 dias. Fale com a Nexa para regularizar.'
      USING ERRCODE = '42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION private.somente_leitura_guarda() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.somente_leitura_guarda() TO authenticated, service_role;

-- Todas as tabelas com empresa_id, menos as da Nexa (assinatura e contrato) e as de leitura e
-- aparelho (marcar como lida, inscrição de notificação). Tabela nova: o teste de banco cobra.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
     WHERE c.table_schema = 'public' AND c.column_name = 'empresa_id' AND tb.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('assinaturas', 'contratos_comissao', 'conversas_leituras',
                                'push_inscricoes', 'push_preferencias')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_zz_somente_leitura ON public.%I', t.table_name);
    EXECUTE format('CREATE TRIGGER trg_zz_somente_leitura BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION private.somente_leitura_guarda()', t.table_name);
  END LOOP;
END $$;

-- Para a tela: pode gravar na empresa ativa?
CREATE OR REPLACE FUNCTION public.empresa_pode_gravar()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.is_nexa_admin()
      OR coalesce(private.empresa_situacao(private.empresa_ativa()) IN ('ok', 'aviso'), false);
$$;
REVOKE ALL ON FUNCTION public.empresa_pode_gravar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empresa_pode_gravar() TO authenticated, service_role;

-- ================================================================ 4. disparos conferem a situação
DO $$
DECLARE
  def text;
  de text := 'JOIN public.empresas emp ON emp.id = e.empresa_id AND emp.implantacao_liberada_em IS NOT NULL';
  para text := 'JOIN public.empresas emp ON emp.id = e.empresa_id AND emp.implantacao_liberada_em IS NOT NULL AND private.empresa_operante(emp.id)';
  n int;
BEGIN
  def := pg_get_functiondef('public.mkt_reservar_envios(integer,timestamp with time zone)'::regprocedure);
  IF position(para IN def) > 0 THEN RETURN; END IF;
  n := (length(def) - length(replace(def, de, ''))) / length(de);
  IF n <> 1 THEN
    RAISE EXCEPTION 'Portão: trecho encontrado % vezes em mkt_reservar_envios', n;
  END IF;
  EXECUTE replace(def, de, para);
END $$;

-- ================================================================ 5. aviso no app
-- Situação da assinatura de uma empresa do usuário (funciona mesmo bloqueada, para a tela
-- explicar o motivo). Admin da Nexa vê qualquer empresa.
CREATE OR REPLACE FUNCTION public.situacao_assinatura(_emp uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a record;
  sit text;
  hoje date := private.hoje_sp();
BEGIN
  IF auth.uid() IS NULL OR NOT (private.is_nexa_admin() OR EXISTS (
       SELECT 1 FROM public.usuarios_empresa u WHERE u.user_id = auth.uid() AND u.empresa_id = _emp)) THEN
    RETURN '{}'::jsonb;
  END IF;
  sit := private.empresa_situacao(_emp);
  SELECT s.status, s.gratis_ate, s.proximo_vencimento,
         coalesce(s.inadimplente_desde, s.proximo_vencimento) AS desde
    INTO a
    FROM public.assinaturas s
   WHERE s.empresa_id = _emp AND s.vigencia_inicio <= hoje
     AND (s.vigencia_fim IS NULL OR s.vigencia_fim >= hoje)
   ORDER BY s.vigencia_inicio DESC LIMIT 1;
  RETURN jsonb_build_object(
    'situacao', sit,
    'status', a.status,
    'gratis_ate', a.gratis_ate,
    'proximo_vencimento', a.proximo_vencimento,
    'inadimplente_desde', CASE WHEN a.status = 'inadimplente' THEN a.desde END,
    -- Dias até virar somente leitura (inadimplente na carência).
    'dias_para_somente_leitura', CASE WHEN sit = 'aviso' THEN greatest(0, 8 - (hoje - coalesce(a.desde, hoje))) END);
END $$;
REVOKE ALL ON FUNCTION public.situacao_assinatura(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.situacao_assinatura(uuid) TO authenticated, service_role;
