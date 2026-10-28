-- Desfaz 20261228260000_mkt_botao_sem_interesse: volta mkt_resposta à versão de 20261025120000
-- (rodar antes o trecho dela daquele arquivo), tira os dois botões do mapa e o padrão novo.
-- Leads já marcados "Não tem interesse" e descadastros ficam como estão (são decisões do cliente).
UPDATE public.mkt_configuracoes
   SET botoes = botoes - 'quero meu orcamento' - 'nao tenho interesse'
 WHERE botoes ? 'quero meu orcamento' OR botoes ? 'nao tenho interesse';
ALTER TABLE public.mkt_configuracoes ALTER COLUMN botoes
  SET DEFAULT '{"agora nao": "recusou", "ja resolvi": "recusou", "ficou otimo": "elogio", "quero o valor": "interesse", "quero renovar": "interesse", "quero reservar": "interesse", "quero orcamento": "interesse", "quero aproveitar": "interesse", "tive um problema": "problema", "me mostre as datas": "interesse", "quero um orcamento": "interesse", "quero ver as datas": "interesse", "quero ver horarios": "interesse", "nao quero mais ofertas": "optout"}'::jsonb;
DROP FUNCTION IF EXISTS private.mkt_lead_sem_interesse(uuid, uuid);
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261228260000';
