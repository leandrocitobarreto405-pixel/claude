-- Google Ads: a landing do colchão (turbinecleancolchao.lovable.app) não estava liberada, então o
-- navegador recusava o envio no pré-voo (CORS) e os pop-ups dessa página não entravam em
-- ads_clicks. Libera o domínio para a Turbine Clean. O serviço vem do próprio envio da landing
-- ("higienizacao"); ads_dominios só guarda o domínio e a empresa.
INSERT INTO public.ads_dominios (dominio, empresa_id)
SELECT 'turbinecleancolchao.lovable.app', id
  FROM public.empresas
 WHERE id = '11111111-1111-1111-1111-111111111111'
ON CONFLICT (dominio) DO NOTHING;
