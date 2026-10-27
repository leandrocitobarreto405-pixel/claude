-- Pix com fonte única (migração 20261228120000): Regras de orçamento manda; Alice e agenda copiam.
BEGIN;
CREATE FUNCTION pg_temp.ok(_cond boolean, _msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _msg; END IF;
END $$;
\set E '80000000-0000-4000-8000-000000000001'
INSERT INTO public.empresas (id, nome) VALUES (:'E', 'Pix 800');
INSERT INTO public.ia_configuracoes (empresa_id, desconto_pix_percentual) VALUES (:'E', 5);
INSERT INTO public.agenda_configuracoes (empresa_id, promo_desconto_pct, promo_pix_pct) VALUES (:'E', 10, 5);
INSERT INTO public.orcamento_configuracoes (empresa_id, pix_pct) VALUES (:'E', 8);
SELECT pg_temp.ok((SELECT desconto_pix_percentual FROM public.ia_configuracoes WHERE empresa_id = :'E') = 8, 'Alice copia ao criar as regras');
SELECT pg_temp.ok((SELECT promo_pix_pct FROM public.agenda_configuracoes WHERE empresa_id = :'E') = 8, 'agenda copia ao criar as regras');
UPDATE public.orcamento_configuracoes SET pix_pct = 7 WHERE empresa_id = :'E';
SELECT pg_temp.ok((SELECT desconto_pix_percentual FROM public.ia_configuracoes WHERE empresa_id = :'E') = 7, 'Alice segue a mudança');
SELECT pg_temp.ok((SELECT promo_pix_pct FROM public.agenda_configuracoes WHERE empresa_id = :'E') = 7, 'agenda segue a mudança');
UPDATE public.ia_configuracoes SET desconto_pix_percentual = 12 WHERE empresa_id = :'E';
UPDATE public.agenda_configuracoes SET promo_pix_pct = 12 WHERE empresa_id = :'E';
SELECT pg_temp.ok((SELECT desconto_pix_percentual FROM public.ia_configuracoes WHERE empresa_id = :'E') = 7, 'Alice não muda por fora');
SELECT pg_temp.ok((SELECT promo_pix_pct FROM public.agenda_configuracoes WHERE empresa_id = :'E') = 7, 'agenda não muda por fora');
-- promoção de 20%: o Pix da promoção fica em 5% (teto de 25%), e o salvar das regras não falha
UPDATE public.agenda_configuracoes SET promo_desconto_pct = 20 WHERE empresa_id = :'E';
SELECT pg_temp.ok((SELECT promo_pix_pct FROM public.agenda_configuracoes WHERE empresa_id = :'E') = 5, 'promoção 20% + Pix limitado a 5%');
UPDATE public.orcamento_configuracoes SET pix_pct = 10 WHERE empresa_id = :'E';
SELECT pg_temp.ok((SELECT promo_pix_pct FROM public.agenda_configuracoes WHERE empresa_id = :'E') = 5, 'Pix 10% nas regras: promoção fica em 5%');
SELECT pg_temp.ok((SELECT desconto_pix_percentual FROM public.ia_configuracoes WHERE empresa_id = :'E') = 10, 'Alice com 10%');
ROLLBACK;
