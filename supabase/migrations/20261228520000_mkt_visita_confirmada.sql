-- Marketing: visita "Confirmado" ou "Em deslocamento" também é visita marcada — 12/11, correção
-- pedida pelo dono. As duas funções abaixo decidem se o contato "já tem visita marcada" (fica fora
-- da promoção da agenda) ou "tem OS" (fica fora das listas de conversa e orçamento), mas só olhavam
-- os status Agendado, Em execução e Reagendado: depois que a visita era confirmada, o cliente
-- voltava a poder receber a promoção.
--
-- Só troca a lista de status dentro das duas funções, a partir da definição que está no banco
-- (nenhum outro trecho muda). Roda de novo sem efeito; se a lista não for encontrada, falha em
-- vez de seguir.
DO $$
DECLARE
  def text;
  novo text;
BEGIN
  -- 1) mkt_listas_dados: próxima visita marcada do contato ("agendado_para").
  def := pg_get_functiondef('private.mkt_listas_dados(uuid, date)'::regprocedure);
  IF position('''Confirmado''' IN def) = 0 THEN
    novo := replace(def,
      'v.status IN (''Agendado'', ''Em execução'', ''Reagendado'')',
      'v.status IN (''Agendado'', ''Confirmado'', ''Em deslocamento'', ''Em execução'', ''Reagendado'')');
    IF novo = def THEN
      RAISE EXCEPTION 'mkt_listas_dados: lista de status não encontrada; nada foi alterado';
    END IF;
    EXECUTE novo;
  END IF;

  -- 2) mkt_contato_tem_os: OS com visita ainda em aberto.
  def := pg_get_functiondef('private.mkt_contato_tem_os(uuid, date)'::regprocedure);
  IF position('''Confirmado''' IN def) = 0 THEN
    novo := replace(def,
      'v.status IN (''Agendado'', ''Reagendado'', ''Em execução'')',
      'v.status IN (''Agendado'', ''Confirmado'', ''Em deslocamento'', ''Reagendado'', ''Em execução'')');
    IF novo = def THEN
      RAISE EXCEPTION 'mkt_contato_tem_os: lista de status não encontrada; nada foi alterado';
    END IF;
    EXECUTE novo;
  END IF;
END $$;
