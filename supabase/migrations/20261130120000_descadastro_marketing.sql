-- Descadastro de marketing (aprovado em 22/10/2026).
-- 1. whatsapp_contacts.marketing_optout_em (+ origem, quem, confirmação da Alice): "não recebe
--    marketing". Fica sempre igual a mkt_contatos.optout_em, que campanhas, promoções, lembretes
--    e listas já respeitam, nos dois sentidos; contato novo na base de marketing já entra marcado.
-- 2. Gatilho novo em whatsapp_messages: reconhece o pedido de saída escrito pelo cliente, mesmo sem
--    campanha recente. O gatilho do botão (private.mkt_resposta) não muda.
-- 3. Listas e planilha: quem saiu do marketing não aparece mais (antes aparecia com o motivo
--    "saiu das ofertas").
-- 4. Pós-venda C1 (texto sem oferta) continua saindo para quem saiu do marketing.
-- 5. ia_configuracoes.descadastro_resposta: a Alice confirma uma vez ("Pronto, você não vai mais
--    receber nossas promoções 💙"). Começa desligado.
-- Atendimento, confirmação de véspera e pós-venda da Alice não olham nada disso.

-- ================================================================ 1. contato
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS marketing_optout_em timestamptz,
  ADD COLUMN IF NOT EXISTS marketing_optout_origem text
    CHECK (marketing_optout_origem IN ('cliente', 'marketing', 'equipe')),
  ADD COLUMN IF NOT EXISTS marketing_optout_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS marketing_optout_confirmado_em timestamptz;

ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS descadastro_resposta boolean NOT NULL DEFAULT false;

-- Envio do pós-venda C1: não é marketing, sai mesmo para quem saiu das ofertas.
CREATE OR REPLACE FUNCTION private.mkt_envio_pos_venda(_campanha uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.mkt_campanhas k
                  WHERE k.id = _campanha AND k.tipo = 'gatilho' AND k.gatilho = 'C1');
$$;
REVOKE ALL ON FUNCTION private.mkt_envio_pos_venda(uuid) FROM PUBLIC, anon, authenticated;

-- Contato do WhatsApp → base de marketing (e cancela o marketing pendente quando sai).
CREATE OR REPLACE FUNCTION private.mkt_optout_do_whatsapp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  chave text := private.telefone_chave(NEW.normalized_phone);
BEGIN
  IF chave IS NULL THEN RETURN NEW; END IF;
  UPDATE public.mkt_contatos c SET optout_em = NEW.marketing_optout_em
   WHERE c.empresa_id = NEW.empresa_id AND private.telefone_chave(c.normalized_phone) = chave
     AND c.optout_em IS DISTINCT FROM NEW.marketing_optout_em;
  IF NEW.marketing_optout_em IS NOT NULL AND OLD.marketing_optout_em IS NULL THEN
    UPDATE public.mkt_envios e SET status = 'cancelado', erro = 'opt-out'
      FROM public.mkt_contatos c
     WHERE c.id = e.contato_id AND c.empresa_id = NEW.empresa_id
       AND private.telefone_chave(c.normalized_phone) = chave
       AND e.status IN ('pendente', 'manual') AND NOT private.mkt_envio_pos_venda(e.campanha_id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_optout_do_whatsapp() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_whatsapp_contacts_marketing ON public.whatsapp_contacts;
CREATE TRIGGER trg_whatsapp_contacts_marketing
  AFTER UPDATE OF marketing_optout_em ON public.whatsapp_contacts
  FOR EACH ROW WHEN (OLD.marketing_optout_em IS DISTINCT FROM NEW.marketing_optout_em)
  EXECUTE FUNCTION private.mkt_optout_do_whatsapp();

-- Base de marketing → contato do WhatsApp (botão da campanha, bloqueio 131050, tela).
CREATE OR REPLACE FUNCTION private.mkt_optout_da_base()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.optout_em IS NULL THEN RETURN NEW; END IF;
  UPDATE public.whatsapp_contacts w
     SET marketing_optout_em = NEW.optout_em,
         marketing_optout_origem = CASE WHEN NEW.optout_em IS NULL THEN NULL
                                        ELSE coalesce(w.marketing_optout_origem, 'marketing') END,
         marketing_optout_por = CASE WHEN NEW.optout_em IS NULL THEN NULL ELSE w.marketing_optout_por END,
         marketing_optout_confirmado_em = CASE WHEN NEW.optout_em IS NULL THEN NULL
                                               ELSE w.marketing_optout_confirmado_em END
   WHERE w.empresa_id = NEW.empresa_id
     AND private.telefone_chave(w.normalized_phone) = private.telefone_chave(NEW.normalized_phone)
     AND w.marketing_optout_em IS DISTINCT FROM NEW.optout_em;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_optout_da_base() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mkt_contatos_optout ON public.mkt_contatos;
CREATE TRIGGER trg_mkt_contatos_optout
  AFTER INSERT OR UPDATE OF optout_em ON public.mkt_contatos
  FOR EACH ROW EXECUTE FUNCTION private.mkt_optout_da_base();

-- Contato que entra na base de marketing (importação, planilha) já vem marcado se pediu para sair.
-- Roda depois de trg_mkt_contatos_normalizar (ordem alfabética), com o telefone já normalizado.
CREATE OR REPLACE FUNCTION private.mkt_optout_ao_entrar()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.optout_em IS NULL THEN
    NEW.optout_em := (SELECT min(w.marketing_optout_em) FROM public.whatsapp_contacts w
                       WHERE w.empresa_id = NEW.empresa_id
                         AND private.telefone_chave(w.normalized_phone) = private.telefone_chave(NEW.normalized_phone));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_optout_ao_entrar() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mkt_contatos_optout_entrada ON public.mkt_contatos;
CREATE TRIGGER trg_mkt_contatos_optout_entrada
  BEFORE INSERT ON public.mkt_contatos
  FOR EACH ROW EXECUTE FUNCTION private.mkt_optout_ao_entrar();

-- Quem já saiu pelo botão (antes desta migração) fica marcado no contato do WhatsApp; a confirmação
-- conta como dada (a Alice já respondeu na época).
UPDATE public.whatsapp_contacts w
   SET marketing_optout_em = m.optout_em, marketing_optout_origem = 'marketing',
       marketing_optout_confirmado_em = m.optout_em
  FROM (SELECT c.empresa_id, private.telefone_chave(c.normalized_phone) AS chave, min(c.optout_em) AS optout_em
          FROM public.mkt_contatos c WHERE c.optout_em IS NOT NULL GROUP BY 1, 2) m
 WHERE w.empresa_id = m.empresa_id AND private.telefone_chave(w.normalized_phone) = m.chave
   AND w.marketing_optout_em IS NULL;

-- ================================================================ 2. pedido escrito pelo cliente
-- Mesmas regras de src/lib/descadastro.ts (pedidoDeSaida); os casos de teste são os mesmos.
CREATE OR REPLACE FUNCTION private.mkt_pedido_saida(_texto text, _campanha_recente boolean)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH t AS (SELECT private.texto_busca(_texto) AS t)
  SELECT t ~ ' (pare|para|parem|parar) de (me )?(mandar|enviar)'
      OR t ~ ' sair da (sua |sua s |vossa )?lista '
      OR t ~ ' (me )?(tira|tire|tirem|remove|remova|removam) (da|dessa|desta) lista '
      OR t ~ ' (me )?(tira|tire|tirem|remove|remova|removam) meu (numero|contato) '
      OR t ~ ' nao (me )?(mande|mandem|manda|envie|enviem) mais '
      OR t ~ ' descadastr'
      OR t ~ ' nao quero (mais )?receber (mais )?(ofertas?|promoc\w*|mensage\w*|propaganda\w*|msg|nada) '
      OR t ~ ' nao quero mais (ofertas?|promoc\w*|propaganda\w*|mensage\w*|msg) '
      OR t ~ '^ (parar|pare|sair|stop|descadastrar) $'
      OR t ~ '^ nao quero mais( obrigad[oa])?( obrigad[oa])? $'
      OR (coalesce(_campanha_recente, false) AND t ~ ' nao quero mais ')
    FROM t;
$$;

CREATE OR REPLACE FUNCTION private.mkt_descadastro_mensagem()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w public.whatsapp_contacts;
  recente boolean;
BEGIN
  SELECT * INTO w FROM public.whatsapp_contacts
   WHERE id = NEW.whatsapp_contact_id AND empresa_id = NEW.empresa_id;
  IF w.id IS NULL OR w.marketing_optout_em IS NOT NULL THEN RETURN NEW; END IF;
  recente := (private.mkt_envio_recente(NEW.empresa_id, w.normalized_phone, 7)).id IS NOT NULL;
  IF NOT private.mkt_pedido_saida(NEW.text_content, recente) THEN RETURN NEW; END IF;

  UPDATE public.whatsapp_contacts
     SET marketing_optout_em = now(), marketing_optout_origem = 'cliente',
         marketing_optout_por = NULL, marketing_optout_confirmado_em = NULL
   WHERE id = w.id;
  -- Etiqueta "optout" no Chatwoot, como o botão já faz (só para quem está na base de marketing).
  INSERT INTO public.mkt_tarefas (empresa_id, tipo, contato_id, conversa_id)
  SELECT NEW.empresa_id, 'etiqueta_optout', c.id, NEW.conversa_id
    FROM public.mkt_contatos c
   WHERE c.empresa_id = NEW.empresa_id
     AND private.telefone_chave(c.normalized_phone) = private.telefone_chave(w.normalized_phone)
   LIMIT 1;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.mkt_descadastro_mensagem() FROM PUBLIC, anon, authenticated;

-- Nome com "d": roda antes de trg_whatsapp_messages_ia (fila da Alice) e de _mkt (botão).
DROP TRIGGER IF EXISTS trg_whatsapp_messages_descadastro ON public.whatsapp_messages;
CREATE TRIGGER trg_whatsapp_messages_descadastro
  AFTER INSERT ON public.whatsapp_messages
  FOR EACH ROW WHEN (NEW.direction = 'Recebida' AND NOT NEW.privada
                     AND NEW.whatsapp_contact_id IS NOT NULL AND NEW.text_content IS NOT NULL)
  EXECUTE FUNCTION private.mkt_descadastro_mensagem();

-- ================================================================ 3 e 4. trocas pontuais
-- Cada troca precisa achar o trecho exatamente uma vez na função atual; se não achar, a migração
-- inteira para (nada muda).
DO $$
DECLARE
  r record;
  def text;
  n int;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- Listas (tela, planilha, promoção): quem saiu do marketing não aparece.
    ('private.mkt_publico(uuid,jsonb,boolean,date)'::regprocedure,
     'WHERE cardinality(f.fams) > 0',
     'WHERE cardinality(f.fams) > 0 AND NOT x.optout'),
    ('public.mkt_listas_contagem(jsonb)'::regprocedure,
     'FROM emp, private.mkt_listas_dados(emp.id, NULL) x',
     'FROM emp, private.mkt_listas_dados(emp.id, NULL) x WHERE NOT x.optout'),
    -- Pós-venda C1: sai também para quem saiu das ofertas (o texto não tem oferta).
    ('public.mkt_gerar_gatilhos(uuid,date)'::regprocedure,
     E'WHERE c.empresa_id = _emp AND c.optout_em IS NULL AND NOT c.sem_pos_venda\n         AND NOT private.mkt_contato_garantia_aberta(c.id)\n         AND c.ultima_work_order_id IS NOT NULL',
     E'WHERE c.empresa_id = _emp AND NOT c.sem_pos_venda\n         AND NOT private.mkt_contato_garantia_aberta(c.id)\n         AND c.ultima_work_order_id IS NOT NULL'),
    ('public.mkt_reservar_envios(integer,timestamp with time zone)'::regprocedure,
     'AND e.status IN (''pendente'', ''manual'') AND c.optout_em IS NOT NULL;',
     'AND e.status IN (''pendente'', ''manual'') AND c.optout_em IS NOT NULL AND NOT private.mkt_envio_pos_venda(e.campanha_id);'),
    ('public.mkt_confirmar_envio(uuid,timestamp with time zone)'::regprocedure,
     'WHERE id = e.contato_id AND optout_em IS NOT NULL) THEN',
     'WHERE id = e.contato_id AND optout_em IS NOT NULL) AND NOT private.mkt_envio_pos_venda(e.campanha_id) THEN')
  ) AS v(fn, de, para) LOOP
    def := pg_get_functiondef(r.fn);
    n := (length(def) - length(replace(def, r.de, ''))) / length(r.de);
    IF n <> 1 THEN
      RAISE EXCEPTION 'Descadastro: trecho encontrado % vezes em %', n, r.fn;
    END IF;
    EXECUTE replace(def, r.de, r.para);
  END LOOP;
END $$;
