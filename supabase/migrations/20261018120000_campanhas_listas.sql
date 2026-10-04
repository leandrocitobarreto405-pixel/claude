-- Campanhas pelas listas (parte 1): listas da campanha, limite de marketing na reserva e
-- aprovação dos lembretes do dia. A preparação da campanha e a geração dos lembretes ficam na
-- parte 2 (o Supabase pede confirmação para aplicar funções que apagam dados temporários).
--
-- Listas da campanha: cada item é uma faixa de uma lista ("segmento"), com um código interno que
-- nunca aparece na tela e escolhe o modelo da mensagem:
--   N1 orçamento até 90 dias · N2 orçamento de 90 dias a 1 ano · N3 orçamento com mais de 1 ano
--   C4 clientes de 90 dias a 1 ano · C5 clientes com mais de 1 ano
--   (quem cai em duas faixas, como no dia 90, fica só no primeiro segmento da campanha)
--   CV conversou e não pediu orçamento · PP perdido por preço
-- Ex.: [{"grupo": "N1", "familia": "orcamento", "ate": 90}, {"grupo": "C5", "familia": "clientes", "de": 365}]

-- ================================================================ 1. campos
ALTER TABLE public.mkt_campanhas ADD COLUMN IF NOT EXISTS listas jsonb;
COMMENT ON COLUMN public.mkt_campanhas.listas IS
  'Listas da campanha (segmentos com grupo, familia, de, ate). Sem listas = grupos antigos.';

-- (O status "aguardando_aprovacao" do lote entra na parte 2, junto com a geração dos lembretes.)

