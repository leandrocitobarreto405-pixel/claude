SELECT 'catálogo' AS item,
       string_agg(codigo || ' R$ ' || coalesce(preco_mensal::int::text, '-') || ' · limite ' || coalesce(limite_usuarios::text, 'sem')
                  || CASE WHEN ativo THEN ' · ativo' ELSE ' · inativo' END
                  || CASE WHEN publico THEN ' · público' ELSE ' · fora da tabela' END, ' | ' ORDER BY ordem) AS resultado
  FROM public.planos
UNION ALL
SELECT 'empresa ' || e.nome,
       coalesce(p.codigo, 'sem plano') || ' · recursos ' ||
       (SELECT count(*) FROM unnest(ARRAY['caixa_entrada','crm','deslocamento_rotas','cupons','marketing','vendas_origem','dre_comissoes','alice']) r
         WHERE private.empresa_tem_recurso(e.id, r)) || ' de 8 · limite ' ||
       coalesce(private.limite_usuarios_empresa(e.id)::text, 'sem limite')
  FROM public.empresas e
  LEFT JOIN public.assinaturas a ON a.empresa_id = e.id AND a.vigencia_fim IS NULL
  LEFT JOIN public.planos p ON p.id = a.plano_id
 WHERE e.id IN ('11111111-1111-1111-1111-111111111111', 'f1b06dbe-39dc-4344-89f7-dd27a68046d8')
UNION ALL
SELECT 'tabela pedidos_plano',
       coalesce(to_regclass('public.pedidos_plano')::text, 'NÃO EXISTE') || ' · RLS ' ||
       coalesce((SELECT relrowsecurity::text FROM pg_class WHERE oid = to_regclass('public.pedidos_plano')), '-') ||
       ' · regras ' || (SELECT count(*) FROM pg_policies WHERE tablename = 'pedidos_plano')
UNION ALL
SELECT 'travas (gatilhos)',
       (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_cupons_recurso','trg_mkt_campanhas_recurso','trg_daily_routes_recurso',
          'trg_ia_configuracoes_recurso','trg_orcamento_configuracoes_recurso','trg_usuarios_limite','trg_convites_limite')) || ' de 7'
UNION ALL
SELECT 'histórico de migrações',
       coalesce((SELECT string_agg(version || ' ' || name, ', ') FROM supabase_migrations.schema_migrations
                  WHERE name LIKE '%planos_recursos%'), 'NÃO REGISTRADA');
