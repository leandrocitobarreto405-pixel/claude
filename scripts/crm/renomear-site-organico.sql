-- Script único (fase 2, aprovado), SÓ Turbine: o rótulo da origem "Site" vira "Site (orgânico)".
-- "Blog" fica. A Ecoprime não muda (pedido do dono). Idempotente.
UPDATE public.config_options
   SET name = 'Site (orgânico)'
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111'
   AND kind = 'sales_origin' AND name = 'Site'
RETURNING id, name;
