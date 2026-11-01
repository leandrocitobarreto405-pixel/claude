-- Desfaz a migração 20261228360000_tatiana_furos (só com OK do usuário).
-- As tarefas e acertos criados pelas regras novas ficam (podem ser cancelados à mão).
DROP FUNCTION IF EXISTS public.comercial_salvar_horario(smallint[], time, time);
ALTER TABLE public.comercial_configuracoes DROP CONSTRAINT IF EXISTS comercial_configuracoes_horario_check;
ALTER TABLE public.comercial_configuracoes
  DROP COLUMN IF EXISTS dias_uteis, DROP COLUMN IF EXISTS hora_inicio, DROP COLUMN IF EXISTS hora_fim;
UPDATE public.comercial_cobrancas SET situacao = 'ja_certo', motivo = 'regra desfeita', resolvida_em = now()
 WHERE tipo IN ('follow_up_esquecido', 'tarefa_atrasada') AND situacao = 'pendente';
DELETE FROM public.comercial_cobrancas WHERE tipo IN ('follow_up_esquecido', 'tarefa_atrasada');
ALTER TABLE public.comercial_cobrancas DROP CONSTRAINT IF EXISTS comercial_cobrancas_tipo_check;
ALTER TABLE public.comercial_cobrancas ADD CONSTRAINT comercial_cobrancas_tipo_check
  CHECK (tipo IN ('orcamento_sem_app', 'fechou_sem_os', 'remarcar', 'concluir_os',
                  'pagamento', 'demora_resposta', 'demora_preco', 'cadastro'));
ALTER TABLE public.crm_followups DROP COLUMN IF EXISTS tarefa_tipo, DROP COLUMN IF EXISTS adiamentos;
ALTER TABLE public.comercial_decisoes DROP COLUMN IF EXISTS rever_em;
DROP INDEX IF EXISTS public.idx_comercial_analises_rever;
ALTER TABLE public.comercial_analises DROP COLUMN IF EXISTS rever_em, DROP COLUMN IF EXISTS rever_motivo;
ALTER TABLE public.push_envios DROP CONSTRAINT IF EXISTS push_envios_tipo_check;
ALTER TABLE public.push_envios ADD CONSTRAINT push_envios_tipo_check
  CHECK (tipo IN ('cliente_esperando', 'servico_concluido', 'campanha_aprovacao', 'agendamento_promocao',
                  'resumo_dia', 'teste', 'tatiana_tarefas', 'tatiana_cobrancas'));
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228360000';
