-- Datas de negócio no fuso de São Paulo.
-- CURRENT_DATE usa o fuso do servidor (UTC): uma empresa cadastrada às 22h do último dia do
-- mês começaria a comissão no mês seguinte. Mesmas funções, só a data de referência muda.

CREATE OR REPLACE FUNCTION private.hoje_sp()
RETURNS date LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date;
$$;
REVOKE ALL ON FUNCTION private.hoje_sp() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.hoje_sp() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.definir_comissao_empresa(_empresa_id uuid, _percentual numeric, _inicio date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  atual public.contratos_comissao;
  novo uuid;
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'apenas a Nexa altera a comissão';
  END IF;
  IF _inicio IS NULL THEN _inicio := private.hoje_sp(); END IF;

  SELECT * INTO atual FROM public.contratos_comissao
   WHERE empresa_id = _empresa_id AND vigencia_fim IS NULL FOR UPDATE;

  IF atual.id IS NOT NULL THEN
    -- Mesma data de início: correção do percentual da vigência atual.
    IF _inicio = atual.vigencia_inicio THEN
      UPDATE public.contratos_comissao SET percentual = _percentual WHERE id = atual.id;
      RETURN atual.id;
    END IF;
    IF _inicio < atual.vigencia_inicio THEN
      RAISE EXCEPTION 'a nova vigência precisa começar depois de %', atual.vigencia_inicio;
    END IF;
    UPDATE public.contratos_comissao SET vigencia_fim = _inicio - 1 WHERE id = atual.id;
  END IF;

  INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio,
    somente_atendentes_nexa, base)
  VALUES (_empresa_id, _percentual, _inicio,
    COALESCE(atual.somente_atendentes_nexa, true), COALESCE(atual.base, 'recebido_servico_realizado'))
  RETURNING id INTO novo;
  RETURN novo;
END $$;

CREATE OR REPLACE FUNCTION private.provisionar_empresa(
  _nome text, _cnpj text DEFAULT NULL, _telefone text DEFAULT NULL, _percentual_comissao numeric DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  nova uuid;
  modelo uuid;
  pct numeric;
BEGIN
  IF NOT private.is_nexa_admin() THEN
    RAISE EXCEPTION 'apenas a Nexa cadastra empresas';
  END IF;
  IF _nome IS NULL OR length(trim(_nome)) < 2 THEN
    RAISE EXCEPTION 'informe o nome da empresa';
  END IF;

  SELECT (valor #>> '{}')::uuid INTO modelo FROM public.configuracoes_plataforma WHERE chave = 'empresa_modelo_id';
  SELECT (valor #>> '{}')::numeric INTO pct FROM public.configuracoes_plataforma WHERE chave = 'comissao_percentual_padrao';
  pct := COALESCE(_percentual_comissao, pct, 5);

  INSERT INTO public.empresas (nome, cnpj, telefone)
  VALUES (trim(_nome), nullif(trim(_cnpj), ''), nullif(trim(_telefone), ''))
  RETURNING id INTO nova;

  IF modelo IS NOT NULL THEN
    INSERT INTO public.config_options (empresa_id, kind, name, active, display_order, metadata)
    SELECT nova, kind, name, active, display_order, metadata
      FROM public.config_options WHERE empresa_id = modelo;

    INSERT INTO public.payment_rates (empresa_id, channel, payment_type, installments, rate_percent, active, effective_from)
    SELECT nova, channel, payment_type, installments, rate_percent, active, effective_from
      FROM public.payment_rates WHERE empresa_id = modelo AND active;

    -- Parâmetros de negócio; dados específicos da empresa-modelo (nome, integrações) não são copiados.
    INSERT INTO public.app_settings (empresa_id, key, value)
    SELECT nova, key, value FROM public.app_settings
     WHERE empresa_id = modelo
       AND key NOT IN ('company', 'os_document_settings', 'google_calendar_settings');
  END IF;

  INSERT INTO public.app_settings (empresa_id, key, value)
  VALUES (nova, 'company', jsonb_build_object('name', trim(_nome), 'document', COALESCE(_cnpj, ''), 'phone', COALESCE(_telefone, '')))
  ON CONFLICT (empresa_id, key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio, observacoes)
  VALUES (nova, pct, private.hoje_sp(), 'Contrato inicial');

  RETURN nova;
END $$;
