-- Dados para o teste de API (isolamento.test.mjs). Aplicado num banco recém-migrado.
DO $$ BEGIN CREATE ROLE authenticator LOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT anon, authenticated, service_role TO authenticator;
INSERT INTO auth.users (id, email) VALUES
 ('00000000-0000-0000-0000-00000000000a','nexa@nexa.test'),
 ('00000000-0000-0000-0000-00000000000b','admin@turbine.test'),
 ('00000000-0000-0000-0000-00000000000c','admin@b.test'),
 ('00000000-0000-0000-0000-00000000000d','multi@nexa.test');
INSERT INTO public.plataforma_usuarios (user_id, papel) VALUES ('00000000-0000-0000-0000-00000000000a','nexa_admin');
INSERT INTO public.empresas (id, nome) VALUES ('22222222-2222-2222-2222-222222222222','Cliente B');
INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel) VALUES
 ('00000000-0000-0000-0000-00000000000b','11111111-1111-1111-1111-111111111111','admin'),
 ('00000000-0000-0000-0000-00000000000c','22222222-2222-2222-2222-222222222222','admin'),
 ('00000000-0000-0000-0000-00000000000d','11111111-1111-1111-1111-111111111111','atendente'),
 ('00000000-0000-0000-0000-00000000000d','22222222-2222-2222-2222-222222222222','atendente');
INSERT INTO public.customers (empresa_id, full_name, phone) VALUES
 ('11111111-1111-1111-1111-111111111111','Cliente da Turbine','1'),
 ('22222222-2222-2222-2222-222222222222','Cliente de B','2');
INSERT INTO public.work_orders (empresa_id, os_number, customer_id)
 SELECT '11111111-1111-1111-1111-111111111111','1842', id FROM public.customers WHERE full_name='Cliente da Turbine';
-- Leads para orcamento.test.mjs (o telefone liga o orçamento ao lead).
INSERT INTO public.crm_leads (empresa_id, lead_name, phone, normalized_phone, is_open, status_id)
SELECT '11111111-1111-1111-1111-111111111111', x.nome, x.fone, '55' || x.fone, true, o.id
  FROM (VALUES ('Lead API Enviado', '11946000001'), ('Lead API Rascunho', '11946000002')) x(nome, fone)
  JOIN public.config_options o ON o.empresa_id = '11111111-1111-1111-1111-111111111111'
   AND o.kind = 'crm_status' AND o.name = 'Novo contato';
