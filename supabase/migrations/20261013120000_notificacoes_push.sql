-- Notificações no celular (Web Push da própria Nexa), autorizado em 02/10/2026. Cada pessoa ativa
-- no seu celular e escolhe o que quer receber. Nada é enviado por WhatsApp (sem custo da Meta).

-- ================================================================ 1. celulares inscritos
CREATE TABLE public.push_inscricoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Endereço do serviço de push do celular (Apple, Google...). Um celular = um endereço.
  endpoint text NOT NULL UNIQUE CHECK (endpoint ~ '^https://' AND length(endpoint) <= 1000),
  p256dh text NOT NULL CHECK (length(p256dh) BETWEEN 80 AND 100),
  auth text NOT NULL CHECK (length(auth) BETWEEN 16 AND 40),
  aparelho text CHECK (length(aparelho) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  ultimo_envio_em timestamptz,
  falhas int NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_inscricoes_empresa_user ON public.push_inscricoes (empresa_id, user_id);
ALTER TABLE public.push_inscricoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_inscricoes FROM anon, authenticated;
GRANT SELECT, DELETE ON public.push_inscricoes TO authenticated;
GRANT ALL ON public.push_inscricoes TO service_role;
-- Cada pessoa vê e apaga só os próprios celulares (a inscrição é gravada pelo servidor).
CREATE POLICY push_inscricoes_select ON public.push_inscricoes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND user_id = (SELECT auth.uid()));
CREATE POLICY push_inscricoes_delete ON public.push_inscricoes FOR DELETE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND user_id = (SELECT auth.uid()));

-- ================================================================ 2. o que cada pessoa quer receber
CREATE TABLE public.push_preferencias (
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cliente_esperando boolean NOT NULL DEFAULT true,
  espera_minutos int NOT NULL DEFAULT 10 CHECK (espera_minutos BETWEEN 1 AND 240),
  servico_concluido boolean NOT NULL DEFAULT true,
  campanha_aprovacao boolean NOT NULL DEFAULT true,
  agendamento_promocao boolean NOT NULL DEFAULT true,
  resumo_dia boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, user_id)
);
ALTER TABLE public.push_preferencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_preferencias FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.push_preferencias TO authenticated;
GRANT ALL ON public.push_preferencias TO service_role;
CREATE POLICY push_preferencias_select ON public.push_preferencias FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND user_id = (SELECT auth.uid()));
CREATE POLICY push_preferencias_insert ON public.push_preferencias FOR INSERT TO authenticated
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND user_id = (SELECT auth.uid()));
CREATE POLICY push_preferencias_update ON public.push_preferencias FOR UPDATE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND user_id = (SELECT auth.uid()))
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND user_id = (SELECT auth.uid()));

-- ================================================================ 3. o que já foi notificado
-- Evita repetir a mesma notificação (ex.: a mesma espera de um cliente). Só o servidor grava.
CREATE TABLE public.push_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('cliente_esperando', 'servico_concluido', 'campanha_aprovacao',
                                     'agendamento_promocao', 'resumo_dia', 'teste')),
  ref text NOT NULL,
  titulo text NOT NULL,
  enviados int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, user_id, tipo, ref)
);
CREATE INDEX idx_push_envios_criado ON public.push_envios (created_at);
ALTER TABLE public.push_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_envios FROM anon, authenticated;
GRANT SELECT ON public.push_envios TO authenticated;
GRANT ALL ON public.push_envios TO service_role;
CREATE POLICY push_envios_select ON public.push_envios FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND user_id = (SELECT auth.uid()));
