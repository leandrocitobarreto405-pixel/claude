-- Planos novos (decisão de 26/10/2026), recursos por plano com trava e limite de usuários.
-- 1. Planos: Essencial R$ 97 (até 3 usuários), Profissional R$ 247 (até 6), Profissional + Alice
--    R$ 497 (até 6), Nexa Gestão R$ 497 + 5% (sem limite, fora da tabela pública), Interna R$ 0
--    (sem limite, fora da tabela pública). Básico e Completo ficam inativos (histórico).
-- 2. Recursos (planos.recursos, editável só pela Nexa): caixa_entrada, crm, deslocamento_rotas,
--    cupons, marketing, vendas_origem, dre_comissoes, alice. O resto é do Essencial (todos têm).
--    Sem assinatura vigente, a empresa fica só com o Essencial.
-- 3. Limite de usuários: conta admin e atendente (e convites pendentes desses papéis); técnicos e
--    equipe Nexa não contam. Limite = do plano + usuários extras da assinatura (vazio = sem limite).
-- 4. Travas no banco: cupom, campanha de marketing, rota do dia, ligar a Alice e ligar a taxa de
--    deslocamento só com o recurso no plano.
-- 5. Pedido de mudança de plano ("Quero mudar de plano"): avisa a Nexa.
-- 6. Usuário extra (R$ 29) e plano anual (paga 10, leva 12): só registrados; nada é cobrado.

ALTER TABLE public.planos
  ADD COLUMN IF NOT EXISTS limite_usuarios integer CHECK (limite_usuarios IS NULL OR limite_usuarios >= 1),
  ADD COLUMN IF NOT EXISTS publico boolean NOT NULL DEFAULT true;
ALTER TABLE public.assinaturas
  ADD COLUMN IF NOT EXISTS usuarios_extras integer NOT NULL DEFAULT 0 CHECK (usuarios_extras >= 0),
  ADD COLUMN IF NOT EXISTS ciclo text NOT NULL DEFAULT 'mensal' CHECK (ciclo IN ('mensal', 'anual'));

INSERT INTO public.configuracoes_plataforma (chave, valor, descricao) VALUES
  ('preco_usuario_extra', '29', 'Usuário extra por mês (R$); só registrado, ainda não cobrado'),
  ('anual_meses_pagos', '10', 'Plano anual: meses pagos para 12 de uso; só registrado, ainda não cobrado')
ON CONFLICT (chave) DO NOTHING;

INSERT INTO public.planos (codigo, nome, descricao, preco_mensal, comissao_pct, recursos, ordem, limite_usuarios, publico) VALUES
  ('essencial', 'Essencial',
   'OS, orçamento com PDF, agenda, técnicos (agenda no WhatsApp), recebimentos e despesas.', 97, 0,
   '{"caixa_entrada": false, "crm": false, "deslocamento_rotas": false, "cupons": false, "marketing": false, "vendas_origem": false, "dre_comissoes": false, "alice": false}',
   1, 3, true),
  ('profissional', 'Profissional',
   'Essencial + caixa de entrada do WhatsApp, respostas prontas, CRM, taxa de deslocamento e rotas, cupons, campanhas, vendas por origem, DRE e comissões.', 247, 0,
   '{"caixa_entrada": true, "crm": true, "deslocamento_rotas": true, "cupons": true, "marketing": true, "vendas_origem": true, "dre_comissoes": true, "alice": false}',
   2, 6, true),
  ('profissional_alice', 'Profissional + Alice',
   'Profissional + Alice (IA atendendo e orçando, áudio).', 497, 0,
   '{"caixa_entrada": true, "crm": true, "deslocamento_rotas": true, "cupons": true, "marketing": true, "vendas_origem": true, "dre_comissoes": true, "alice": true}',
   3, 6, true)
ON CONFLICT (codigo) DO NOTHING;

UPDATE public.planos
   SET preco_mensal = 497, publico = false, limite_usuarios = NULL, ordem = 4,
       descricao = 'Tudo do Profissional + Alice, com a equipe Nexa vendendo; comissão sobre as vendas da Nexa e da Alice.',
       recursos = '{"caixa_entrada": true, "crm": true, "deslocamento_rotas": true, "cupons": true, "marketing": true, "vendas_origem": true, "dre_comissoes": true, "alice": true}'
 WHERE codigo = 'nexa_gestao';
UPDATE public.planos
   SET publico = false, limite_usuarios = NULL, ordem = 5,
       recursos = '{"caixa_entrada": true, "crm": true, "deslocamento_rotas": true, "cupons": true, "marketing": true, "vendas_origem": true, "dre_comissoes": true, "alice": true}'
 WHERE codigo = 'interna';
UPDATE public.planos SET ativo = false, publico = false, ordem = 9 WHERE codigo IN ('basico', 'completo');

