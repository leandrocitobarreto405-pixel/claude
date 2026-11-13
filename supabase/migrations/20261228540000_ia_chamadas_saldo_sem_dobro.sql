-- Saldo sem contar em dobro (13/11). Desde 13/11 toda chamada de IA grava em ia_chamadas, mas parte
-- delas já é somada no saldo por outra tabela. Essas origens saem desta soma (continuam na tabela e
-- no Consumo por origem):
--   alice_conversa                                   -> ia_execucoes
--   tatiana_noite, tatiana_mensagem, tatiana_recado,
--   lote (lotes da noite)                            -> comercial_noites
--   relatorio, base_parada, alice_nao_soube          -> comercial_relatorios
--   plano                                            -> comercial_planos
--   campanha, classificador_campanha                 -> comercial_campanhas
-- As outras origens só existem em ia_chamadas e continuam somadas aqui. Só muda a função; nada é
-- apagado.
CREATE OR REPLACE FUNCTION private.ia_chamadas_custo_usd(_empresa uuid, _desde timestamptz, _ate timestamptz)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT coalesce(sum(custo_usd), 0) FROM public.ia_chamadas
   WHERE (_empresa IS NULL OR empresa_id = _empresa)
     AND criado_em >= _desde AND criado_em < _ate
     AND origem NOT IN ('alice_conversa', 'tatiana_noite', 'tatiana_mensagem', 'tatiana_recado',
                        'lote', 'relatorio', 'base_parada', 'alice_nao_soube', 'plano', 'campanha',
                        'classificador_campanha')
$$;
