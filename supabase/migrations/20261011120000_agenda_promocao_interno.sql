-- Contato interno da equipe, agenda (horários base, veículos e rodízio) e promoção para agenda
-- vazia. Aprovado em 02/10/2026. Nada aqui envia mensagem: a promoção só sai quando o admin toca
-- em "Ativar" e com a chave geral "Envio ligado" (mkt_configuracoes.disparo_ligado).

-- ================================================================ 1. contatos internos da equipe
-- Número marcado como interno recebe os avisos da equipe e sai de todo envio para cliente
-- (campanhas, gatilhos, promoção e follow-ups da Alice). Só o admin marca e desmarca.
CREATE TABLE public.contatos_internos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  telefone text NOT NULL,
  -- Mesma chave do resto do banco (DDD + 8 últimos dígitos), preenchida pelo gatilho abaixo.
  chave text NOT NULL,
  nome text,
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, chave)
);

CREATE OR REPLACE FUNCTION private.contatos_internos_normalizar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  NEW.telefone := private.normalizar_telefone(NEW.telefone);
  IF NEW.telefone IS NULL OR NEW.telefone !~ '^55[1-9][0-9][0-9]{8,9}$' THEN
    RAISE EXCEPTION 'Telefone inválido para contato interno' USING ERRCODE = '22023';
  END IF;
  NEW.chave := private.telefone_chave(NEW.telefone);
  NEW.nome := nullif(left(btrim(coalesce(NEW.nome, '')), 120), '');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.contatos_internos_normalizar() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_contatos_internos_normalizar BEFORE INSERT OR UPDATE ON public.contatos_internos
  FOR EACH ROW EXECUTE FUNCTION private.contatos_internos_normalizar();

ALTER TABLE public.contatos_internos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.contatos_internos FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.contatos_internos TO authenticated;
GRANT ALL ON public.contatos_internos TO service_role;
CREATE POLICY contatos_internos_select ON public.contatos_internos FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()));
CREATE POLICY contatos_internos_insert ON public.contatos_internos FOR INSERT TO authenticated
  WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE POLICY contatos_internos_delete ON public.contatos_internos FOR DELETE TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));

CREATE OR REPLACE FUNCTION private.contato_interno(_emp uuid, _telefone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.contatos_internos i
                  WHERE i.empresa_id = _emp
                    AND i.chave = private.telefone_chave(private.normalizar_telefone(_telefone)));
$$;
REVOKE ALL ON FUNCTION private.contato_interno(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.contato_interno(uuid, text) TO service_role;

-- ================================================================ 2. agenda: veículos, horários base
CREATE TABLE public.veiculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  tecnico_id uuid REFERENCES public.technicians(id) ON DELETE SET NULL,
  -- Dia do rodízio em São Paulo (1 = segunda ... 5 = sexta); vazio = sem rodízio.
  dia_rodizio smallint CHECK (dia_rodizio BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_veiculos_empresa ON public.veiculos (empresa_id);

-- Horários base de cada técnico (servem só para a promoção saber o que está vago).
CREATE TABLE public.agenda_horarios_base (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tecnico_id uuid NOT NULL REFERENCES public.technicians(id) ON DELETE CASCADE,
  -- 0 = domingo ... 6 = sábado.
  dia_semana smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora time NOT NULL,
  UNIQUE (tecnico_id, dia_semana, hora)
);
CREATE INDEX idx_agenda_horarios_base_empresa ON public.agenda_horarios_base (empresa_id);

CREATE TABLE public.agenda_configuracoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- Rodízio (São Paulo: 7h às 10h e 17h às 20h).
  rodizio_manha_inicio time NOT NULL DEFAULT '07:00',
  rodizio_manha_fim time NOT NULL DEFAULT '10:00',
  rodizio_tarde_inicio time NOT NULL DEFAULT '17:00',
  rodizio_tarde_fim time NOT NULL DEFAULT '20:00',
  -- Alerta no dia do rodízio: começar antes desta hora, ou fim (+ volta) depois do início da tarde.
  rodizio_comecar_a_partir time NOT NULL DEFAULT '11:00',
  duracao_atendimento_min int NOT NULL DEFAULT 180 CHECK (duracao_atendimento_min BETWEEN 30 AND 600),
  deslocamento_volta_min int NOT NULL DEFAULT 30 CHECK (deslocamento_volta_min BETWEEN 0 AND 240),
  -- Promoção para agenda vazia.
  promo_dias_a_frente int NOT NULL DEFAULT 1 CHECK (promo_dias_a_frente BETWEEN 1 AND 7),
  promo_desconto_pct numeric(5,2) NOT NULL DEFAULT 20 CHECK (promo_desconto_pct BETWEEN 1 AND 25),
  promo_pix_pct numeric(5,2) NOT NULL DEFAULT 5 CHECK (promo_pix_pct BETWEEN 0 AND 25),
  promo_orcamento_dias int NOT NULL DEFAULT 15 CHECK (promo_orcamento_dias BETWEEN 1 AND 90),
  promo_conversas_novas boolean NOT NULL DEFAULT true,
  promo_template_nome text NOT NULL DEFAULT 'tc_promocao_agenda',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_configuracoes_desconto_total CHECK (promo_desconto_pct + promo_pix_pct <= 25),
  CONSTRAINT agenda_configuracoes_rodizio CHECK (
    rodizio_manha_inicio < rodizio_manha_fim AND rodizio_tarde_inicio < rodizio_tarde_fim)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['veiculos', 'agenda_horarios_base', 'agenda_configuracoes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
                    USING (empresa_id = (SELECT private.empresa_ativa()))', t || '_select', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
                    WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel(''admin'')))',
                   t || '_insert', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
                    USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel(''admin'')))
                    WITH CHECK (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel(''admin'')))',
                   t || '_update', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
                    USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel(''admin'')))',
                   t || '_delete', t);
  END LOOP;
END $$;

CREATE TRIGGER trg_veiculos_valida_empresa BEFORE INSERT OR UPDATE ON public.veiculos
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('tecnico_id', 'technicians');
CREATE TRIGGER trg_agenda_horarios_base_valida_empresa BEFORE INSERT OR UPDATE ON public.agenda_horarios_base
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('tecnico_id', 'technicians');
