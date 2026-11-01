-- Tatiana: fechar furos do acompanhamento (01/11/2026, todas as empresas).
-- 1. Próxima olhada (rever_em) na ficha do lead e na decisão da noite.
-- 2. Tipo da tarefa (mensagem, ligar, follow-up esquecido, remarcar, pós-venda, lead do site) e
--    quantas vezes a tarefa voltou ("pendente de ontem").
-- 3. Acertos novos: follow-up esquecido e tarefa atrasada.
-- 4. Horário de atendimento da empresa (tarefas só em dia/hora útil): seg–sáb 8h–19h por padrão.
-- 5. Pushes novos: cliente esperando há 2 h (admin) e equipe sem notificação (admin).
ALTER TABLE public.comercial_analises
  ADD COLUMN IF NOT EXISTS rever_em timestamptz,
  ADD COLUMN IF NOT EXISTS rever_motivo text CHECK (rever_motivo IS NULL OR length(rever_motivo) <= 120);
CREATE INDEX IF NOT EXISTS idx_comercial_analises_rever ON public.comercial_analises (empresa_id, rever_em)
  WHERE rever_em IS NOT NULL;
ALTER TABLE public.comercial_decisoes ADD COLUMN IF NOT EXISTS rever_em timestamptz;

ALTER TABLE public.crm_followups
  ADD COLUMN IF NOT EXISTS tarefa_tipo text NOT NULL DEFAULT 'mensagem'
    CHECK (tarefa_tipo IN ('mensagem', 'ligar', 'follow_up_esquecido', 'remarcar', 'pos_venda', 'lead_site')),
  ADD COLUMN IF NOT EXISTS adiamentos smallint NOT NULL DEFAULT 0 CHECK (adiamentos BETWEEN 0 AND 30);

ALTER TABLE public.comercial_cobrancas DROP CONSTRAINT IF EXISTS comercial_cobrancas_tipo_check;
ALTER TABLE public.comercial_cobrancas ADD CONSTRAINT comercial_cobrancas_tipo_check
  CHECK (tipo IN ('orcamento_sem_app', 'fechou_sem_os', 'remarcar', 'concluir_os', 'pagamento',
                  'demora_resposta', 'demora_preco', 'cadastro', 'follow_up_esquecido', 'tarefa_atrasada'));

-- Horário de atendimento: dias da semana (0 = domingo … 6 = sábado) e horas, em São Paulo.
ALTER TABLE public.comercial_configuracoes
  ADD COLUMN IF NOT EXISTS dias_uteis smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  ADD COLUMN IF NOT EXISTS hora_inicio time NOT NULL DEFAULT '08:00',
  ADD COLUMN IF NOT EXISTS hora_fim time NOT NULL DEFAULT '19:00';
ALTER TABLE public.comercial_configuracoes DROP CONSTRAINT IF EXISTS comercial_configuracoes_horario_check;
ALTER TABLE public.comercial_configuracoes ADD CONSTRAINT comercial_configuracoes_horario_check
  CHECK (hora_inicio < hora_fim AND cardinality(dias_uteis) BETWEEN 1 AND 7);

-- O admin grava o horário pela tela (o resto da configuração continua só pelo servidor).
CREATE OR REPLACE FUNCTION public.comercial_salvar_horario(_dias smallint[], _inicio time, _fim time)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
BEGIN
  IF emp IS NULL OR auth.uid() IS NULL OR NOT private.tem_papel('admin') THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  IF _dias IS NULL OR cardinality(_dias) = 0 OR EXISTS (SELECT 1 FROM unnest(_dias) d WHERE d < 0 OR d > 6) THEN
    RAISE EXCEPTION 'Escolha pelo menos um dia da semana.';
  END IF;
  IF _inicio IS NULL OR _fim IS NULL OR _inicio >= _fim THEN
    RAISE EXCEPTION 'O horário de início precisa ser antes do fim.';
  END IF;
  UPDATE public.comercial_configuracoes
     SET dias_uteis = (SELECT array_agg(DISTINCT d ORDER BY d) FROM unnest(_dias) d),
         hora_inicio = _inicio, hora_fim = _fim, updated_at = now()
   WHERE empresa_id = emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Gerente comercial não configurado nesta empresa.'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.comercial_salvar_horario(smallint[], time, time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comercial_salvar_horario(smallint[], time, time) TO authenticated;

ALTER TABLE public.push_envios DROP CONSTRAINT IF EXISTS push_envios_tipo_check;
ALTER TABLE public.push_envios ADD CONSTRAINT push_envios_tipo_check
  CHECK (tipo IN ('cliente_esperando', 'servico_concluido', 'campanha_aprovacao', 'agendamento_promocao',
                  'resumo_dia', 'teste', 'tatiana_tarefas', 'tatiana_cobrancas',
                  'cliente_esperando_2h', 'equipe_sem_push'));

SELECT private.instalar_travas_somente_leitura();
