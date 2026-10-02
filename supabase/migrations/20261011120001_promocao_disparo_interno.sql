-- Promoção para agenda vazia (tipo de campanha) e trava do contato interno no disparo.
-- Continuação de 20261011120000_agenda_promocao_interno.sql (aprovado em 02/10/2026).

-- ================================================================ 3. promoção (tipo de campanha)
ALTER TABLE public.mkt_campanhas DROP CONSTRAINT mkt_campanhas_tipo_check;
ALTER TABLE public.mkt_campanhas ADD CONSTRAINT mkt_campanhas_tipo_check
  CHECK (tipo IN ('calendario', 'gatilho', 'promocao'));
-- Desconto extra no Pix da promoção ({{3}} do modelo). Campanha + Pix: até 25%.
ALTER TABLE public.mkt_campanhas
  ADD COLUMN IF NOT EXISTS desconto_pix_pct numeric(5,2) CHECK (desconto_pix_pct BETWEEN 0 AND 25);
ALTER TABLE public.mkt_campanhas ADD CONSTRAINT mkt_campanhas_desconto_total
  CHECK (coalesce(condicao_pct, 0) + coalesce(desconto_pix_pct, 0) <= 25);

-- Botão "Quero reservar" do modelo da promoção conta como interesse.
ALTER TABLE public.mkt_configuracoes ALTER COLUMN botoes SET DEFAULT '{
    "nao quero mais ofertas": "optout",
    "agora nao": "recusou",
    "ja resolvi": "recusou",
    "tive um problema": "problema",
    "ficou otimo": "elogio",
    "quero ver as datas": "interesse",
    "quero ver horarios": "interesse",
    "quero o valor": "interesse",
    "quero orcamento": "interesse",
    "quero reservar": "interesse"
  }';
UPDATE public.mkt_configuracoes SET botoes = botoes || '{"quero reservar": "interesse"}'
 WHERE NOT botoes ? 'quero reservar';

