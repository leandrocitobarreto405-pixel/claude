-- Faixas das listas sem sobreposição: "até Y" inclui o dia Y e "de X" começa no dia X + 1.
-- Assim 90 dias fica só em "até 90 dias" (e não também em "de 90 a 365"), e 365 dias fica só em
-- "até 1 ano" / "de 91 dias a 1 ano" (e não também em "mais de 1 ano"). Vale para as listas, as
-- campanhas, a promoção e a planilha diária, que usam todas esta função.
CREATE OR REPLACE FUNCTION private.mkt_no_intervalo(_dias int, _f jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT _dias IS NOT NULL
     AND (_f ->> 'de' IS NULL OR _dias > (_f ->> 'de')::int)
     AND (_f ->> 'ate' IS NULL OR _dias <= (_f ->> 'ate')::int);
$$;
