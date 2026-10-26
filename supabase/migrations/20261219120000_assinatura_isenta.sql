-- Cobrança: Cobrar / Isenta e "Em teste até" na ficha da empresa (Painel Nexa, 26/10/2026).
-- 1. assinaturas.isenta: empresa isenta nunca gera fatura nem fica inadimplente (o portão a deixa
--    sempre em dia). Quem marcou e quando ficam guardados. Assinatura nova da mesma empresa herda a
--    isenção da que termina na véspera (troca de plano não perde a isenção).
-- 2. public.definir_cobranca: só a Nexa; isenta sim/não e "em teste até" (data) na assinatura
--    vigente. Em teste = status trial com grátis até a data; tirar o teste volta para ativa.
-- 3. public.situacao_cobranca_empresas: situação de cada empresa (para a lista do Painel Nexa).

ALTER TABLE public.assinaturas
  ADD COLUMN IF NOT EXISTS isenta boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS isenta_em timestamptz,
  ADD COLUMN IF NOT EXISTS isenta_por uuid;

-- Isenta não fica inadimplente (além da regra de sem mensalidade).
CREATE OR REPLACE FUNCTION private.assinaturas_sem_mensalidade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  valor numeric;
BEGIN
  IF NEW.status <> 'inadimplente' THEN RETURN NEW; END IF;
  IF NEW.isenta THEN
    RAISE EXCEPTION 'Empresa isenta de cobrança não fica inadimplente.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(NEW.valor_mensal, p.preco_mensal) INTO valor FROM public.planos p WHERE p.id = NEW.plano_id;
  IF coalesce(valor, 0) <= 0 THEN
    RAISE EXCEPTION 'Empresa sem mensalidade definida (vazia ou R$ 0) não fica inadimplente.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

-- Assinatura nova herda a isenção da que termina na véspera (definir_assinatura com outra data).
CREATE OR REPLACE FUNCTION private.assinaturas_herdar_isencao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  anterior public.assinaturas;
BEGIN
  IF NEW.isenta THEN RETURN NEW; END IF;
  SELECT * INTO anterior FROM public.assinaturas a
   WHERE a.empresa_id = NEW.empresa_id AND a.isenta AND a.vigencia_fim = NEW.vigencia_inicio - 1
   ORDER BY a.vigencia_inicio DESC LIMIT 1;
  IF anterior.id IS NOT NULL THEN
    NEW.isenta := true;
    NEW.isenta_em := anterior.isenta_em;
    NEW.isenta_por := anterior.isenta_por;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.assinaturas_herdar_isencao() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_assinaturas_herdar_isencao BEFORE INSERT ON public.assinaturas
  FOR EACH ROW EXECUTE FUNCTION private.assinaturas_herdar_isencao();

-- Isenta não gera fatura.
CREATE OR REPLACE FUNCTION private.faturas_conferir()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid;
  mensal numeric;
  sem_cobranca boolean;
BEGIN
  SELECT a.empresa_id, coalesce(a.valor_mensal, p.preco_mensal), a.isenta INTO emp, mensal, sem_cobranca
    FROM public.assinaturas a JOIN public.planos p ON p.id = a.plano_id
   WHERE a.id = NEW.assinatura_id;
  IF emp IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'Fatura de outra empresa.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND coalesce(sem_cobranca, false) THEN
    RAISE EXCEPTION 'Empresa isenta de cobrança não gera fatura.' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'INSERT' AND coalesce(mensal, 0) <= 0 THEN
    RAISE EXCEPTION 'Assinatura sem mensalidade definida (vazia ou R$ 0) não gera fatura.'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

