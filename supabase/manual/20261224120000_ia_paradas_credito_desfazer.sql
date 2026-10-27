-- Desfaz 20261224120000_ia_paradas_credito (alarme de crédito da IA). Só apaga o que a migração
-- criou: as 3 funções e a tabela de paradas (o histórico das paradas some junto). Os avisos que já
-- foram para o sininho (mkt_avisos tipos alice_pausada/alice_voltou) ficam.
-- Antes, desfaça o código: git revert <commit do alarme> (sem force push).
BEGIN;
DROP FUNCTION IF EXISTS public.ia_parada_hora_de_avisar(text);
DROP FUNCTION IF EXISTS public.ia_encerrar_paradas(text);
DROP FUNCTION IF EXISTS public.ia_registrar_parada(uuid, text, text, uuid);
DROP TABLE IF EXISTS public.ia_paradas;
COMMIT;