-- Assinatura vigente da empresa (a mesma regra da mensalidade e da situação).
CREATE OR REPLACE FUNCTION private.empresa_tem_recurso(_emp uuid, _recurso text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((
    SELECT (p.recursos ->> _recurso) = 'true'
      FROM public.assinaturas a JOIN public.planos p ON p.id = a.plano_id
     WHERE a.empresa_id = _emp AND a.status <> 'cancelada'
       AND a.vigencia_inicio <= private.hoje_sp()
       AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= private.hoje_sp())
     ORDER BY a.vigencia_inicio DESC LIMIT 1), false);
$$;
REVOKE ALL ON FUNCTION private.empresa_tem_recurso(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.empresa_tem_recurso(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.limite_usuarios_empresa(_emp uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p.limite_usuarios IS NULL THEN NULL ELSE p.limite_usuarios + a.usuarios_extras END
    FROM public.assinaturas a JOIN public.planos p ON p.id = a.plano_id
   WHERE a.empresa_id = _emp AND a.status <> 'cancelada'
     AND a.vigencia_inicio <= private.hoje_sp()
     AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= private.hoje_sp())
   ORDER BY a.vigencia_inicio DESC LIMIT 1;
$$;
REVOKE ALL ON FUNCTION private.limite_usuarios_empresa(uuid) FROM PUBLIC, anon;

-- Admin e atendente + convites pendentes desses papéis (sem quem já é usuário da empresa).
CREATE OR REPLACE FUNCTION private.usuarios_que_contam(_emp uuid, _sem_user uuid DEFAULT NULL, _sem_email text DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (SELECT count(*) FROM public.usuarios_empresa u
           WHERE u.empresa_id = _emp AND u.papel IN ('admin', 'atendente')
             AND u.user_id IS DISTINCT FROM _sem_user)::integer
       + (SELECT count(*) FROM public.convites_empresa c
           WHERE c.empresa_id = _emp AND c.aceito_em IS NULL AND c.papel IN ('admin', 'atendente')
             AND lower(c.email) IS DISTINCT FROM lower(_sem_email)
             AND NOT EXISTS (SELECT 1 FROM public.usuarios_empresa u JOIN auth.users au ON au.id = u.user_id
                              WHERE u.empresa_id = _emp AND lower(au.email) = lower(c.email)))::integer;
$$;
REVOKE ALL ON FUNCTION private.usuarios_que_contam(uuid, uuid, text) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION private.conferir_limite_usuarios()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  limite integer;
  email_novo text;
BEGIN
  IF NEW.papel NOT IN ('admin', 'atendente') THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.papel IN ('admin', 'atendente') THEN RETURN NEW; END IF;
  limite := private.limite_usuarios_empresa(NEW.empresa_id);
  IF limite IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'usuarios_empresa' THEN
    SELECT au.email INTO email_novo FROM auth.users au WHERE au.id = NEW.user_id;
    IF private.usuarios_que_contam(NEW.empresa_id, NEW.user_id, email_novo) >= limite THEN
      RAISE EXCEPTION 'Limite de usuários do plano atingido (%). Técnicos não contam; para mais, usuário extra ou outro plano.', limite
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.aceito_em IS NULL THEN
    IF private.usuarios_que_contam(NEW.empresa_id, NULL, NEW.email) >= limite THEN
      RAISE EXCEPTION 'Limite de usuários do plano atingido (%). Técnicos não contam; para mais, usuário extra ou outro plano.', limite
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.conferir_limite_usuarios() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_usuarios_limite BEFORE INSERT OR UPDATE OF papel ON public.usuarios_empresa
  FOR EACH ROW EXECUTE FUNCTION private.conferir_limite_usuarios();
CREATE OR REPLACE TRIGGER trg_convites_limite BEFORE INSERT OR UPDATE OF papel ON public.convites_empresa
  FOR EACH ROW EXECUTE FUNCTION private.conferir_limite_usuarios();

-- Trava de recurso para o que a tela grava direto (o servidor com chave de serviço não passa aqui).
CREATE OR REPLACE FUNCTION private.exigir_recurso()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  recurso text := TG_ARGV[0];
  ligando boolean := true;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'ia_configuracoes' THEN
    ligando := NEW.ativo AND (TG_OP = 'INSERT' OR NOT OLD.ativo);
  ELSIF TG_TABLE_NAME = 'orcamento_configuracoes' THEN
    ligando := NEW.distancia_ligado AND (TG_OP = 'INSERT' OR NOT OLD.distancia_ligado);
  END IF;
  IF ligando AND NOT private.empresa_tem_recurso(NEW.empresa_id, recurso) THEN
    RAISE EXCEPTION 'Disponível em outro plano (recurso: %). Fale com a Nexa para mudar de plano.', recurso
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.exigir_recurso() FROM PUBLIC, anon;
CREATE OR REPLACE TRIGGER trg_cupons_recurso BEFORE INSERT OR UPDATE ON public.cupons
  FOR EACH ROW EXECUTE FUNCTION private.exigir_recurso('cupons');
CREATE OR REPLACE TRIGGER trg_mkt_campanhas_recurso BEFORE INSERT OR UPDATE ON public.mkt_campanhas
  FOR EACH ROW EXECUTE FUNCTION private.exigir_recurso('marketing');
CREATE OR REPLACE TRIGGER trg_daily_routes_recurso BEFORE INSERT OR UPDATE ON public.daily_routes
  FOR EACH ROW EXECUTE FUNCTION private.exigir_recurso('deslocamento_rotas');
CREATE OR REPLACE TRIGGER trg_ia_configuracoes_recurso BEFORE INSERT OR UPDATE ON public.ia_configuracoes
  FOR EACH ROW EXECUTE FUNCTION private.exigir_recurso('alice');
CREATE OR REPLACE TRIGGER trg_orcamento_configuracoes_recurso BEFORE INSERT OR UPDATE ON public.orcamento_configuracoes
  FOR EACH ROW EXECUTE FUNCTION private.exigir_recurso('deslocamento_rotas');

-- Recurso da empresa aberta (tela e funções do servidor com o login de quem usa).
CREATE OR REPLACE FUNCTION public.tem_recurso(_recurso text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.empresa_tem_recurso(private.empresa_ativa(), _recurso);
$$;
REVOKE ALL ON FUNCTION public.tem_recurso(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tem_recurso(text) TO authenticated, service_role;

-- Rotinas do servidor (chave de serviço): recurso de uma empresa qualquer.
CREATE OR REPLACE FUNCTION public.empresa_tem_recurso(_emp uuid, _recurso text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.empresa_tem_recurso(_emp, _recurso);
$$;
REVOKE ALL ON FUNCTION public.empresa_tem_recurso(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.empresa_tem_recurso(uuid, text) TO service_role;

-- Para a tela e o servidor: recursos da empresa aberta, plano, limite e planos públicos.
CREATE OR REPLACE FUNCTION public.plano_da_empresa()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  r jsonb;
BEGIN
  IF emp IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object(
           'plano', p.codigo, 'plano_nome', p.nome, 'recursos', p.recursos,
           'limite_usuarios', private.limite_usuarios_empresa(emp),
           'usuarios_extras', a.usuarios_extras)
    INTO r
    FROM public.assinaturas a JOIN public.planos p ON p.id = a.plano_id
   WHERE a.empresa_id = emp AND a.status <> 'cancelada'
     AND a.vigencia_inicio <= private.hoje_sp()
     AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= private.hoje_sp())
   ORDER BY a.vigencia_inicio DESC LIMIT 1;
  RETURN coalesce(r, jsonb_build_object('plano', null, 'plano_nome', null, 'recursos', '{}'::jsonb,
                                        'limite_usuarios', null, 'usuarios_extras', 0))
         || jsonb_build_object(
              'usuarios_em_uso', private.usuarios_que_contam(emp),
              'planos', (SELECT coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'nome', p.nome,
                           'preco_mensal', p.preco_mensal, 'recursos', p.recursos) ORDER BY p.ordem), '[]'::jsonb)
                           FROM public.planos p WHERE p.ativo AND p.publico));
END $$;
REVOKE ALL ON FUNCTION public.plano_da_empresa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.plano_da_empresa() TO authenticated, service_role;

-- "Quero mudar de plano": aviso para a Nexa (sininho do Painel Nexa).
CREATE TABLE IF NOT EXISTS public.pedidos_plano (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL DEFAULT private.empresa_ativa() REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  recurso text CHECK (recurso IS NULL OR recurso ~ '^[a-z_]{2,40}$'),
  plano_sugerido text CHECK (plano_sugerido IS NULL OR plano_sugerido ~ '^[a-z_]{2,40}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  visto_em timestamptz,
  visto_por uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_pedidos_plano_pendentes ON public.pedidos_plano (criado_em DESC) WHERE visto_em IS NULL;
ALTER TABLE public.pedidos_plano ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pedidos_plano FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pedidos_plano TO authenticated;
GRANT ALL ON public.pedidos_plano TO service_role;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pedidos_plano' AND policyname = 'pedidos_plano_select') THEN
    CREATE POLICY pedidos_plano_select ON public.pedidos_plano FOR SELECT TO authenticated
      USING (empresa_id = (SELECT private.empresa_ativa()) OR (SELECT private.is_nexa_admin()));
  END IF;
END $p$;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pedidos_plano' AND policyname = 'pedidos_plano_insert') THEN
    CREATE POLICY pedidos_plano_insert ON public.pedidos_plano FOR INSERT TO authenticated
      WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND user_id = (SELECT auth.uid()) AND visto_em IS NULL);
  END IF;
END $p$;
DO $p$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'pedidos_plano' AND policyname = 'pedidos_plano_update') THEN
    CREATE POLICY pedidos_plano_update ON public.pedidos_plano FOR UPDATE TO authenticated
      USING ((SELECT private.is_nexa_admin())) WITH CHECK ((SELECT private.is_nexa_admin()));
  END IF;
END $p$;

-- Trava de somente leitura (tabela com empresa_id): empresa em atraso não grava pedido.
SELECT private.instalar_travas_somente_leitura();
