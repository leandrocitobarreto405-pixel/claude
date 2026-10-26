-- Desfaz 20261215120000_planos_recursos (código antigo no ar antes; a Teste Asaas precisa voltar ao Básico).
UPDATE public.assinaturas SET plano_id = (SELECT id FROM public.planos WHERE codigo = 'basico')
 WHERE id = '4603967c-0ff2-456f-85f3-c6f919614f03';
DROP TRIGGER IF EXISTS trg_usuarios_limite ON public.usuarios_empresa;
DROP TRIGGER IF EXISTS trg_convites_limite ON public.convites_empresa;
DROP TRIGGER IF EXISTS trg_cupons_recurso ON public.cupons;
DROP TRIGGER IF EXISTS trg_mkt_campanhas_recurso ON public.mkt_campanhas;
DROP TRIGGER IF EXISTS trg_daily_routes_recurso ON public.daily_routes;
DROP TRIGGER IF EXISTS trg_ia_configuracoes_recurso ON public.ia_configuracoes;
DROP TRIGGER IF EXISTS trg_orcamento_configuracoes_recurso ON public.orcamento_configuracoes;
DROP TABLE IF EXISTS public.pedidos_plano;
DROP FUNCTION IF EXISTS public.plano_da_empresa();
DROP FUNCTION IF EXISTS public.empresa_tem_recurso(uuid, text);
DROP FUNCTION IF EXISTS public.tem_recurso(text);
DROP FUNCTION IF EXISTS private.exigir_recurso();
DROP FUNCTION IF EXISTS private.conferir_limite_usuarios();
DROP FUNCTION IF EXISTS private.usuarios_que_contam(uuid, uuid, text);
DROP FUNCTION IF EXISTS private.limite_usuarios_empresa(uuid);
DROP FUNCTION IF EXISTS private.empresa_tem_recurso(uuid, text);
-- Catálogo como estava (os planos novos só saem se nenhuma assinatura usar).
UPDATE public.planos SET ativo = true, ordem = 1 WHERE codigo = 'basico';
UPDATE public.planos SET ativo = true, ordem = 2 WHERE codigo = 'completo';
UPDATE public.planos SET preco_mensal = NULL, ordem = 3,
       descricao = 'Completo + equipe de vendas da Nexa; comissão sobre as vendas da Nexa e da Alice.',
       recursos = '{"alice": true, "marketing": true, "caixa_entrada": true}'
 WHERE codigo = 'nexa_gestao';
UPDATE public.planos SET ordem = 4, recursos = '{"alice": true, "marketing": true, "caixa_entrada": true}'
 WHERE codigo = 'interna';
DELETE FROM public.planos p WHERE p.codigo IN ('essencial', 'profissional', 'profissional_alice')
   AND NOT EXISTS (SELECT 1 FROM public.assinaturas a WHERE a.plano_id = p.id);
DELETE FROM public.configuracoes_plataforma WHERE chave IN ('preco_usuario_extra', 'anual_meses_pagos');
-- As colunas novas (planos.limite_usuarios, planos.publico, assinaturas.usuarios_extras, assinaturas.ciclo)
-- ficam: não atrapalham o código antigo e apagar coluna perde dado.
DELETE FROM supabase_migrations.schema_migrations WHERE name = 'planos_recursos';
