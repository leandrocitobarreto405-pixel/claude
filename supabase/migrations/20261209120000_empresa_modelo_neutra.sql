-- Fase B, item 4 (decisão H + decisão de 26/10/2026): empresa-modelo neutra. Empresa nova não
-- copia mais nada da Turbine: copia deste modelo (empresa inativa, sem usuários, escondida das
-- listas). Os valores ficam escritos aqui, então mudança na Turbine não passa para empresas novas.
-- Conteúdo: origens padrão (com "Site (orgânico)" e "Blog", sem palavras de cupom), etapas do CRM,
-- serviços genéricos de higienização, tipos de estofado, formas de pagamento comuns, categorias de
-- despesa, motivos e mensagens padrão sem o nome de nenhuma empresa.
-- configuracoes_plataforma.empresa_modelo_id passa a apontar para o modelo. Nenhuma empresa
-- existente muda.

INSERT INTO public.empresas (id, nome, ativo)
VALUES ('99999999-9999-4999-8999-999999999999', 'Modelo Nexa (não usar)', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.config_options (empresa_id, kind, name, active, display_order, metadata)
SELECT '99999999-9999-4999-8999-999999999999', v.kind, v.name, true, v.ordem, v.metadata::jsonb
  FROM (VALUES
    ('crm_status', 'Novo contato', 1, '{"color": "navy", "stage": "novos"}'),
    ('crm_status', 'Aguardando atendimento', 2, '{"color": "warning", "stage": "novos"}'),
    ('crm_status', 'Em atendimento', 3, '{"color": "teal", "stage": "atendimento"}'),
    ('crm_status', 'Em negociação', 4, '{"color": "teal", "stage": "negociacao"}'),
    ('crm_status', 'Orçamento enviado', 5, '{"color": "warning", "stage": "orcamento"}'),
    ('crm_status', 'Aguardando resposta', 6, '{"color": "warning", "stage": "aguardando"}'),
    ('crm_status', 'Não respondeu / Repescar', 7, '{"color": "danger", "stage": "repescar"}'),
    ('crm_status', 'Agendado', 8, '{"color": "success", "stage": "agendados", "closed": true}'),
    ('crm_status', 'Desistiu', 9, '{"lost": true, "color": "danger", "stage": "desistiram", "closed": true}'),
    ('crm_status', 'Pós-venda', 10, '{"color": "success", "stage": "agendados", "closed": true}'),
    ('sales_origin', 'Google Ads – landing', 1, '{"codigo": "google_ads_landing", "palavras": []}'),
    ('sales_origin', 'Google', 2, '{"codigo": "google", "palavras": ["vim pelo google", "pelo google", "google"]}'),
    ('sales_origin', 'Google Ads – botão WhatsApp', 3, '{"codigo": "google_ads_whatsapp", "palavras": []}'),
    ('sales_origin', 'Instagram', 4, '{"codigo": "instagram", "palavras": ["instagram"]}'),
    ('sales_origin', 'Facebook', 5, '{"codigo": "facebook", "palavras": ["facebook"]}'),
    ('sales_origin', 'Indicação', 6, '{"codigo": "indicacao", "palavras": ["indicação", "me indicou", "me indicaram", "indicado por", "indicada por", "indicaram vocês", "indicou vocês"]}'),
    ('sales_origin', 'Blog', 7, '{"codigo": "blog", "palavras": ["blog"]}'),
    ('sales_origin', 'Site (orgânico)', 8, '{"codigo": "site", "palavras": []}'),
    ('sales_origin', 'Cliente existente / Recorrência', 9, '{"codigo": "cliente_existente", "palavras": []}'),
    ('sales_origin', 'WhatsApp campanha', 10, '{"codigo": "whatsapp_campanha", "palavras": []}'),
    ('sales_origin', 'Outra origem', 11, '{"codigo": "outra", "palavras": []}'),
    ('service_type', 'Higienização', 1, '{}'),
    ('service_type', 'Impermeabilização', 2, '{}'),
    ('crm_service_interest', 'Higienização', 1, '{}'),
    ('crm_service_interest', 'Impermeabilização', 2, '{}'),
    ('crm_service_interest', 'Higienização e impermeabilização', 3, '{}'),
    ('crm_service_interest', 'Não identificado', 4, '{}'),
    ('upholstery_type', 'Sofá retrátil', 1, '{}'),
    ('upholstery_type', 'Sofá fixo', 2, '{}'),
    ('upholstery_type', 'Poltrona', 3, '{}'),
    ('upholstery_type', 'Cadeira', 4, '{}'),
    ('upholstery_type', 'Colchão', 5, '{}'),
    ('upholstery_type', 'Cabeceira', 6, '{}'),
    ('upholstery_type', 'Tapete', 7, '{}'),
    ('upholstery_type', 'Banco automotivo', 8, '{}'),
    ('upholstery_type', 'Outros', 9, '{}'),
    ('payment_method', 'Pix', 1, '{}'),
    ('payment_method', 'Dinheiro', 2, '{}'),
    ('payment_method', 'Débito', 3, '{}'),
    ('payment_method', 'Crédito', 4, '{}'),
    ('payment_method', 'Transferência', 5, '{}'),
    ('payment_method', 'Link de pagamento', 6, '{}'),
    ('payment_channel', 'Pix direto', 1, '{}'),
    ('payment_channel', 'Dinheiro', 2, '{}'),
    ('payment_channel', 'Transferência', 3, '{}'),
    ('payment_channel', 'Maquininha', 4, '{}'),
    ('payment_channel', 'Link de pagamento', 5, '{}'),
    ('payment_channel', 'Outro', 6, '{}'),
    ('expense_category', 'Salários', 1, '{}'),
    ('expense_category', 'Marketing', 2, '{}'),
    ('expense_category', 'Veículo', 3, '{}'),
    ('expense_category', 'Contabilidade', 4, '{}'),
    ('expense_category', 'Sistemas', 5, '{}'),
    ('expense_category', 'Escritório', 6, '{}'),
    ('expense_category', 'Materiais', 7, '{}'),
    ('expense_category', 'Combustível', 8, '{}'),
    ('expense_category', 'Pedágio', 9, '{}'),
    ('expense_category', 'Estacionamento', 10, '{}'),
    ('expense_category', 'Manutenção', 11, '{}'),
    ('expense_category', 'Impostos', 12, '{}'),
    ('expense_category', 'Outros', 13, '{}'),
    ('crm_loss_reason', 'Preço', 1, '{}'),
    ('crm_loss_reason', 'Concorrente mais barato', 2, '{}'),
    ('crm_loss_reason', 'Não está na região atendida', 3, '{}'),
    ('crm_loss_reason', 'Serviço não compensou', 4, '{}'),
    ('crm_loss_reason', 'Comprará outro estofado', 5, '{}'),
    ('crm_loss_reason', 'Sem retorno', 6, '{}'),
    ('crm_loss_reason', 'Cancelou', 7, '{}'),
    ('crm_loss_reason', 'Não possui previsão', 8, '{}'),
    ('crm_loss_reason', 'Não precisa mais', 9, '{}'),
    ('crm_loss_reason', 'Outro', 10, '{}'),
    ('crm_followup_result', 'Aguardando resposta', 1, '{}'),
    ('crm_followup_result', 'Pediu mais tempo', 2, '{}'),
    ('crm_followup_result', 'Vai conversar com outra pessoa', 3, '{}'),
    ('crm_followup_result', 'Aguardando fotos', 4, '{}'),
    ('crm_followup_result', 'Achou o valor alto', 5, '{}'),
    ('crm_followup_result', 'Encontrou preço menor', 6, '{}'),
    ('crm_followup_result', 'Quer agendar', 7, '{}'),
    ('crm_followup_result', 'Sem interesse', 8, '{}'),
    ('crm_followup_result', 'Outro', 9, '{}'),
    ('adjustment_reason', 'Desconto comercial', 1, '{}'),
    ('adjustment_reason', 'Pacote de serviços', 2, '{}'),
    ('adjustment_reason', 'Negociação com o cliente', 3, '{}'),
    ('adjustment_reason', 'Arredondamento', 4, '{}'),
    ('adjustment_reason', 'Outro', 5, '{}'),
    ('recurrence_reason', 'Mancha retornou', 1, '{}'),
    ('recurrence_reason', 'Cliente insatisfeito', 2, '{}'),
    ('recurrence_reason', 'Falha no processo', 3, '{}'),
    ('recurrence_reason', 'Secagem inadequada', 4, '{}'),
    ('recurrence_reason', 'Uso indevido pelo cliente', 5, '{}'),
    ('recurrence_reason', 'Outro motivo', 6, '{}'),
    ('payment_reopen_reason', 'Forma de pagamento incorreta', 1, '{}'),
    ('payment_reopen_reason', 'Número de parcelas incorreto', 2, '{}'),
    ('payment_reopen_reason', 'Valor informado incorretamente', 3, '{}'),
    ('payment_reopen_reason', 'Pagamento ainda não confirmado', 4, '{}'),
    ('payment_reopen_reason', 'Estorno', 5, '{}'),
    ('payment_reopen_reason', 'Outro', 6, '{}')
  ) v(kind, name, ordem, metadata)
 WHERE NOT EXISTS (SELECT 1 FROM public.config_options o
                    WHERE o.empresa_id = '99999999-9999-4999-8999-999999999999');

INSERT INTO public.app_settings (empresa_id, key, value) VALUES
  ('99999999-9999-4999-8999-999999999999', 'message_template', to_jsonb(
    E'{{dia_da_semana}}, {{data}}, às {{horario}}\n\nOS {{numero_os}}\n{{nome_cliente}}\n\n{{descricao_estofado}}\n\nServiço: {{servico}}\n\nEndereço:\n{{endereco_completo}}\n\n{{INSTRUCAO_PAGAMENTO}}'::text)),
  ('99999999-9999-4999-8999-999999999999', 'invoice_message_template', to_jsonb(
    E'Nota fiscal — {{nome_cliente}}\nCPF/CNPJ: {{cpf_cnpj}}\nE-mail: {{email}}\nData do serviço: {{data_servico}}\nForma de pagamento: {{forma_pagamento}}\nValor: {{valor}}\nOS: {{numero_os}}'::text)),
  ('99999999-9999-4999-8999-999999999999', 'crm_novo_lead_apos_dias', '30')
ON CONFLICT (empresa_id, key) DO NOTHING;

UPDATE public.configuracoes_plataforma
   SET valor = '"99999999-9999-4999-8999-999999999999"', descricao = 'Empresa-modelo neutra: catálogos e mensagens padrão copiados para empresas novas'
 WHERE chave = 'empresa_modelo_id';
