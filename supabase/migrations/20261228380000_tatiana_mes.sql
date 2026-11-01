-- Tatiana, gerente do mês, etapa 1 (02/11/2026): alertas de gerente por push ao admin.
-- Só o tipo novo no registro de pushes; o resto é cálculo na hora (meta, previsão, agenda,
-- alertas) e aviso no app pela tabela mkt_avisos, que já existe.
ALTER TABLE public.push_envios DROP CONSTRAINT IF EXISTS push_envios_tipo_check;
ALTER TABLE public.push_envios ADD CONSTRAINT push_envios_tipo_check
  CHECK (tipo IN ('cliente_esperando', 'servico_concluido', 'campanha_aprovacao', 'agendamento_promocao',
                  'resumo_dia', 'teste', 'tatiana_tarefas', 'tatiana_cobrancas',
                  'cliente_esperando_2h', 'equipe_sem_push', 'alerta_gerente'));
