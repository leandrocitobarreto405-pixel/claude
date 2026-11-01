-- "Avisar a Tatiana" (01/11/2026, Parte D2): na conversa, a atendente ou o admin escreve uma frase
-- sobre um erro ou acerto; fica gravado com a conversa e entra na revisão semanal da Tatiana como
-- sinal forte. Cada pessoa vê os seus avisos; o admin vê todos e o que cada um virou (sugestão
-- aprovada ou recusada). Gravação só pela função (até 30 avisos por pessoa por dia).
CREATE TABLE IF NOT EXISTS public.comercial_avisos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  user_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('erro', 'acerto')),
  frase text NOT NULL CHECK (length(btrim(frase)) BETWEEN 3 AND 300),
  criado_em timestamptz NOT NULL DEFAULT now(),
  -- O que virou: a revisão semanal liga o aviso à sugestão do relatório (decisão lida de lá).
  relatorio_id uuid REFERENCES public.comercial_relatorios(id) ON DELETE SET NULL,
  sugestao_indice smallint,
  revisado_em timestamptz
);
CREATE INDEX IF NOT EXISTS idx_comercial_avisos_empresa ON public.comercial_avisos (empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_comercial_avisos_user ON public.comercial_avisos (empresa_id, user_id, criado_em DESC);

ALTER TABLE public.comercial_avisos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comercial_avisos FROM anon, authenticated;
GRANT SELECT ON public.comercial_avisos TO authenticated;
GRANT ALL ON public.comercial_avisos TO service_role;
DROP POLICY IF EXISTS comercial_avisos_select ON public.comercial_avisos;
CREATE POLICY comercial_avisos_select ON public.comercial_avisos FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa())
   AND ((SELECT private.tem_papel('admin')) OR user_id = (SELECT auth.uid())))
  OR (SELECT private.is_nexa_admin()));

CREATE OR REPLACE FUNCTION public.comercial_avisar(_conversa uuid, _tipo text, _frase text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  lead uuid;
  novo uuid;
BEGIN
  IF emp IS NULL OR auth.uid() IS NULL OR NOT (private.tem_papel('admin') OR private.tem_papel('atendente')) THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  IF _tipo NOT IN ('erro', 'acerto') THEN RAISE EXCEPTION 'Escolha erro ou acerto.'; END IF;
  IF length(btrim(coalesce(_frase, ''))) < 3 THEN RAISE EXCEPTION 'Escreva uma frase sobre o que aconteceu.'; END IF;
  SELECT c.crm_lead_id INTO lead FROM public.conversas c WHERE c.id = _conversa AND c.empresa_id = emp;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversa não encontrada.'; END IF;
  IF (SELECT count(*) FROM public.comercial_avisos
       WHERE empresa_id = emp AND user_id = auth.uid() AND criado_em > now() - interval '1 day') >= 30 THEN
    RAISE EXCEPTION 'Limite de 30 avisos por dia.';
  END IF;
  INSERT INTO public.comercial_avisos (empresa_id, conversa_id, crm_lead_id, user_id, tipo, frase)
  VALUES (emp, _conversa, lead, auth.uid(), _tipo, left(btrim(_frase), 300))
  RETURNING id INTO novo;
  RETURN novo;
END $$;
REVOKE ALL ON FUNCTION public.comercial_avisar(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comercial_avisar(uuid, text, text) TO authenticated;

SELECT private.instalar_travas_somente_leitura();
