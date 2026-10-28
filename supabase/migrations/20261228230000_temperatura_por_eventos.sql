-- Temperatura por eventos (29/10, item 5): Quente, Morno e Frio pela regra; a IA só desempata.
-- 1) crm_leads.temperature passa a aceitar MORNO (antes era texto livre com QUENTE/FRIO).
-- 2) temperatura_ia: a sugestão da IA (análise da conversa ou ferramenta da Alice), usada só
--    quando nenhuma regra decide. Começa com a temperatura de hoje.
-- 3) temperatura_motivo: por que o lead está com essa temperatura (aparece ao passar o dedo).
-- 4) retorno_combinado_em: retorno pendente com data (trilha C ou tarefa da equipe); a tela mostra
--    o selo "Retorno combinado (dd/mm)" no lugar da temperatura.
-- 5) contexto_classe/contexto_lido_em: leitura de contexto da última resposta do cliente (mesmo
--    classificador dos toques). "Fechou com outra", "não quer" etc. não viram Quente.
-- 6) crm_recalcular_temperaturas(): roda na varredura (5–10 min). Só leads abertos, sem OS, não
--    perdidos e sem temperatura confirmada à mão. Grava só o que mudou e não mexe no updated_at.
ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS temperatura_ia text CHECK (temperatura_ia IN ('QUENTE', 'MORNO', 'FRIO')),
  ADD COLUMN IF NOT EXISTS temperatura_motivo text CHECK (length(temperatura_motivo) <= 160),
  ADD COLUMN IF NOT EXISTS retorno_combinado_em timestamptz,
  ADD COLUMN IF NOT EXISTS contexto_classe text CHECK (contexto_classe IN
    ('segue', 'fechou_outra', 'mais_barato', 'ja_fez', 'nao_quer', 'pediu_parar')),
  ADD COLUMN IF NOT EXISTS contexto_lido_em timestamptz;

ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_temperature_valores;
ALTER TABLE public.crm_leads ADD CONSTRAINT crm_leads_temperature_valores
  CHECK (temperature IN ('QUENTE', 'MORNO', 'FRIO'));

-- Mudança só nas colunas da temperatura não conta como "atualizado" (o updated_at desempata
-- leads do mesmo telefone no marketing). Roda depois de trg_crm_leads_upd (ordem alfabética).
CREATE OR REPLACE FUNCTION private.crm_leads_temperatura_sem_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  cols text[] := ARRAY['temperature', 'temperatura_ia', 'temperatura_motivo', 'retorno_combinado_em',
                       'contexto_classe', 'contexto_lido_em', 'updated_at'];
BEGIN
  IF (to_jsonb(NEW) - cols) = (to_jsonb(OLD) - cols) THEN
    NEW.updated_at := OLD.updated_at;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.crm_leads_temperatura_sem_updated_at() FROM PUBLIC, anon;
DROP TRIGGER IF EXISTS trg_crm_leads_upd_temperatura ON public.crm_leads;
CREATE TRIGGER trg_crm_leads_upd_temperatura BEFORE UPDATE ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION private.crm_leads_temperatura_sem_updated_at();

UPDATE public.crm_leads SET temperatura_ia = temperature
 WHERE temperatura_ia IS NULL AND temperature IN ('QUENTE', 'MORNO', 'FRIO');

