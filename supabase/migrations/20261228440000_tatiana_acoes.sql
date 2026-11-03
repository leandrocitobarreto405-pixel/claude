-- Tatiana faz e informa (03/11/2026): o que ela fez sozinha no app em modo ativo (previsão de
-- pagamento na OS, orçamento em rascunho, cadastro do cliente), com o estado anterior para o
-- botão Desfazer e o registro de quem desfez e quando. Em modo teste fica "faria". Nada aqui
-- envia mensagem a cliente. Desfazer: supabase/manual/20261228440000_tatiana_acoes_desfazer.sql
CREATE TABLE IF NOT EXISTS public.comercial_acoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  noite_id uuid REFERENCES public.comercial_noites(id) ON DELETE SET NULL,
  cobranca_id uuid REFERENCES public.comercial_cobrancas(id) ON DELETE SET NULL,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  conversa_id uuid,
  tipo text NOT NULL CHECK (tipo IN ('previsao_pagamento', 'orcamento_rascunho', 'cadastro', 'virar_os')),
  situacao text NOT NULL DEFAULT 'feita' CHECK (situacao IN ('faria', 'feita', 'desfeita', 'falhou')),
  -- Uma linha para a equipe ("Previsão de pagamento R$ 240 em 5x no cartão na OS 1702").
  titulo text NOT NULL,
  -- Trecho da conversa que sustenta a ação.
  frase text,
  -- Ids do que foi mexido: {"work_order_id": …} | {"quote_id": …} | {"customer_id": …}.
  referencia jsonb NOT NULL DEFAULT '{}'::jsonb,
  antes jsonb,
  depois jsonb,
  erro text,
  feita_em timestamptz NOT NULL DEFAULT now(),
  desfeita_em timestamptz,
  desfeita_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  desfeita_motivo text,
  criada_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comercial_acoes_empresa ON public.comercial_acoes (empresa_id, feita_em DESC);

-- Quem é da empresa lê (o bloco "Feito pela Tatiana" é da equipe toda); só o servidor grava.
ALTER TABLE public.comercial_acoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comercial_acoes FROM anon, authenticated;
GRANT SELECT ON public.comercial_acoes TO authenticated;
GRANT ALL ON public.comercial_acoes TO service_role;
DROP POLICY IF EXISTS comercial_acoes_select ON public.comercial_acoes;
CREATE POLICY comercial_acoes_select ON public.comercial_acoes FOR SELECT TO authenticated USING (
  empresa_id = (SELECT private.empresa_ativa()) OR (SELECT private.is_nexa_admin()));

SELECT private.instalar_travas_somente_leitura();