-- Portão: isenta fica sempre em dia (defesa extra; o banco já não a deixa inadimplente).
CREATE OR REPLACE FUNCTION private.empresa_situacao(_emp uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ativa boolean;
  st text;
  desde date;
  sem_cobranca boolean;
  hoje date := private.hoje_sp();
BEGIN
  SELECT e.ativo INTO ativa FROM public.empresas e WHERE e.id = _emp;
  IF NOT coalesce(ativa, false) THEN RETURN 'bloqueada'; END IF;
  SELECT a.status, coalesce(a.inadimplente_desde, a.proximo_vencimento), a.isenta INTO st, desde, sem_cobranca
    FROM public.assinaturas a
   WHERE a.empresa_id = _emp AND a.vigencia_inicio <= hoje
     AND (a.vigencia_fim IS NULL OR a.vigencia_fim >= hoje)
   ORDER BY a.vigencia_inicio DESC LIMIT 1;
  IF st = 'cancelada' THEN RETURN 'bloqueada'; END IF;
  IF st = 'inadimplente' THEN
    IF coalesce(sem_cobranca, false) THEN RETURN 'ok'; END IF;
    -- Sem mensalidade definida (ou R$ 0) não existe atraso de pagamento.
    IF coalesce(private.mensalidade_vigente(_emp), 0) <= 0 THEN RETURN 'ok'; END IF;
    RETURN CASE WHEN hoje - coalesce(desde, hoje) > 7 THEN 'somente_leitura' ELSE 'aviso' END;
  END IF;
  RETURN 'ok';
END $$;

-- Ficha da empresa (só a Nexa): isenta e "em teste até".
CREATE OR REPLACE FUNCTION public.definir_cobranca(
  _empresa_id uuid, _isenta boolean, _mudar_teste boolean DEFAULT false, _teste_ate date DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  atual public.assinaturas;
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Apenas a Nexa altera a cobrança.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO atual FROM public.assinaturas
   WHERE empresa_id = _empresa_id AND vigencia_fim IS NULL FOR UPDATE;
  IF atual.id IS NULL THEN
    RAISE EXCEPTION 'Empresa sem assinatura: defina o plano antes.' USING ERRCODE = '22023';
  END IF;
  IF _mudar_teste AND _teste_ate IS NOT NULL AND _teste_ate < atual.vigencia_inicio THEN
    RAISE EXCEPTION 'O teste não pode terminar antes do início da assinatura.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.assinaturas a
     SET isenta = coalesce(_isenta, a.isenta),
         isenta_em = CASE WHEN coalesce(_isenta, a.isenta) AND NOT a.isenta THEN now()
                          WHEN NOT coalesce(_isenta, a.isenta) THEN NULL ELSE a.isenta_em END,
         isenta_por = CASE WHEN coalesce(_isenta, a.isenta) AND NOT a.isenta THEN auth.uid()
                           WHEN NOT coalesce(_isenta, a.isenta) THEN NULL ELSE a.isenta_por END,
         -- Isenta sai da inadimplência na hora.
         status = CASE
           WHEN a.status = 'cancelada' THEN a.status
           WHEN _mudar_teste AND _teste_ate IS NOT NULL THEN 'trial'
           WHEN _mudar_teste AND _teste_ate IS NULL AND a.status = 'trial' THEN 'ativa'
           WHEN coalesce(_isenta, a.isenta) AND a.status = 'inadimplente' THEN 'ativa'
           ELSE a.status END,
         inadimplente_desde = CASE WHEN coalesce(_isenta, a.isenta) THEN NULL ELSE a.inadimplente_desde END,
         gratis_ate = CASE WHEN _mudar_teste THEN _teste_ate ELSE a.gratis_ate END,
         proximo_vencimento = CASE WHEN _mudar_teste AND _teste_ate IS NOT NULL THEN _teste_ate + 1
                                   ELSE a.proximo_vencimento END
   WHERE a.id = atual.id;
END $$;
REVOKE ALL ON FUNCTION public.definir_cobranca(uuid, boolean, boolean, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_cobranca(uuid, boolean, boolean, date) TO authenticated;

-- Lista do Painel Nexa: situação do portão de cada empresa (só a Nexa).
CREATE OR REPLACE FUNCTION public.situacao_cobranca_empresas()
RETURNS TABLE (empresa_id uuid, situacao text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'Acesso restrito à Nexa' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT e.id, private.empresa_situacao(e.id) FROM public.empresas e;
END $$;
REVOKE ALL ON FUNCTION public.situacao_cobranca_empresas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.situacao_cobranca_empresas() TO authenticated;
