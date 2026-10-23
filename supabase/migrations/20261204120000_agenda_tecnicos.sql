-- Agenda do dia seguinte no WhatsApp de cada técnico (plano aprovado em 23/10/2026; aplicar só com
-- o ok). Nada aqui envia mensagem: o envio nasce DESLIGADO por empresa (Configurações › Agenda).
-- 1. technicians.telefone (WhatsApp, 55 + DDD + número; gravado normalizado e conferido aqui; a
--    tela exige para técnico da equipe; parceiro fica fora) e technicians.recebe_agenda.
-- 2. agenda_configuracoes: ligado (false), horário (18:00, São Paulo) e o modelo aprovado na Meta.
-- 3. agenda_tecnicos_envios: cada envio (data da agenda, técnico, serviços, situação e motivo).
--    Um envio por técnico e dia (o teste não conta): rotina rodando de novo não manda duas vezes.
--    Leitura só do admin da empresa; quem grava é o servidor.
-- Nenhum dado existente muda.

-- ================================================================ 1. telefone do técnico
ALTER TABLE public.technicians
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS recebe_agenda boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION private.technicians_telefone()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF nullif(btrim(coalesce(NEW.telefone, '')), '') IS NULL THEN
    NEW.telefone := NULL;
    RETURN NEW;
  END IF;
  NEW.telefone := private.normalizar_telefone(NEW.telefone);
  IF NEW.telefone IS NULL OR NEW.telefone !~ '^55[1-9][0-9][0-9]{8,9}$' THEN
    RAISE EXCEPTION 'Telefone do técnico inválido: use DDD + número (WhatsApp)' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.technicians_telefone() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_technicians_telefone ON public.technicians;
CREATE TRIGGER trg_technicians_telefone BEFORE INSERT OR UPDATE OF telefone ON public.technicians
  FOR EACH ROW EXECUTE FUNCTION private.technicians_telefone();

-- ================================================================ 2. configuração por empresa
ALTER TABLE public.agenda_configuracoes
  ADD COLUMN IF NOT EXISTS agenda_tecnicos_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS agenda_tecnicos_hora time NOT NULL DEFAULT '18:00',
  ADD COLUMN IF NOT EXISTS agenda_tecnicos_modelo text;

-- ================================================================ 3. envios
CREATE TABLE IF NOT EXISTS public.agenda_tecnicos_envios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  tecnico_id uuid NOT NULL REFERENCES public.technicians(id) ON DELETE CASCADE,
  -- Dia dos serviços (amanhã, no horário de São Paulo, quando a rotina roda).
  dia_agenda date NOT NULL,
  servicos integer NOT NULL DEFAULT 0 CHECK (servicos >= 0),
  situacao text NOT NULL DEFAULT 'enviando'
    CHECK (situacao IN ('enviando', 'enviado', 'erro', 'sem_telefone')),
  motivo text,
  -- texto (dentro da janela de 24 h), modelo com PDF ou modelo com link (fora da janela).
  via text CHECK (via IS NULL OR via IN ('texto', 'modelo_pdf', 'modelo_link')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  conversa_id bigint,
  mensagem_id bigint,
  -- Envio de teste (só para um contato interno da equipe): não conta para o "um por dia".
  teste boolean NOT NULL DEFAULT false,
  destino_interno text,
  -- Link secreto da agenda (só o resumo do token; expira no fim do dia do serviço).
  link_token_hash text,
  link_expira_em timestamptz,
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  enviado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agenda_tecnicos_envios_um_por_dia
  ON public.agenda_tecnicos_envios (empresa_id, tecnico_id, dia_agenda) WHERE NOT teste;
CREATE INDEX IF NOT EXISTS idx_agenda_tecnicos_envios_recentes
  ON public.agenda_tecnicos_envios (empresa_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS agenda_tecnicos_envios_token
  ON public.agenda_tecnicos_envios (link_token_hash) WHERE link_token_hash IS NOT NULL;

ALTER TABLE public.agenda_tecnicos_envios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agenda_tecnicos_envios FROM anon, authenticated;
GRANT SELECT ON public.agenda_tecnicos_envios TO authenticated;
GRANT ALL ON public.agenda_tecnicos_envios TO service_role;
DROP POLICY IF EXISTS agenda_tecnicos_envios_select ON public.agenda_tecnicos_envios;
CREATE POLICY agenda_tecnicos_envios_select ON public.agenda_tecnicos_envios FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
DROP TRIGGER IF EXISTS trg_agenda_tecnicos_envios_upd ON public.agenda_tecnicos_envios;
CREATE TRIGGER trg_agenda_tecnicos_envios_upd BEFORE UPDATE ON public.agenda_tecnicos_envios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_agenda_tecnicos_envios_valida_empresa ON public.agenda_tecnicos_envios;
CREATE TRIGGER trg_agenda_tecnicos_envios_valida_empresa
  BEFORE INSERT OR UPDATE ON public.agenda_tecnicos_envios
  FOR EACH ROW EXECUTE FUNCTION private.validar_empresa_referencias('tecnico_id', 'technicians');
