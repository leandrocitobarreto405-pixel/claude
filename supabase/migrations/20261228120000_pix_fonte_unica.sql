-- Pix com uma fonte só por empresa (aprovado em 27/10/2026).
-- Fonte: orcamento_configuracoes.pix_pct (Configurações › Regras de orçamento › Pagamento).
-- As colunas antigas ficam (o código ainda lê algumas delas), mas passam a ser cópias:
--   ia_configuracoes.desconto_pix_percentual (Alice, orçamento manual, PDF) e
--   agenda_configuracoes.promo_pix_pct (Pix a mais na promoção da agenda).
-- Um gatilho copia o valor para as duas ao salvar o Pix; outro impede que elas sejam mudadas por
-- fora (voltam para o valor da fonte). Nada é apagado.

-- 1. Valor inicial da fonte. Turbine: 5% (confirmado; é o que a Alice, o orçamento manual, o PDF e a
--    promoção já usavam; o campo da vitrine, desligada, tinha 10%). Ecoprime fica com 10% (vitrine).
UPDATE public.orcamento_configuracoes SET pix_pct = 5
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
-- Empresa com Alice e sem regras de orçamento (Modelo Nexa): cria a linha com o Pix da Alice.
INSERT INTO public.orcamento_configuracoes (empresa_id, pix_pct)
SELECT i.empresa_id, coalesce(i.desconto_pix_percentual, 5)
  FROM public.ia_configuracoes i
 WHERE NOT EXISTS (SELECT 1 FROM public.orcamento_configuracoes o WHERE o.empresa_id = i.empresa_id);

-- 2. Cópias seguem a fonte.
CREATE OR REPLACE FUNCTION private.pix_copiar_da_fonte()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.ia_configuracoes SET desconto_pix_percentual = NEW.pix_pct
   WHERE empresa_id = NEW.empresa_id AND desconto_pix_percentual IS DISTINCT FROM NEW.pix_pct;
  -- A agenda limita promoção + Pix a 25%: o Pix da promoção fica no que couber.
  UPDATE public.agenda_configuracoes
     SET promo_pix_pct = least(NEW.pix_pct, greatest(25 - promo_desconto_pct, 0))
   WHERE empresa_id = NEW.empresa_id
     AND promo_pix_pct IS DISTINCT FROM least(NEW.pix_pct, greatest(25 - promo_desconto_pct, 0));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.pix_copiar_da_fonte() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_orcamento_configuracoes_pix
  AFTER INSERT OR UPDATE OF pix_pct ON public.orcamento_configuracoes
  FOR EACH ROW EXECUTE FUNCTION private.pix_copiar_da_fonte();

CREATE OR REPLACE FUNCTION private.pix_seguir_fonte()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE fonte numeric;
BEGIN
  SELECT pix_pct INTO fonte FROM public.orcamento_configuracoes WHERE empresa_id = NEW.empresa_id;
  IF fonte IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'ia_configuracoes' THEN
    NEW.desconto_pix_percentual := fonte;
  ELSE
    NEW.promo_pix_pct := least(fonte, greatest(25 - NEW.promo_desconto_pct, 0));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.pix_seguir_fonte() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_ia_configuracoes_pix
  BEFORE INSERT OR UPDATE OF desconto_pix_percentual ON public.ia_configuracoes
  FOR EACH ROW EXECUTE FUNCTION private.pix_seguir_fonte();
CREATE OR REPLACE TRIGGER trg_agenda_configuracoes_pix
  BEFORE INSERT OR UPDATE OF promo_pix_pct, promo_desconto_pct ON public.agenda_configuracoes
  FOR EACH ROW EXECUTE FUNCTION private.pix_seguir_fonte();

-- 3. Acerta as cópias de hoje (dispara o gatilho 2 em cada empresa com regras).
UPDATE public.orcamento_configuracoes SET pix_pct = pix_pct;
