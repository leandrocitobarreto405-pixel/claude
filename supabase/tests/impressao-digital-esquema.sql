-- Impressão digital do esquema e dos dados iniciais. Rode no banco local e no Supabase
-- (SQL Editor ou integração) e compare: valores iguais = mesmo esquema.
-- Obs.: a ordenação usa a collation do banco; em bancos com collations diferentes, compare
-- linha a linha (dados com acento podem mudar a ordem do agregado).
SELECT 'colunas' AS parte, md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,'') AS x
  FROM information_schema.columns WHERE table_schema='public') s
UNION ALL SELECT 'restricoes', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid) AS x
  FROM pg_constraint WHERE connamespace='public'::regnamespace) s
UNION ALL SELECT 'indices', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT indexname||':'||indexdef AS x FROM pg_indexes WHERE schemaname='public') s
UNION ALL SELECT 'politicas', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT tablename||':'||policyname||':'||cmd||':'||permissive||':'||roles::text||':'||coalesce(qual,'')||':'||coalesce(with_check,'') AS x
  FROM pg_policies WHERE schemaname='public') s
UNION ALL SELECT 'funcoes', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT n.nspname||'.'||p.proname||':'||pg_get_functiondef(p.oid) AS x
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.prokind='f') s
UNION ALL SELECT 'gatilhos', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT pg_get_triggerdef(t.oid) AS x FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
  WHERE c.relnamespace='public'::regnamespace AND NOT t.tgisinternal) s
UNION ALL SELECT 'rls_ativo', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT relname||':'||relrowsecurity AS x FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r') s
UNION ALL SELECT 'dados_config', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT empresa_id||kind||name||display_order||active||metadata::text AS x FROM public.config_options) s
UNION ALL SELECT 'dados_taxas', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT empresa_id||channel||payment_type||installments||rate_percent AS x FROM public.payment_rates) s
UNION ALL SELECT 'dados_parametros', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT empresa_id||key||value::text AS x FROM public.app_settings) s
UNION ALL SELECT 'dados_precos', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT empresa_id||nome||preco_higienizacao||coalesce(preco_impermeabilizacao::text,'')||ordem AS x FROM public.tabela_precos_itens) s
UNION ALL SELECT 'dados_despesas_rec', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT empresa_id||name||category||default_amount||recurrence||coalesce(due_day::text,'')||coalesce(weekday::text,'')||coalesce(seed_key,'')||coalesce(beneficiary,'') AS x FROM public.recurring_expenses) s
UNION ALL SELECT 'dados_pessoas', md5(string_agg(x, '|' ORDER BY x)) FROM (
  SELECT 'v'||empresa_id||name||commission_percentage||atendente_nexa AS x FROM public.salespeople
  UNION ALL SELECT 't'||empresa_id||name||coalesce(base_address,'') FROM public.technicians
  UNION ALL SELECT 'e'||id||nome||coalesce(cnpj,'')||plano FROM public.empresas
  UNION ALL SELECT 'c'||empresa_id||percentual||vigencia_inicio||coalesce(vigencia_fim::text,'') FROM public.contratos_comissao
  UNION ALL SELECT 'p'||chave||valor::text FROM public.configuracoes_plataforma) s
ORDER BY 1;
