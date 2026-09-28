-- =====================================================================================
-- Nexa OS — endereço do Chatwoot sempre como "https://servidor"
--
-- A conexão guardou o endereço completo da tela (https://app.chatwoot.com/app/accounts/187966/),
-- o que quebrava as chamadas à API (criação do robô da Alice) e o link "Abrir no Chatwoot".
-- Agora o banco guarda só esquema + servidor (+ porta), qualquer que seja o texto colado.
-- =====================================================================================

CREATE OR REPLACE FUNCTION private.normalizar_base_url_chatwoot()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  origem text := substring(lower(trim(NEW.base_url)) FROM '^(https?://[^/?#]+)');
BEGIN
  IF origem IS NULL THEN
    RAISE EXCEPTION 'Endereço do Chatwoot inválido (use algo como https://app.chatwoot.com).'
      USING ERRCODE = '23514';
  END IF;
  NEW.base_url := origem;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.normalizar_base_url_chatwoot() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_chatwoot_conexoes_base_url BEFORE INSERT OR UPDATE OF base_url ON public.chatwoot_conexoes
  FOR EACH ROW EXECUTE FUNCTION private.normalizar_base_url_chatwoot();

-- Corrige as conexões já gravadas.
UPDATE public.chatwoot_conexoes SET base_url = base_url;