-- Cria a promoção já aprovada (o admin conferiu a lista e tocou em "Ativar"), com um lote e um
-- envio por pessoa. Quem saiu das ofertas, é contato interno ou não tem nome confiável fica de
-- fora. O envio só sai com "Envio ligado". Só o servidor chama (depois de conferir o admin).
CREATE OR REPLACE FUNCTION public.mkt_criar_promocao(_emp uuid, _usuario uuid, _contatos jsonb,
  _desconto numeric, _pix numeric, _template text, _hoje date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  hoje date := coalesce(_hoje, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  cfg public.mkt_configuracoes;
  r jsonb;
  fone text;
  campanha uuid;
  lote uuid;
  total int;
BEGIN
  IF jsonb_typeof(_contatos) <> 'array' OR jsonb_array_length(_contatos) = 0 THEN
    RAISE EXCEPTION 'Nenhum contato para a promoção' USING ERRCODE = '22023';
  END IF;
  IF _desconto IS NULL OR _desconto < 1 OR coalesce(_pix, 0) < 0 OR _desconto + coalesce(_pix, 0) > 25 THEN
    RAISE EXCEPTION 'Desconto inválido (promoção + Pix até 25%%)' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(_template, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o modelo da promoção' USING ERRCODE = '22023';
  END IF;
  cfg := private.mkt_config(_emp);

  FOR r IN SELECT * FROM jsonb_array_elements(_contatos) LOOP
    fone := private.normalizar_telefone(r->>'telefone');
    CONTINUE WHEN fone IS NULL OR fone !~ '^55[1-9][0-9][0-9]{8,9}$';
    PERFORM private.mkt_upsert_contato(_emp, fone, left(r->>'nome', 120), 'nao_comprador', NULL, NULL,
      now(), NULL, 'promocao');
  END LOOP;

  INSERT INTO public.mkt_campanhas (empresa_id, nome, tipo, mes_ref, tema, template_nome, datas_disparo,
    condicao_texto, condicao_pct, desconto_pix_pct, status, aprovada_em, aprovada_por)
  VALUES (_emp, 'Promoção agenda ' || to_char(hoje, 'DD/MM'), 'promocao', date_trunc('month', hoje)::date,
    'promocao_agenda', btrim(_template), ARRAY[hoje], replace(trim_scale(_desconto)::text, '.', ',') || '%',
    _desconto, coalesce(_pix, 0), 'aprovada', now(), _usuario)
  RETURNING id INTO campanha;
  INSERT INTO public.mkt_lotes (empresa_id, campanha_id, numero, etiqueta_chatwoot, data_prevista, status)
  VALUES (_emp, campanha, 1, 'promo-' || to_char(hoje, 'YYYYMMDD'), hoje, 'aprovado')
  RETURNING id INTO lote;

  WITH pessoas AS (
    SELECT DISTINCT ON (c.id) c.id, c.normalized_phone
      FROM jsonb_array_elements(_contatos) x
      JOIN public.mkt_contatos c
        ON c.empresa_id = _emp
       AND private.telefone_chave(c.normalized_phone)
           = private.telefone_chave(private.normalizar_telefone(x->>'telefone'))
     WHERE c.optout_em IS NULL
       AND nullif(btrim(coalesce(c.primeiro_nome, '')), '') IS NOT NULL
       AND NOT private.contato_interno(_emp, c.normalized_phone)
  ), numerados AS (
    SELECT p.*, row_number() OVER (ORDER BY p.id) AS n FROM pessoas p
  )
  INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, grupo,
    template_nome, ordem, agendado_para)
  SELECT _emp, campanha, lote, n.id, n.normalized_phone, 'PROMO', btrim(_template), n.n,
         now() + ((n.n - 1) * cfg.intervalo_segundos) * interval '1 second'
    FROM numerados n;
  GET DIAGNOSTICS total = ROW_COUNT;
  IF total = 0 THEN
    RAISE EXCEPTION 'Ninguém da lista pode receber (opt-out, contato interno ou sem nome)'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.mkt_lotes SET quantidade = total WHERE id = lote;
  UPDATE public.mkt_campanhas SET estimativa = jsonb_build_object('total', total), preparada_em = now()
   WHERE id = campanha;
  PERFORM private.mkt_log(_emp, 'promocao', 'criada',
    jsonb_build_object('envios', total, 'pedidos', jsonb_array_length(_contatos)), campanha, lote);
  RETURN jsonb_build_object('campanha', campanha, 'envios', total,
    'ignorados', jsonb_array_length(_contatos) - total);
END $$;
REVOKE ALL ON FUNCTION public.mkt_criar_promocao(uuid, uuid, jsonb, numeric, numeric, text, date)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mkt_criar_promocao(uuid, uuid, jsonb, numeric, numeric, text, date)
  TO service_role;

-- ================================================================ 4. disparo: interno e promoção
-- Reserva: cancela envios para contato interno; a promoção sai em qualquer dia, a partir das 9h,
-- só com "Envio ligado".
CREATE OR REPLACE FUNCTION public.mkt_reservar_envios(_limite int, _agora timestamptz DEFAULT NULL)
RETURNS TABLE (
  envio_id uuid, empresa_id uuid, campanha_id uuid, lote_id uuid, contato_id uuid,
  normalized_phone text, nome text, primeiro_nome text, template_nome text, variante_sn boolean,
  idioma text, condicao_texto text, condicao_pct numeric, etiqueta text, grupo text,
  whatsapp_contact_id uuid, chatwoot_contact_id bigint, conversa_chatwoot_id bigint, conversa_status text
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
     WHERE e.status = 'pendente' AND e.agendado_para <= agora
       AND l.status IN ('aprovado', 'enviando')
       AND hora < cfg.hora_limite
       AND ((k.tipo = 'calendario' AND k.status IN ('aprovada', 'enviando') AND cfg.disparo_ligado
             AND dia IN (2, 3, 4) AND hora >= cfg.hora_disparo)
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
END $$;

-- Conferência antes de cada mensagem: contato interno é cancelado; promoção segue a chave geral.
CREATE OR REPLACE FUNCTION public.mkt_confirmar_envio(_envio uuid, _agora timestamptz DEFAULT NULL)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.mkt_envios;
  hora int := extract(hour FROM coalesce(_agora, now()) AT TIME ZONE 'America/Sao_Paulo')::int;
  pode boolean;
BEGIN
  SELECT * INTO e FROM public.mkt_envios WHERE id = _envio FOR UPDATE;
  IF e.id IS NULL OR e.status <> 'enviando' THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM public.mkt_contatos WHERE id = e.contato_id AND optout_em IS NOT NULL) THEN
    UPDATE public.mkt_envios SET status = 'cancelado', erro = 'opt-out' WHERE id = e.id;
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.mkt_contatos WHERE id = e.contato_id
              AND private.contato_interno(empresa_id, normalized_phone)) THEN
    UPDATE public.mkt_envios SET status = 'cancelado', erro = 'contato interno da equipe' WHERE id = e.id;
    RETURN false;
  END IF;
  SELECT l.status = 'enviando' AND hora >= 8 AND hora < 21 AND hora < cfg.hora_limite
         AND ((k.tipo IN ('calendario', 'promocao') AND k.status = 'enviando' AND cfg.disparo_ligado)
           OR (k.tipo = 'gatilho' AND ((k.gatilho = 'C1' AND cfg.gatilho_c1_ligado)
                                    OR (k.gatilho = 'C2' AND cfg.gatilho_c2_ligado)
                                    OR (k.gatilho IN ('C3', 'C3L') AND cfg.gatilho_c3_ligado))))
    INTO pode
    FROM public.mkt_lotes l
    JOIN public.mkt_campanhas k ON k.id = l.campanha_id
    JOIN public.mkt_configuracoes cfg ON cfg.empresa_id = k.empresa_id
   WHERE l.id = e.lote_id;
  IF coalesce(pode, false) THEN RETURN true; END IF;
  UPDATE public.mkt_envios SET status = 'pendente', reservado_em = NULL WHERE id = e.id;
  RETURN false;
END $$;
