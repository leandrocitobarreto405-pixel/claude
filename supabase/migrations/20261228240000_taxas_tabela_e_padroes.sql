-- Taxas de pagamento e padrões de empresa nova (29/10, PARTE 2, itens 6 e 8).
-- 1) Uma taxa por (empresa, canal, forma, parcelas): a tela grava a grade inteira, linha a linha.
-- 2) private.tabela_taxas(_tabela): tabelas prontas das maquininhas. Hoje só a InfinitePay (a
--    mesma da Turbine); "santander" e "personalizada" ficam para preencher à mão.
-- 3) public.aplicar_tabela_taxas(_tabela): o admin aplica a tabela pronta na empresa ativa (troca
--    as taxas da grade pelas da tabela; o que não está na tabela fica como está) e guarda a escolha
--    em app_settings ("taxas_maquininha").
-- 4) Arredondamento da vitrine aceita "nenhum" (sem arredondamento).
-- 5) Empresa nova: taxas InfinitePay, Pix 5%, sem arredondamento, boas-vindas desligado
--    (disponível), nota fiscal "sempre", marketing preparado 5 dias antes (era 10) e aviso no
--    WhatsApp da equipe desligado. Nada muda nas empresas que já existem.
CREATE UNIQUE INDEX IF NOT EXISTS payment_rates_empresa_combinacao_key
  ON public.payment_rates (empresa_id, channel, payment_type, installments);

CREATE OR REPLACE FUNCTION private.tabela_taxas(_tabela text)
RETURNS TABLE (channel text, payment_type text, installments integer, rate_percent numeric)
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT t.channel, t.payment_type, t.installments, t.rate_percent
    FROM (VALUES
    ('Maquininha', 'Débito', 1, 2.58),
    ('Maquininha', 'Crédito', 1, 4.91),
    ('Maquininha', 'Crédito', 2, 6.47),
    ('Maquininha', 'Crédito', 3, 7.20),
    ('Maquininha', 'Crédito', 4, 7.92),
    ('Maquininha', 'Crédito', 5, 8.63),
    ('Maquininha', 'Crédito', 6, 9.33),
    ('Maquininha', 'Crédito', 7, 10.03),
    ('Maquininha', 'Crédito', 8, 10.72),
    ('Maquininha', 'Crédito', 9, 11.41),
    ('Maquininha', 'Crédito', 10, 12.08),
    ('Maquininha', 'Crédito', 11, 12.75),
    ('Maquininha', 'Crédito', 12, 13.41),
    ('Maquininha', 'Pix', 1, 0.00),
    ('Link de pagamento', 'Crédito', 1, 4.20),
    ('Link de pagamento', 'Crédito', 2, 6.09),
    ('Link de pagamento', 'Crédito', 3, 7.01),
    ('Link de pagamento', 'Crédito', 4, 7.91),
    ('Link de pagamento', 'Crédito', 5, 8.80),
    ('Link de pagamento', 'Crédito', 6, 9.67),
    ('Link de pagamento', 'Crédito', 7, 12.59),
    ('Link de pagamento', 'Crédito', 8, 13.42),
    ('Link de pagamento', 'Crédito', 9, 14.25),
    ('Link de pagamento', 'Crédito', 10, 15.06),
    ('Link de pagamento', 'Crédito', 11, 15.87),
    ('Link de pagamento', 'Crédito', 12, 16.66),
    ('Link de pagamento', 'Pix', 1, 0.00),
    ('Pix direto', 'Pix', 1, 0.00),
    ('Dinheiro', 'Dinheiro', 1, 0.00),
    ('Transferência', 'Transferência', 1, 0.00),
    ('Outro', 'Outro', 1, 0.00)
    ) AS t(channel, payment_type, installments, rate_percent)
   WHERE _tabela = 'infinitepay';
