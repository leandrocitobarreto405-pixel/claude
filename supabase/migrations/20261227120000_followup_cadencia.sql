-- Follow-up com cadência garantida pelo sistema (C/D, 27/10/2026). Só colunas e funções novas.
-- 1. crm_followups: trilha (A/B/C), etapa (A1..A5, B1..B4, A_FIM, B_FIM), canal (texto = a Alice
--    escreveu dentro da janela de 24 h; modelo = modelo aprovado da Meta; equipe = virou tarefa) e
--    modelo usado; respondido_em = o cliente respondeu depois deste toque (painel do follow-up).
-- 2. ia_configuracoes: cadencia_followup (a sequência é do sistema; liga para todas), followup_modelos
--    (fora da janela, manda o modelo aprovado; começa desligado, liga só na Turbine) e a oferta do
--    último follow-up (D2 16h; desligada, % ou R$).
-- 3. crm_leads: sem_desfecho_em e sem_desfecho_motivo (fim da cadência sem resposta; a aba
--    "Orçamentos sem desfecho" usa).
-- 4. Gatilho: mensagem do cliente marca respondido_em no último toque enviado (até 3 dias) e tira o
--    lead de "sem desfecho".

ALTER TABLE public.crm_followups
  ADD COLUMN IF NOT EXISTS trilha text CHECK (trilha IS NULL OR trilha IN ('A', 'B', 'C')),
  ADD COLUMN IF NOT EXISTS etapa text,
  ADD COLUMN IF NOT EXISTS canal text CHECK (canal IS NULL OR canal IN ('texto', 'modelo', 'equipe')),
  ADD COLUMN IF NOT EXISTS modelo text,
  ADD COLUMN IF NOT EXISTS respondido_em timestamptz;
CREATE INDEX IF NOT EXISTS idx_crm_followups_conversa_feito
  ON public.crm_followups (conversa_id, completed_at DESC) WHERE status = 'Concluída';

ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS cadencia_followup boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS followup_modelos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oferta_followup_ligada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS oferta_followup_tipo text NOT NULL DEFAULT 'pct'
    CHECK (oferta_followup_tipo IN ('pct', 'reais')),
  ADD COLUMN IF NOT EXISTS oferta_followup_valor numeric(10,2)
    CHECK (oferta_followup_valor IS NULL OR oferta_followup_valor > 0);

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS sem_desfecho_em timestamptz,
  ADD COLUMN IF NOT EXISTS sem_desfecho_motivo text;
CREATE INDEX IF NOT EXISTS idx_crm_leads_sem_desfecho
  ON public.crm_leads (empresa_id, sem_desfecho_em DESC) WHERE sem_desfecho_em IS NOT NULL;

CREATE OR REPLACE FUNCTION private.followup_respondido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.direction IS DISTINCT FROM 'Recebida' OR coalesce(NEW.privada, false) OR NEW.conversa_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Só o último toque enviado conta (e uma vez só).
  UPDATE public.crm_followups SET respondido_em = coalesce(NEW.message_timestamp, now())
   WHERE respondido_em IS NULL
     AND id = (SELECT f.id FROM public.crm_followups f
                WHERE f.conversa_id = NEW.conversa_id AND f.status = 'Concluída' AND f.etapa IS NOT NULL
                  AND f.completed_at >= coalesce(NEW.message_timestamp, now()) - interval '3 days'
                  AND f.completed_at <= coalesce(NEW.message_timestamp, now())
                ORDER BY f.completed_at DESC LIMIT 1);
  -- O cliente voltou: o lead sai de "Orçamentos sem desfecho".
  UPDATE public.crm_leads l SET sem_desfecho_em = NULL, sem_desfecho_motivo = NULL
    FROM public.conversas c
   WHERE c.id = NEW.conversa_id AND l.id = c.crm_lead_id AND l.sem_desfecho_em IS NOT NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.followup_respondido() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE TRIGGER trg_whatsapp_messages_followup_respondido
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION private.followup_respondido();

-- Turbine: modelos fora da janela ligados (só saem depois de aprovados pela Meta).
UPDATE public.ia_configuracoes SET followup_modelos = true
 WHERE empresa_id = '11111111-1111-1111-1111-111111111111';
