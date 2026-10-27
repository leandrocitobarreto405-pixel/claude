-- Notificações no celular (27/10/2026, item 6): confirmação de recebimento e status do serviço de
-- push. O aparelho, ao receber, avisa o servidor pelo "recibo" da inscrição (sw.js). Assim dá para
-- saber se a notificação chegou de verdade (a Apple aceita o envio mesmo quando o app foi apagado e
-- reinstalado) e remover a inscrição morta. Só colunas e funções novas.
ALTER TABLE public.push_inscricoes
  ADD COLUMN IF NOT EXISTS recibo uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS ultimo_status integer,
  ADD COLUMN IF NOT EXISTS confirmado_em timestamptz,
  ADD COLUMN IF NOT EXISTS envios_sem_recibo integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS push_inscricoes_recibo_key ON public.push_inscricoes (recibo);

-- Envio feito: guarda o status devolvido pelo serviço de push e conta os envios sem recibo.
CREATE OR REPLACE FUNCTION public.push_registrar_envio(_id uuid, _status integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.push_inscricoes
     SET ultimo_status = _status,
         ultimo_envio_em = CASE WHEN _status BETWEEN 200 AND 299 THEN now() ELSE ultimo_envio_em END,
         envios_sem_recibo = envios_sem_recibo + CASE WHEN _status BETWEEN 200 AND 299 THEN 1 ELSE 0 END,
         falhas = CASE WHEN _status BETWEEN 200 AND 299 THEN 0 ELSE falhas + 1 END
   WHERE id = _id;
$$;

-- O aparelho confirmou que recebeu.
CREATE OR REPLACE FUNCTION public.push_confirmar_recibo(_recibo uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.push_inscricoes SET confirmado_em = now(), envios_sem_recibo = 0 WHERE recibo = _recibo;
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.push_registrar_envio(uuid, integer), public.push_confirmar_recibo(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_registrar_envio(uuid, integer), public.push_confirmar_recibo(uuid)
  TO service_role;
