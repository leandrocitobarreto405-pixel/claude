-- Roteiro-base da Alice para qualquer empresa (decisão de 26/10/2026).
-- 1. ia_configuracoes ganha os campos que eram fixos da Turbine no roteiro: região atendida,
--    nomes das atendentes e anos de experiência do técnico. No roteiro viram {regiao_atendida},
--    {nomes_atendentes} e {anos_experiencia}; vazios em todas as empresas (cada uma preenche).
-- 2. Empresa nova copia do Modelo Nexa também o roteiro da Alice (desligada). As outras cópias
--    da função continuam iguais.
-- Nenhum dado existente muda.
ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS regiao_atendida text NOT NULL DEFAULT '' CHECK (length(regiao_atendida) <= 120),
  ADD COLUMN IF NOT EXISTS nomes_atendentes text NOT NULL DEFAULT '' CHECK (length(nomes_atendentes) <= 120),
  ADD COLUMN IF NOT EXISTS anos_experiencia text NOT NULL DEFAULT '' CHECK (length(anos_experiencia) <= 10);

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

    -- Só listas e textos genéricos. Taxas da maquininha, margens, imposto, quilometragem e metas
    -- são do negócio de cada empresa: ela preenche (o checklist de implantação cobra).
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

  RETURN nova;
END $function$;
