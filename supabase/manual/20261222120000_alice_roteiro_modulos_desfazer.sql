-- Desfaz o roteiro por serviço (26/10/2026) na Turbine e no Modelo Nexa: volta o roteiro inteiro
-- guardado em app_settings (alice_roteiro_copia_20261026_modular) e esvazia os módulos. As colunas
-- novas ficam (vazias, sem efeito). Desliga o desconto do upsell da Turbine (volta o preço fixo).
UPDATE public.ia_configuracoes c
   SET instrucoes = s.value->>'instrucoes',
       modulos = '[]'::jsonb
  FROM public.app_settings s
 WHERE s.empresa_id = c.empresa_id
   AND s.key = 'alice_roteiro_copia_20261026_modular'
   AND c.empresa_id IN ('11111111-1111-1111-1111-111111111111', '99999999-9999-4999-8999-999999999999');
UPDATE public.conversas SET alice_modulos = '{}' WHERE alice_modulos <> '{}';
UPDATE public.orcamento_configuracoes SET desconto_upsell_ligado = false
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
