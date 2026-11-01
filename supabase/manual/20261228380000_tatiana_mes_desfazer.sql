-- Desfaz a migração 20261228380000_tatiana_mes (só com OK do usuário): tira o tipo de push
-- 'alerta_gerente' (apaga antes os registros desse tipo) e os avisos de gerente no app.
DELETE FROM public.push_envios WHERE tipo = 'alerta_gerente';
ALTER TABLE public.push_envios DROP CONSTRAINT IF EXISTS push_envios_tipo_check;
ALTER TABLE public.push_envios ADD CONSTRAINT push_envios_tipo_check
  CHECK (tipo IN ('cliente_esperando', 'servico_concluido', 'campanha_aprovacao', 'agendamento_promocao',
                  'resumo_dia', 'teste', 'tatiana_tarefas', 'tatiana_cobrancas',
                  'cliente_esperando_2h', 'equipe_sem_push'));
DELETE FROM public.mkt_avisos WHERE tipo = 'gerente_alerta';
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228380000';
