-- Script único (14/10/2026), Turbine: mensagem pronta da LP do colchão como origem Google e
-- correção dos leads que chegaram pelas LPs sem origem. Não sobrescreve lead que já tem origem.
-- Parâmetros: empresa e id da origem Google (config_options, kind sales_origin, codigo google).

INSERT INTO public.mensagens_origem (empresa_id, texto, sales_origin_id, servico, descricao, ativo)
VALUES ('11111111-1111-1111-1111-111111111111',
        'Olá, gostaria de um orçamento para higienização do meu colchão, por favor.',
        (SELECT id FROM public.config_options
          WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
            AND kind = 'sales_origin' AND metadata->>'codigo' = 'google'),
        'Higienização', 'LP do colchão (Google)', true);

-- Leads sem origem que vieram da LP do colchão (lp_origem ou texto pronto) ou têm clique com
-- gclid de qualquer LP (inclui o das LPs de higienização/impermeabilização, aprovado em 14/10).
UPDATE public.crm_leads l
   SET sales_origin_id = (SELECT id FROM public.config_options
                           WHERE empresa_id = l.empresa_id AND kind = 'sales_origin'
                             AND metadata->>'codigo' = 'google'),
       origem_automatica = true
 WHERE l.empresa_id = '11111111-1111-1111-1111-111111111111'
   AND l.sales_origin_id IS NULL
   AND (l.lp_origem = 'LP Colchão SP'
        OR EXISTS (SELECT 1 FROM public.ads_clicks a WHERE a.crm_lead_id = l.id AND a.gclid IS NOT NULL)
        OR EXISTS (SELECT 1 FROM public.whatsapp_messages m
                    WHERE m.crm_lead_id = l.id AND m.direction = 'Recebida'
                      AND position(private.texto_busca('Olá, gostaria de um orçamento para higienização do meu colchão, por favor.')
                                   IN private.texto_busca(coalesce(m.text_content, ''))) > 0));