$$;
REVOKE ALL ON FUNCTION private.tabela_taxas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.tabela_taxas(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.aplicar_tabela_taxas(_tabela text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  emp uuid := private.empresa_ativa();
  n integer;
BEGIN
  IF emp IS NULL OR NOT private.tem_papel('admin') THEN
    RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501';
  END IF;
  IF _tabela NOT IN ('infinitepay', 'santander', 'personalizada') THEN
    RAISE EXCEPTION 'tabela desconhecida';
  END IF;
  INSERT INTO public.payment_rates (empresa_id, channel, payment_type, installments, rate_percent, active, effective_from)
  SELECT emp, t.channel, t.payment_type, t.installments, t.rate_percent, true, private.hoje_sp()
    FROM private.tabela_taxas(_tabela) t
  ON CONFLICT (empresa_id, channel, payment_type, installments)
  DO UPDATE SET rate_percent = EXCLUDED.rate_percent, active = true, updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO public.app_settings (empresa_id, key, value)
  VALUES (emp, 'taxas_maquininha', to_jsonb(_tabela))
  ON CONFLICT (empresa_id, key) DO UPDATE SET value = EXCLUDED.value;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.aplicar_tabela_taxas(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_tabela_taxas(text) TO authenticated;

ALTER TABLE public.orcamento_configuracoes DROP CONSTRAINT IF EXISTS orcamento_configuracoes_arredondamento_check;
ALTER TABLE public.orcamento_configuracoes ADD CONSTRAINT orcamento_configuracoes_arredondamento_check
  CHECK (arredondamento IN ('dezena_5', 'noventa', 'nenhum'));

-- Padrões para linhas novas (as empresas que já têm linha não mudam).
ALTER TABLE public.orcamento_configuracoes ALTER COLUMN pix_pct SET DEFAULT 5;
ALTER TABLE public.orcamento_configuracoes ALTER COLUMN arredondamento SET DEFAULT 'nenhum';
ALTER TABLE public.mkt_configuracoes ALTER COLUMN dias_antes_preparo SET DEFAULT 5;

CREATE OR REPLACE FUNCTION private.provisionar_empresa(_nome text, _cnpj text DEFAULT NULL::text, _telefone text DEFAULT NULL::text, _percentual_comissao numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

    -- Só listas e textos genéricos. Margens, imposto, quilometragem e metas são do negócio de
    -- cada empresa: ela preenche (o checklist de implantação cobra).
    INSERT INTO public.app_settings (empresa_id, key, value)
    SELECT nova, key, value FROM public.app_settings
     WHERE empresa_id = modelo
       AND key IN ('message_template', 'invoice_message_template', 'crm_novo_lead_apos_dias');

    -- Roteiro-base da Alice (com {nome_empresa} e os campos da empresa), sempre desligada: a
    -- empresa preenche região, atendentes e experiência antes de ligar.
    INSERT INTO public.ia_configuracoes (empresa_id, ativo, nome, descricao_negocio, instrucoes, perguntas_frequentes)
    -- (ia_configuracoes tem a coluna "modelo" da IA, que conflita com a variável: o id do modelo
    -- é lido de novo da configuração da plataforma.)
    SELECT nova, false, ic.nome, ic.descricao_negocio, ic.instrucoes, ic.perguntas_frequentes
      FROM public.ia_configuracoes ic
     WHERE ic.empresa_id = (SELECT (p.valor #>> '{}')::uuid FROM public.configuracoes_plataforma p
                             WHERE p.chave = 'empresa_modelo_id');
  END IF;

  INSERT INTO public.app_settings (empresa_id, key, value)
  VALUES (nova, 'company', jsonb_build_object('name', trim(_nome), 'document', COALESCE(_cnpj, ''), 'phone', COALESCE(_telefone, '')))
  ON CONFLICT (empresa_id, key) DO UPDATE SET value = EXCLUDED.value;

  INSERT INTO public.contratos_comissao (empresa_id, percentual, vigencia_inicio, observacoes)
  VALUES (nova, pct, private.hoje_sp(), 'Contrato inicial');

  -- Padrões de empresa nova (29/10): taxas da InfinitePay (a empresa revisa no checklist), Pix 5%,
  -- sem arredondamento, boas-vindas desligado, nota "sempre", marketing preparado 5 dias antes e
  -- aviso no WhatsApp da equipe desligado.
  INSERT INTO public.payment_rates (empresa_id, channel, payment_type, installments, rate_percent, active, effective_from)
  SELECT nova, t.channel, t.payment_type, t.installments, t.rate_percent, true, private.hoje_sp()
    FROM private.tabela_taxas('infinitepay') t
  ON CONFLICT (empresa_id, channel, payment_type, installments) DO NOTHING;
  INSERT INTO public.app_settings (empresa_id, key, value)
  VALUES (nova, 'taxas_maquininha', to_jsonb('infinitepay'::text)),
         (nova, 'invoice_rule', to_jsonb('sempre'::text))
  ON CONFLICT (empresa_id, key) DO NOTHING;
  INSERT INTO public.orcamento_configuracoes (empresa_id, pix_pct, arredondamento, vitrine_ligada)
  VALUES (nova, 5, 'nenhum', false)
  ON CONFLICT (empresa_id) DO NOTHING;
  INSERT INTO public.mkt_configuracoes (empresa_id, dias_antes_preparo, preparo_automatico, aviso_whatsapp_ligado)
  VALUES (nova, 5, true, false)
  ON CONFLICT (empresa_id) DO NOTHING;

  RETURN nova;
END $function$;
