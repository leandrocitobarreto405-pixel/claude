-- Contato interno (só admin marca; sai dos envios de cliente), configuração da agenda (limites,
-- desconto até 25%) e promoção (criação, lista filtrada, envio só com "Envio ligado").
BEGIN;

CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;

INSERT INTO auth.users (id, email) VALUES
  ('00000000-0000-0000-0000-0000000000c1', 'admin@agenda.dev'),
  ('00000000-0000-0000-0000-0000000000c2', 'atendente@agenda.dev');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
  ('00000000-0000-0000-0000-0000000000c1', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-0000000000c2', '11111111-1111-1111-1111-111111111111', 'atendente');
INSERT INTO public.mkt_configuracoes (empresa_id, intervalo_segundos)
VALUES ('11111111-1111-1111-1111-111111111111', 1);

-- 1. Contato interno: atendente não marca; admin marca e o telefone é normalizado.
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO public.contatos_internos (empresa_id, telefone, nome)
  VALUES ('11111111-1111-1111-1111-111111111111', '11 98888-0001', 'Leandro');
  RAISE EXCEPTION 'FALHOU: atendente marcou contato interno';
EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
INSERT INTO public.contatos_internos (empresa_id, telefone, nome)
VALUES ('11111111-1111-1111-1111-111111111111', '(11) 98888-0001', ' Leandro ');
SELECT pg_temp.ok((SELECT telefone = '5511988880001' AND chave = '1188880001' AND nome = 'Leandro'
                     FROM public.contatos_internos), 'telefone normalizado e chave');
RESET ROLE;
SELECT pg_temp.ok(private.contato_interno('11111111-1111-1111-1111-111111111111', '1188880001'),
  'interno reconhecido sem o 9º dígito');

-- 2. Configuração da agenda: desconto total até 25%.
INSERT INTO public.agenda_configuracoes (empresa_id) VALUES ('11111111-1111-1111-1111-111111111111');
DO $$ BEGIN
  UPDATE public.agenda_configuracoes SET promo_desconto_pct = 22, promo_pix_pct = 5;
  RAISE EXCEPTION 'FALHOU: aceitou 27%% no total';
EXCEPTION WHEN check_violation THEN NULL; END $$;

-- 3. Promoção: interno, opt-out e sem nome ficam de fora.
INSERT INTO public.mkt_contatos (empresa_id, nome, primeiro_nome, normalized_phone, tipo, optout_em) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Saiu', 'Saiu', '5511977770009', 'nao_comprador', now());
SELECT public.mkt_criar_promocao('11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-0000000000c1',
  '[{"telefone": "11977770001", "nome": "Carla Mendes"},
    {"telefone": "11977770002", "nome": "João Pedro"},
    {"telefone": "11977770009", "nome": "Saiu"},
    {"telefone": "11988880001", "nome": "Leandro"},
    {"telefone": "11977770003", "nome": ""}]', 20, 5, 'tc_promocao_agenda', '2026-10-06');
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_envios) = 2, 'só Carla e João na promoção');
SELECT pg_temp.ok((SELECT tipo = 'promocao' AND status = 'aprovada' AND condicao_texto = '20%'
                          AND condicao_pct = 20 AND desconto_pix_pct = 5 FROM public.mkt_campanhas),
  'campanha da promoção aprovada com 20% + 5%');
DO $$ BEGIN
  PERFORM public.mkt_criar_promocao('11111111-1111-1111-1111-111111111111', NULL,
    '[{"telefone": "11977770001", "nome": "Carla"}]', 22, 5, 'tc_promocao_agenda', NULL);
  RAISE EXCEPTION 'FALHOU: promoção com 27%%';
EXCEPTION WHEN invalid_parameter_value THEN NULL; END $$;

-- Próxima segunda-feira (o envio da promoção é agendado para agora; o teste reserva no futuro).
CREATE FUNCTION pg_temp.segunda(_hora time) RETURNS timestamptz LANGUAGE sql AS $$
  SELECT ((current_date + (8 - extract(isodow FROM current_date))::int) + _hora) AT TIME ZONE 'America/Sao_Paulo'
$$;
-- 4. Envio: sem "Envio ligado" nada sai; ligado, sai numa segunda às 9h; interno é cancelado.
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, pg_temp.segunda('09:30'))) = 0,
  'promoção não sai com o envio desligado');
UPDATE public.mkt_configuracoes SET disparo_ligado = true;
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, pg_temp.segunda('08:30'))) = 0,
  'promoção não sai antes das 9h');
INSERT INTO public.mkt_envios (empresa_id, campanha_id, lote_id, contato_id, normalized_phone, template_nome, agendado_para)
SELECT e.empresa_id, e.campanha_id, e.lote_id, c.id, c.normalized_phone, e.template_nome, now()
  FROM public.mkt_envios e, public.mkt_contatos c
 WHERE c.normalized_phone = '5511988880001' LIMIT 1;
SELECT pg_temp.ok((SELECT count(*) FROM public.mkt_reservar_envios(10, pg_temp.segunda('09:30'))) = 2,
  'segunda às 9h30 a promoção sai (2 envios)');
SELECT pg_temp.ok((SELECT status = 'cancelado' AND erro = 'contato interno da equipe' FROM public.mkt_envios
                    WHERE normalized_phone = '5511988880001'), 'envio para contato interno cancelado');

ROLLBACK;
