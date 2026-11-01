-- Tatiana: desempenho de campanha (01/11/2026). Para cada campanha de WhatsApp enviada, a Tatiana
-- acompanha 7 dias (enviados, responderam, pediram orçamento, fecharam, R$ vendido, custo e
-- retorno), classifica as respostas (interesse, preço, sem interesse, descadastro…) e, no fim da
-- janela, escreve 2–3 sugestões para a próxima campanha. Só o admin lê; só o servidor grava.
CREATE TABLE IF NOT EXISTS public.comercial_campanhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  campanha_id uuid NOT NULL REFERENCES public.mkt_campanhas(id) ON DELETE CASCADE,
  -- Janela de 7 dias a partir do primeiro envio.
  janela_inicio timestamptz NOT NULL,
  janela_fim timestamptz NOT NULL,
  encerrada boolean NOT NULL DEFAULT false,
  numeros jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"classes": {"interesse": 3, ...}, "por_envio": {"<envio>": "preco"}, "exemplos": [...]}
  respostas jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{"tipo": "texto|oferta|publico|horario|modelo", "sugestao": "..."}] e a leitura curta.
  sugestoes jsonb,
  leitura text,
  custo_usd numeric(10,5) NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  criado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, campanha_id)
);
CREATE INDEX IF NOT EXISTS idx_comercial_campanhas_empresa ON public.comercial_campanhas (empresa_id, janela_inicio DESC);

ALTER TABLE public.comercial_campanhas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.comercial_campanhas FROM anon, authenticated;
GRANT SELECT ON public.comercial_campanhas TO authenticated;
GRANT ALL ON public.comercial_campanhas TO service_role;
DROP POLICY IF EXISTS comercial_campanhas_select ON public.comercial_campanhas;
CREATE POLICY comercial_campanhas_select ON public.comercial_campanhas FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  OR (SELECT private.is_nexa_admin()));

SELECT private.instalar_travas_somente_leitura();
