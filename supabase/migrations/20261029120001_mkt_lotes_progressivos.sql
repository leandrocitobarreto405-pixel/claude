-- Lotes progressivos (todas as empresas): depois de preparar, a campanha do calendário sai em
-- lotes crescentes, 100, 150 e 250 nos três primeiros dias e depois o tamanho da configuração
-- (lote_tamanho), para o número aquecer aos poucos. Nada é apagado: lote que sobrar fica
-- cancelado com quantidade zero. A ordem das pessoas não muda (quentes primeiro); só a divisão
-- por dia. As datas usam as do preparo, depois as da campanha e depois os próximos dias de
-- disparo. As datas da campanha passam a incluir as dos lotes (a condição da campanha vale até
-- o último disparo + 7 dias).
CREATE OR REPLACE FUNCTION public.mkt_escalonar_lotes(_campanha uuid, _rampa int[] DEFAULT '{100,150,250}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.mkt_campanhas;
  cfg public.mkt_configuracoes;
  total int;
  tamanhos int[] := '{}';
  resto int;
  i int := 1;
  n int;
  nl int;
  datas date[];
  d date;
  primeira date;
  v_estimativa jsonb;
BEGIN
  SELECT * INTO c FROM public.mkt_campanhas WHERE id = _campanha FOR UPDATE;
  IF c.id IS NULL OR c.tipo <> 'calendario' THEN
    RAISE EXCEPTION 'Campanha não encontrada.';
  END IF;
  IF c.status NOT IN ('rascunho', 'aguardando_aprovacao', 'bloqueada') THEN
    RAISE EXCEPTION 'A campanha já foi %; não dá para refazer os lotes.', c.status;
  END IF;
  cfg := private.mkt_config(c.empresa_id);
  SELECT count(*) INTO total FROM public.mkt_envios
   WHERE campanha_id = c.id AND status IN ('pendente', 'manual');
  SELECT min(data_prevista) INTO primeira FROM public.mkt_lotes WHERE campanha_id = c.id;
  IF total = 0 OR primeira IS NULL THEN
    RETURN c.estimativa;
  END IF;

  -- Tamanho de cada dia: a rampa e depois o lote da configuração (nunca maior que ele).
  resto := total;
  WHILE resto > 0 LOOP
    n := least(coalesce(_rampa[i], cfg.lote_tamanho), cfg.lote_tamanho, resto);
    tamanhos := tamanhos || n;
    resto := resto - n;
    i := i + 1;
  END LOOP;
  nl := array_length(tamanhos, 1);

  -- Dias: os do preparo e os da campanha (a partir do primeiro lote), depois os próximos dias.
  SELECT coalesce(array_agg(x ORDER BY x), '{}') INTO datas
    FROM (SELECT DISTINCT data_prevista AS x FROM public.mkt_lotes WHERE campanha_id = c.id
          UNION
          SELECT DISTINCT y FROM unnest(c.datas_disparo) y
           WHERE c.hora_inicio IS NOT NULL OR extract(isodow FROM y)::smallint = ANY (cfg.dias_disparo)) t
   WHERE x >= primeira;
  d := (SELECT max(x) FROM unnest(datas) x);
  WHILE coalesce(array_length(datas, 1), 0) < nl LOOP
    d := private.mkt_proximo_dia_util(d + 1, cfg.dias_disparo);
    datas := datas || d;
  END LOOP;

  -- Um lote por dia, com a etiqueta da campanha (como no preparo).
  FOR i IN 1..nl LOOP
    INSERT INTO public.mkt_lotes (empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, quantidade)
    VALUES (c.empresa_id, c.id, i,
            'camp-' || to_char(c.mes_ref, 'YYYY-MM') || '-' || left(c.id::text, 6) || '-l' || i,
            datas[i], tamanhos[i])
    ON CONFLICT (campanha_id, numero)
    DO UPDATE SET data_prevista = EXCLUDED.data_prevista, quantidade = EXCLUDED.quantidade,
                  status = 'preparado';
  END LOOP;
  UPDATE public.mkt_lotes SET quantidade = 0, status = 'cancelado'
   WHERE campanha_id = c.id AND numero > nl;

  -- Mesma ordem de antes (lote, posição), redistribuída pelos tamanhos novos.
  WITH ord AS (
    SELECT e.id, row_number() OVER (ORDER BY l.numero, e.ordem, e.id) - 1 AS pos
      FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id
     WHERE e.campanha_id = c.id AND e.status IN ('pendente', 'manual')
  ), faixas AS (
    SELECT u.i AS numero, sum(u.t) OVER (ORDER BY u.i) - u.t AS ini, sum(u.t) OVER (ORDER BY u.i) AS fim
      FROM unnest(tamanhos) WITH ORDINALITY AS u(t, i)
  ), alvo AS (
    SELECT o.id, f.numero, o.pos - f.ini AS posicao
      FROM ord o JOIN faixas f ON o.pos >= f.ini AND o.pos < f.fim
  )
  UPDATE public.mkt_envios e
     SET lote_id = l.id, ordem = a.posicao
    FROM alvo a JOIN public.mkt_lotes l ON l.campanha_id = c.id AND l.numero = a.numero
   WHERE e.id = a.id;

  v_estimativa := coalesce(c.estimativa, '{}'::jsonb) || jsonb_build_object(
    'lotes', nl,
    'datas', to_jsonb(datas[1:nl]),
    'rampa', to_jsonb(tamanhos),
    'ordem', coalesce((
      SELECT jsonb_agg(o.value || jsonb_build_object('primeiro_lote', g.l1, 'ultimo_lote', g.l2)
                       ORDER BY g.l1, o.ord)
        FROM jsonb_array_elements(coalesce(c.estimativa -> 'ordem', '[]'::jsonb)) WITH ORDINALITY o(value, ord)
        JOIN (SELECT e.grupo, min(l.numero) AS l1, max(l.numero) AS l2
                FROM public.mkt_envios e JOIN public.mkt_lotes l ON l.id = e.lote_id
               WHERE e.campanha_id = c.id AND e.status IN ('pendente', 'manual')
               GROUP BY e.grupo) g ON g.grupo = o.value ->> 'grupo'), '[]'::jsonb));
  UPDATE public.mkt_campanhas
     SET estimativa = v_estimativa,
         datas_disparo = (SELECT array_agg(DISTINCT x ORDER BY x)
                            FROM unnest(c.datas_disparo || datas[1:nl]) x)
   WHERE id = c.id;
  PERFORM private.mkt_log(c.empresa_id, 'campanha', 'lotes_progressivos',
    jsonb_build_object('tamanhos', tamanhos, 'datas', datas[1:nl]), c.id);
  RETURN v_estimativa;
END $$;
REVOKE ALL ON FUNCTION public.mkt_escalonar_lotes(uuid, int[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_escalonar_lotes(uuid, int[]) TO service_role;