-- ================================================================ 2. segmentos
-- Segmento padrão de cada grupo antigo (para os rascunhos e campanhas sem listas).
CREATE OR REPLACE FUNCTION private.mkt_segmento_do_grupo(_grupo text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE _grupo
    WHEN 'N1' THEN '{"grupo": "N1", "familia": "orcamento", "ate": 90}'::jsonb
    WHEN 'N2' THEN '{"grupo": "N2", "familia": "orcamento", "de": 90, "ate": 365}'::jsonb
    WHEN 'N3' THEN '{"grupo": "N3", "familia": "orcamento", "de": 365}'::jsonb
    WHEN 'C4' THEN '{"grupo": "C4", "familia": "clientes", "de": 90, "ate": 365}'::jsonb
    WHEN 'C5' THEN '{"grupo": "C5", "familia": "clientes", "de": 365}'::jsonb
    WHEN 'CV' THEN '{"grupo": "CV", "familia": "conversa"}'::jsonb
    WHEN 'PP' THEN '{"grupo": "PP", "familia": "perdido_preco"}'::jsonb
  END;
$$;

-- Listas de uma campanha: as gravadas ou, sem elas, as dos grupos antigos (na ordem de prioridade).
CREATE OR REPLACE FUNCTION private.mkt_listas_da_campanha(_listas jsonb, _grupos text[])
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN jsonb_typeof(_listas) = 'array' AND jsonb_array_length(_listas) > 0 THEN _listas
    ELSE coalesce((
      SELECT jsonb_agg(private.mkt_segmento_do_grupo(g) ORDER BY array_position(
               ARRAY['C4', 'C5', 'N1', 'N2', 'N3', 'CV', 'PP'], g))
        FROM unnest(coalesce(_grupos, '{}')) g
       WHERE private.mkt_segmento_do_grupo(g) IS NOT NULL), '[]'::jsonb)
  END;
$$;

-- Os 12 rascunhos ganham as listas equivalentes aos grupos de hoje.
UPDATE public.mkt_campanhas
   SET listas = private.mkt_listas_da_campanha(NULL, grupos)
 WHERE tipo = 'calendario' AND listas IS NULL AND status = 'rascunho';

-- ================================================================ 3. contagem das listas da campanha
-- Quantos estão em cada segmento e quantos podem receber agora (opt-out, interno, sem pós-venda,
-- serviço marcado e limite de marketing já tirados). Só admin e atendente da empresa ativa.
CREATE OR REPLACE FUNCTION public.mkt_campanha_contagem(_campanha uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH emp AS (SELECT private.mkt_empresa_marketing() AS id),
  k AS (
    SELECT c.* FROM public.mkt_campanhas c, emp WHERE c.id = _campanha AND c.empresa_id = emp.id
  ), segs AS (
    SELECT s.value AS seg, s.ord
      FROM k, jsonb_array_elements(private.mkt_listas_da_campanha(k.listas, k.grupos)) WITH ORDINALITY s(value, ord)
  ), d AS MATERIALIZED (
    SELECT x.*, private.mkt_motivo_fora(false, private.mkt_limite_marketing(emp.id), x.optout, x.interno,
             x.sem_pos_venda, x.agendado_para, x.primeiro_nome, x.ultimo_marketing_em) IS NULL
             AND x.agendado_para IS NULL AS pode
      FROM emp, private.mkt_listas_dados(emp.id, NULL) x
      WHERE EXISTS (SELECT 1 FROM k)
  ), c AS (
    SELECT s.seg ->> 'grupo' AS grupo, s.ord, count(d.contato_id) AS total,
           count(d.contato_id) FILTER (WHERE d.pode) AS podem
      FROM segs s
      LEFT JOIN d ON cardinality(private.mkt_familias(
                       jsonb_build_object(s.seg ->> 'familia', s.seg - 'grupo' - 'familia'),
                       d.em_orcamento, d.dias_orcamento, d.em_conversa, d.dias_conversa, d.dias_cliente,
                       d.perdido_preco_em, d.agendado_para)) > 0
     GROUP BY s.seg, s.ord
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('grupo', grupo, 'total', total, 'podem', podem) ORDER BY ord),
                  '[]'::jsonb)
    FROM c;
$$;
REVOKE ALL ON FUNCTION public.mkt_campanha_contagem(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mkt_campanha_contagem(uuid) TO authenticated, service_role;

-- ================================================================ 4. aprovação dos lembretes do dia
-- Aprovar: o lote sai a partir de agora (9h no mínimo), no intervalo da empresa.
-- Não enviar: os envios do lote são cancelados. Só pela chave de serviço (o servidor confere
-- antes que o lote é da empresa ativa e que quem pede é admin).
CREATE OR REPLACE FUNCTION public.mkt_decidir_lembretes(_lote uuid, _aprovar boolean, _usuario uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  l public.mkt_lotes;
  cfg public.mkt_configuracoes;
  inicio timestamptz;
  n int;
BEGIN
  SELECT * INTO l FROM public.mkt_lotes WHERE id = _lote FOR UPDATE;
  IF l.id IS NULL OR l.status <> 'aguardando_aprovacao' THEN
    RAISE EXCEPTION 'Esses lembretes não estão esperando aprovação.' USING ERRCODE = '22023';
  END IF;
  cfg := private.mkt_config(l.empresa_id);
  IF _aprovar THEN
    inicio := greatest(now(), (((now() AT TIME ZONE 'America/Sao_Paulo')::date + time '09:00')::timestamp
                               AT TIME ZONE 'America/Sao_Paulo'));
    UPDATE public.mkt_envios e
       SET agendado_para = inicio + make_interval(secs => (x.n - 1)::int * cfg.intervalo_segundos)
      FROM (SELECT id, row_number() OVER (ORDER BY ordem, id) AS n FROM public.mkt_envios
             WHERE lote_id = l.id AND status = 'pendente') x
     WHERE e.id = x.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.mkt_lotes SET status = 'aprovado' WHERE id = l.id;
  ELSE
    UPDATE public.mkt_envios SET status = 'cancelado', erro = 'lembrete não aprovado'
     WHERE lote_id = l.id AND status = 'pendente';
    GET DIAGNOSTICS n = ROW_COUNT;
    UPDATE public.mkt_lotes SET status = 'cancelado' WHERE id = l.id;
  END IF;
  UPDATE public.mkt_avisos SET lido_em = coalesce(lido_em, now())
   WHERE lote_id = l.id AND tipo = 'lembretes_aprovacao';
  PERFORM private.mkt_log(l.empresa_id, 'gatilhos', CASE WHEN _aprovar THEN 'lote_aprovado' ELSE 'lote_recusado' END,
    jsonb_build_object('envios', n, 'usuario', _usuario), l.campanha_id, l.id);
  RETURN jsonb_build_object('envios', n, 'aprovado', _aprovar);
END $$;
REVOKE ALL ON FUNCTION public.mkt_decidir_lembretes(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_decidir_lembretes(uuid, boolean, uuid) TO service_role;

-- ================================================================ 5. reserva com o limite de marketing
-- Igual à que estava em produção, mais: campanha e promoção não saem para quem recebeu outra
-- mensagem de marketing (campanha ou promoção) nos últimos N dias (limite_marketing_dias, padrão 30).
-- Lembretes (pós-venda, 6 meses, 13º mês) ficam fora do limite.
CREATE OR REPLACE FUNCTION public.mkt_reservar_envios(_limite integer, _agora timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(envio_id uuid, empresa_id uuid, campanha_id uuid, lote_id uuid, contato_id uuid, normalized_phone text, nome text, primeiro_nome text, template_nome text, variante_sn boolean, idioma text, condicao_texto text, condicao_pct numeric, etiqueta text, grupo text, whatsapp_contact_id uuid, chatwoot_contact_id bigint, conversa_chatwoot_id bigint, conversa_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  agora timestamptz := coalesce(_agora, now());
  hora int := extract(hour FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
  dia int := extract(isodow FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
BEGIN
  -- Quem saiu (opt-out) depois da preparação não recebe.
  UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'opt-out'
    FROM public.mkt_contatos c
   WHERE c.id = e.contato_id AND e.status IN ('pendente', 'manual') AND c.optout_em IS NOT NULL;
  -- Contato interno da equipe nunca recebe envio de cliente (campanha, gatilho ou promoção).
  UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'contato interno da equipe'
    FROM public.mkt_contatos c
   WHERE c.id = e.contato_id AND e.status IN ('pendente', 'manual')
     AND private.contato_interno(c.empresa_id, c.normalized_phone);
  -- Limite de marketing: recebeu outra campanha ou promoção há menos de N dias.
  UPDATE public.mkt_envios e
     SET status = 'cancelado',
         erro = 'limite de marketing: recebeu outra mensagem há menos de '
                || private.mkt_limite_marketing(e.empresa_id) || ' dias'
    FROM public.mkt_campanhas k
   WHERE k.id = e.campanha_id AND k.tipo IN ('calendario', 'promocao')
     AND e.status = 'pendente' AND e.agendado_para <= agora
     AND EXISTS (
       SELECT 1 FROM public.mkt_envios o JOIN public.mkt_campanhas ok ON ok.id = o.campanha_id
        WHERE o.contato_id = e.contato_id AND o.id <> e.id AND ok.tipo IN ('calendario', 'promocao')
          AND o.status IN ('enviado', 'enviando')
          AND coalesce(o.enviado_em, o.reservado_em)
              > agora - make_interval(days => private.mkt_limite_marketing(e.empresa_id)));
  -- Envio interrompido (servidor caiu no meio): não reenviar às cegas; fica como erro para conferir.
  UPDATE public.mkt_envios SET status = 'erro', erro = 'envio interrompido: confira no Chatwoot'
   WHERE status = 'enviando' AND reservado_em < now() - interval '15 minutes';

  IF hora < 8 OR hora >= 21 THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH escolhidos AS (
    SELECT e.id
      FROM public.mkt_envios e
      JOIN public.mkt_lotes l ON l.id = e.lote_id
      JOIN public.mkt_campanhas k ON k.id = e.campanha_id
      JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = e.empresa_id
      -- Empresa ainda em implantação não envia nada a clientes.
      JOIN public.empresas emp ON emp.id = e.empresa_id AND emp.implantacao_liberada_em IS NOT NULL
     WHERE e.status = 'pendente' AND e.agendado_para <= agora
       AND l.status IN ('aprovado', 'enviando')
       AND hora < cfg.hora_limite
       AND ((k.tipo = 'calendario' AND k.status IN ('aprovada', 'enviando') AND cfg.disparo_ligado
             AND dia = ANY (cfg.dias_disparo) AND hora >= cfg.hora_disparo)
         OR (k.tipo = 'promocao' AND k.status IN ('aprovada', 'enviando') AND cfg.disparo_ligado
             AND hora >= 9)
         OR (k.tipo = 'gatilho' AND hora >= 9
             AND ((k.gatilho = 'C1' AND cfg.gatilho_c1_ligado)
               OR (k.gatilho = 'C2' AND cfg.gatilho_c2_ligado)
               OR (k.gatilho IN ('C3', 'C3L') AND cfg.gatilho_c3_ligado))))
     ORDER BY e.agendado_para
     LIMIT greatest(_limite, 0)
     FOR UPDATE OF e SKIP LOCKED
  ), reservados AS (
    UPDATE public.mkt_envios e SET status = 'enviando', reservado_em = now()
      FROM escolhidos x WHERE e.id = x.id
    RETURNING e.*
  ), lotes AS (
    UPDATE public.mkt_lotes l SET status = 'enviando', iniciado_em = coalesce(l.iniciado_em, now())
     WHERE l.id IN (SELECT r.lote_id FROM reservados r) AND l.status = 'aprovado'
    RETURNING l.id
  ), campanhas AS (
    UPDATE public.mkt_campanhas k SET status = 'enviando'
     WHERE k.id IN (SELECT r.campanha_id FROM reservados r) AND k.status = 'aprovada'
    RETURNING k.id
  )
  SELECT r.id, r.empresa_id, r.campanha_id, r.lote_id, r.contato_id, c.normalized_phone, c.nome,
         c.primeiro_nome, r.template_nome, r.variante_sn, cfg.template_idioma, k.condicao_texto,
         k.condicao_pct, l.etiqueta_chatwoot, r.grupo, w.id, w.chatwoot_contact_id,
         cv.chatwoot_conversation_id, cv.status
    FROM reservados r
    JOIN public.mkt_contatos c ON c.id = r.contato_id
    JOIN public.mkt_campanhas k ON k.id = r.campanha_id
    JOIN public.mkt_lotes l ON l.id = r.lote_id
    JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = r.empresa_id
    LEFT JOIN LATERAL (
      SELECT wc.id, wc.chatwoot_contact_id FROM public.whatsapp_contacts wc
       WHERE wc.empresa_id = r.empresa_id
         AND private.telefone_chave(wc.normalized_phone) = private.telefone_chave(c.normalized_phone)
       ORDER BY wc.last_message_at DESC NULLS LAST LIMIT 1
    ) w ON true
    LEFT JOIN LATERAL (
      SELECT v.chatwoot_conversation_id, v.status FROM public.conversas v
       WHERE v.whatsapp_contact_id = w.id AND v.empresa_id = r.empresa_id
       ORDER BY v.ultima_atividade_em DESC NULLS LAST LIMIT 1
    ) cv ON true
   ORDER BY r.agendado_para;
END $function$;
