-- O Supabase roda as chamadas do PostgREST com a extensão safeupdate, que recusa DELETE sem
-- WHERE (mesmo dentro de função). O motor de grupos, o preparo de campanha e os gatilhos limpavam
-- as tabelas temporárias com "DELETE FROM mkt_x;" e falhavam com 400 ("DELETE requires a WHERE
-- clause"). Troca só essas linhas por "DELETE FROM mkt_x WHERE true;", mantendo o resto da função.
DO $$
DECLARE
  f regprocedure;
  def text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.mkt_calcular_grupos(uuid, date)'::regprocedure,
    'public.mkt_preparar_campanha(uuid, date)'::regprocedure,
    'public.mkt_gerar_gatilhos(uuid, date)'::regprocedure
  ] LOOP
    def := pg_get_functiondef(f);
    def := replace(def, 'DELETE FROM mkt_calc;', 'DELETE FROM mkt_calc WHERE true;');
    def := replace(def, 'DELETE FROM mkt_sel;', 'DELETE FROM mkt_sel WHERE true;');
    def := replace(def, 'DELETE FROM mkt_gat;', 'DELETE FROM mkt_gat WHERE true;');
    IF def ~ 'DELETE FROM mkt_(calc|sel|gat);' THEN
      RAISE EXCEPTION 'não consegui corrigir %', f;
    END IF;
    EXECUTE def;
  END LOOP;
END $$;
