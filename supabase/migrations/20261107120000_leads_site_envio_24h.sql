-- Leads do site: mensagem automática 5 min depois do cadastro e 24 horas por padrão (o horário
-- continua editável). Continua DESLIGADA até "Ativar". Só acrescenta.
ALTER TABLE public.leads_site_configuracoes
  ADD COLUMN IF NOT EXISTS envio_24h boolean NOT NULL DEFAULT true;
ALTER TABLE public.leads_site_configuracoes ALTER COLUMN envio_apos_minutos SET DEFAULT 5;

-- Turbine: 5 minutos (estava no padrão antigo, 15).
UPDATE public.leads_site_configuracoes
   SET envio_apos_minutos = 5, updated_at = now()
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111' AND envio_apos_minutos = 15;

-- Alice (Turbine): confirmação e pós-venda passam a usar os modelos _v2 (texto sem "amanhã" e
-- "ontem" fixos). Os antigos ficam na Meta como estão e não são usados.
UPDATE public.ia_configuracoes
   SET confirmacao_modelo = 'tc_confirmacao_servico_v2', pos_venda_modelo = 'tc_pos_venda_v2'
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
   AND confirmacao_modelo = 'tc_confirmacao_servico' AND pos_venda_modelo = 'tc_pos_venda';
