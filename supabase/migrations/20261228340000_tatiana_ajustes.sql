-- Tatiana, ajustes da 1ª noite (31/10/2026).
-- 1. Lista da equipe: só os acertos escolhidos pela noite (até 10 por dia, por prioridade); o resto
--    fica só na aba Cobranças do dono (visivel_equipe = false). O admin continua vendo tudo.
-- 2. Cadastro: o cliente nasce do orçamento ao virar OS; o lead passa a apontar para o cliente da OS
--    (crm_leads.customer_id), uma vez agora e sempre daqui em diante.
-- 3. Dados: as cobranças 'cadastro' pendentes viram 'ja_certo' ("regra corrigida"; nada é apagado) e
--    as outras pendentes saem da lista da equipe até a conferência das amostras.
ALTER TABLE public.comercial_cobrancas
  ADD COLUMN IF NOT EXISTS visivel_equipe boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS comercial_cobrancas_select ON public.comercial_cobrancas;
CREATE POLICY comercial_cobrancas_select ON public.comercial_cobrancas FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa())
   AND ((SELECT private.tem_papel('admin'))
        OR (visivel_equipe
            AND (user_id = (SELECT auth.uid())
                 OR (user_id IS NULL AND (SELECT private.equipe_unica(private.empresa_ativa())))))))
  OR (SELECT private.is_nexa_admin()));

-- Lead → cliente da OS (quando o lead ainda não tem cliente).
CREATE OR REPLACE FUNCTION private.lead_cliente_da_os()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.customer_id IS NULL AND NEW.linked_work_order_id IS NOT NULL THEN
    SELECT w.customer_id INTO NEW.customer_id
      FROM public.work_orders w
     WHERE w.id = NEW.linked_work_order_id AND w.empresa_id = NEW.empresa_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.lead_cliente_da_os() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_lead_cliente_da_os ON public.crm_leads;
CREATE TRIGGER trg_lead_cliente_da_os
  BEFORE INSERT OR UPDATE OF linked_work_order_id, customer_id ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION private.lead_cliente_da_os();

-- OS ganhou (ou trocou para) um cliente: os leads ligados a ela sem cliente passam a apontar para ele.
CREATE OR REPLACE FUNCTION private.os_cliente_no_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE public.crm_leads
       SET customer_id = NEW.customer_id
     WHERE linked_work_order_id = NEW.id AND empresa_id = NEW.empresa_id AND customer_id IS NULL;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.os_cliente_no_lead() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_os_cliente_no_lead ON public.work_orders;
CREATE TRIGGER trg_os_cliente_no_lead
  AFTER INSERT OR UPDATE OF customer_id ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION private.os_cliente_no_lead();

-- Dados (uma vez): leads com OS e sem cliente apontam para o cliente da OS.
UPDATE public.crm_leads l
   SET customer_id = w.customer_id
  FROM public.work_orders w
 WHERE w.id = l.linked_work_order_id AND w.empresa_id = l.empresa_id
   AND l.customer_id IS NULL AND w.customer_id IS NOT NULL;

-- Dados: 'cadastro' pendente → 'ja_certo' com o motivo; as outras pendentes saem da lista da equipe.
UPDATE public.comercial_cobrancas
   SET situacao = 'ja_certo', motivo = 'regra corrigida', resolvida_em = now()
 WHERE tipo = 'cadastro' AND situacao = 'pendente';
UPDATE public.comercial_cobrancas
   SET visivel_equipe = false
 WHERE situacao = 'pendente';