-- A regra, lead a lead (a ordem importa: a primeira que bate decide).
CREATE OR REPLACE FUNCTION private.crm_temperatura_calculada()
RETURNS TABLE (lead_id uuid, temperatura text, motivo text, retorno timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH base AS (
    SELECT l.id, l.temperatura_ia, l.temperature, l.orcamento_enviado_em, l.data_desejada,
           l.sem_desfecho_em, l.sem_desfecho_sugerido, l.created_at, l.contexto_classe,
           l.contexto_lido_em,
           (SELECT min(f.scheduled_at) FROM public.crm_followups f
             WHERE f.crm_lead_id = l.id AND f.status = 'Pendente'
               AND (f.trilha = 'C' OR f.responsavel = 'equipe')) AS retorno,
           (SELECT max(m.message_timestamp) FROM public.whatsapp_messages m
             WHERE m.whatsapp_contact_id = l.whatsapp_contact_id AND m.direction = 'Recebida'
               AND m.privada = false) AS ultima_do_cliente
      FROM public.crm_leads l
     WHERE l.is_open AND l.linked_work_order_id IS NULL AND l.perdido_em IS NULL
       AND NOT l.temperature_confirmed
  ), sinais AS (
    SELECT b.*,
           coalesce(b.ultima_do_cliente, b.created_at) AS ultimo_sinal,
           b.orcamento_enviado_em IS NOT NULL AND b.ultima_do_cliente > b.orcamento_enviado_em
             AND b.ultima_do_cliente > now() - interval '48 hours' AS respondeu,
           -- Contexto negativo: o classificador leu a última resposta e não deu "segue", ou um
           -- toque foi cancelado pelo contexto depois dela, ou a Alice sugeriu um motivo de perda.
           (b.contexto_classe IS NOT NULL AND b.contexto_classe <> 'segue'
              AND b.contexto_lido_em >= coalesce(b.ultima_do_cliente, b.created_at))
           OR b.sem_desfecho_sugerido IS NOT NULL
           OR EXISTS (SELECT 1 FROM public.crm_followups f
                       WHERE f.crm_lead_id = b.id AND f.status = 'Cancelada'
                         AND f.result ILIKE 'contexto:%'
                         AND f.updated_at >= coalesce(b.ultima_do_cliente, b.created_at))
             AS contexto_negativo
      FROM base b
  )
  SELECT s.id,
    CASE
      WHEN s.retorno IS NOT NULL AND s.retorno <= now() + interval '7 days' THEN 'QUENTE'
      WHEN s.retorno IS NOT NULL THEN 'MORNO'
      WHEN s.contexto_negativo THEN 'FRIO'
      WHEN s.respondeu THEN 'QUENTE'
      WHEN s.data_desejada >= (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'QUENTE'
      WHEN s.sem_desfecho_em IS NOT NULL THEN 'FRIO'
      WHEN s.ultimo_sinal < now() - interval '10 days' THEN 'FRIO'
      WHEN s.orcamento_enviado_em IS NOT NULL AND s.ultimo_sinal <= s.orcamento_enviado_em
           AND s.orcamento_enviado_em < now() - interval '2 days'
           AND s.orcamento_enviado_em >= now() - interval '7 days' THEN 'MORNO'
      WHEN s.orcamento_enviado_em IS NULL AND s.ultimo_sinal < now() - interval '2 days' THEN 'FRIO'
      ELSE coalesce(s.temperatura_ia, 'FRIO')
    END,
    CASE
      WHEN s.retorno IS NOT NULL AND s.retorno < now() THEN 'Retorno combinado vencido'
      WHEN s.retorno IS NOT NULL AND s.retorno <= now() + interval '7 days' THEN 'Retorno combinado em até 7 dias'
      WHEN s.retorno IS NOT NULL THEN 'Retorno combinado daqui a mais de 7 dias'
      WHEN s.contexto_negativo THEN 'Cliente disse que fechou com outra empresa, desistiu ou já fez'
      WHEN s.respondeu THEN 'Respondeu nas últimas 48 h depois do orçamento'
      WHEN s.data_desejada >= (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN 'Pediu uma data'
      WHEN s.sem_desfecho_em IS NOT NULL THEN 'Terminou os follow-ups sem desfecho'
      WHEN s.ultimo_sinal < now() - interval '10 days' THEN 'Mais de 10 dias em silêncio'
      WHEN s.orcamento_enviado_em IS NOT NULL AND s.ultimo_sinal <= s.orcamento_enviado_em
           AND s.orcamento_enviado_em < now() - interval '2 days'
           AND s.orcamento_enviado_em >= now() - interval '7 days' THEN 'Orçamento sem resposta há 2 a 7 dias'
      WHEN s.orcamento_enviado_em IS NULL AND s.ultimo_sinal < now() - interval '2 days' THEN 'Ficou sem orçamento'
      ELSE 'IA: leitura da conversa'
    END,
    s.retorno
  FROM sinais s;
$$;
REVOKE ALL ON FUNCTION private.crm_temperatura_calculada() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.crm_recalcular_temperaturas()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n integer;
  limpos integer;
BEGIN
  UPDATE public.crm_leads l
     SET temperature = c.temperatura, temperatura_motivo = c.motivo, retorno_combinado_em = c.retorno
    FROM private.crm_temperatura_calculada() c
   WHERE l.id = c.lead_id
     AND (l.temperature IS DISTINCT FROM c.temperatura
          OR l.temperatura_motivo IS DISTINCT FROM c.motivo
          OR l.retorno_combinado_em IS DISTINCT FROM c.retorno);
  GET DIAGNOSTICS n = ROW_COUNT;
  -- Lead fechado (OS, perdido) ou confirmado à mão: sai o selo do retorno.
  UPDATE public.crm_leads l SET retorno_combinado_em = NULL
   WHERE l.retorno_combinado_em IS NOT NULL
     AND NOT (l.is_open AND l.linked_work_order_id IS NULL AND l.perdido_em IS NULL
              AND NOT l.temperature_confirmed);
  GET DIAGNOSTICS limpos = ROW_COUNT;
  RETURN n + limpos;
END $$;
REVOKE ALL ON FUNCTION public.crm_recalcular_temperaturas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_recalcular_temperaturas() TO service_role;

-- Quem respondeu depois do orçamento nas últimas 48 h e ainda não teve a resposta lida pelo
-- classificador de contexto (só empresas com a Alice ligada; a leitura usa a IA barata).
CREATE OR REPLACE FUNCTION public.crm_temperatura_para_ler_contexto(_limite integer DEFAULT 20)
RETURNS TABLE (lead_id uuid, empresa_id uuid, whatsapp_contact_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT l.id, l.empresa_id, l.whatsapp_contact_id
    FROM public.crm_leads l
    JOIN public.ia_configuracoes c ON c.empresa_id = l.empresa_id AND c.ativo
    CROSS JOIN LATERAL (
      SELECT max(m.message_timestamp) AS ultima FROM public.whatsapp_messages m
       WHERE m.whatsapp_contact_id = l.whatsapp_contact_id AND m.direction = 'Recebida'
         AND m.privada = false
    ) u
   WHERE l.is_open AND l.linked_work_order_id IS NULL AND l.perdido_em IS NULL
     AND NOT l.temperature_confirmed AND l.whatsapp_contact_id IS NOT NULL
     AND l.orcamento_enviado_em IS NOT NULL
     AND u.ultima > l.orcamento_enviado_em AND u.ultima > now() - interval '48 hours'
     AND (l.contexto_lido_em IS NULL OR l.contexto_lido_em < u.ultima)
   ORDER BY u.ultima
   LIMIT greatest(1, least(_limite, 100));
$$;
REVOKE ALL ON FUNCTION public.crm_temperatura_para_ler_contexto(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_temperatura_para_ler_contexto(integer) TO service_role;
