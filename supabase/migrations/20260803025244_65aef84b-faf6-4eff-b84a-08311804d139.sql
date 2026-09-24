-- helpers
CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TYPE public.app_role AS ENUM ('admin','operator');

CREATE TABLE public.users_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL DEFAULT '',
  email text,
  phone text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users_profiles TO authenticated;
GRANT ALL ON public.users_profiles TO service_role;
ALTER TABLE public.users_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_read" ON public.users_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert" ON public.users_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "profiles_update" ON public.users_profiles FOR UPDATE TO authenticated USING (true);
CREATE TRIGGER trg_users_profiles_upd BEFORE UPDATE ON public.users_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles_read" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users_profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)), NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- configurable options
CREATE TABLE public.config_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_config_options_kind ON public.config_options(kind, display_order);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.config_options TO authenticated;
GRANT ALL ON public.config_options TO service_role;
ALTER TABLE public.config_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cfg_all" ON public.config_options FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_cfg_upd BEFORE UPDATE ON public.config_options FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.salespeople (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  commission_percentage numeric(6,3) NOT NULL DEFAULT 3,
  active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  commission_rule text NOT NULL DEFAULT 'on_completion',
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.salespeople TO authenticated;
GRANT ALL ON public.salespeople TO service_role;
ALTER TABLE public.salespeople ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp_all" ON public.salespeople FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_sp_upd BEFORE UPDATE ON public.salespeople FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.technicians (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  base_address text,
  vehicle text,
  include_return boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.technicians TO authenticated;
GRANT ALL ON public.technicians TO service_role;
ALTER TABLE public.technicians ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tec_all" ON public.technicians FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_tec_upd BEFORE UPDATE ON public.technicians FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.payment_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  payment_type text NOT NULL,
  installments int NOT NULL DEFAULT 1,
  rate_percent numeric(6,3) NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rates ON public.payment_rates(channel, payment_type, installments);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_rates TO authenticated;
GRANT ALL ON public.payment_rates TO service_role;
ALTER TABLE public.payment_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rates_all" ON public.payment_rates FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_rates_upd BEFORE UPDATE ON public.payment_rates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_all" ON public.app_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- customers
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  phone text NOT NULL,
  email text,
  document_number text,
  street text, street_number text, complement text, neighborhood text,
  city text, state text, postal_code text, reference_point text,
  full_address text, latitude numeric, longitude numeric, notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_phone ON public.customers(phone);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cust_all" ON public.customers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_cust_upd BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- work orders
CREATE TABLE public.work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  os_number text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  sale_date date NOT NULL DEFAULT CURRENT_DATE,
  sales_origin_id uuid REFERENCES public.config_options(id),
  salesperson_id uuid REFERENCES public.salespeople(id),
  total_gross_value numeric(12,2) NOT NULL DEFAULT 0,
  manual_total_reason text,
  negotiated_payment_method text,
  negotiated_installments int,
  general_notes text,
  status text NOT NULL DEFAULT 'Agendada',
  commission_percentage_snapshot numeric(6,3),
  commission_expected numeric(12,2) NOT NULL DEFAULT 0,
  commission_realized numeric(12,2) NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_orders TO authenticated;
GRANT ALL ON public.work_orders TO service_role;
ALTER TABLE public.work_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wo_all" ON public.work_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_wo_upd BEFORE UPDATE ON public.work_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  service_type_id uuid REFERENCES public.config_options(id),
  upholstery_type_id uuid REFERENCES public.config_options(id),
  upholstery_description text,
  scheduled_date date NOT NULL,
  scheduled_time time NOT NULL,
  technician_id uuid REFERENCES public.technicians(id),
  visit_value numeric(12,2) NOT NULL DEFAULT 0,
  final_value numeric(12,2),
  value_change_reason text,
  status text NOT NULL DEFAULT 'Agendado',
  completion_date date,
  completion_time time,
  visit_notes text,
  mileage_cost_allocated numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_visits_date ON public.visits(scheduled_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visits TO authenticated;
GRANT ALL ON public.visits TO service_role;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "visits_all" ON public.visits FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_visits_upd BEFORE UPDATE ON public.visits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  visit_id uuid REFERENCES public.visits(id) ON DELETE SET NULL,
  payment_date date,
  payment_channel text NOT NULL,
  payment_type text NOT NULL DEFAULT 'Pix',
  installments int NOT NULL DEFAULT 1,
  gross_amount numeric(12,2) NOT NULL DEFAULT 0,
  applied_rate numeric(6,3) NOT NULL DEFAULT 0,
  payment_fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_status text NOT NULL DEFAULT 'Pago',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay_all" ON public.payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_pay_upd BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.invoice_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id),
  document_number text,
  service_date date,
  invoice_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pendente',
  invoice_number text,
  issue_date date,
  file_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_tasks TO authenticated;
GRANT ALL ON public.invoice_tasks TO service_role;
ALTER TABLE public.invoice_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_all" ON public.invoice_tasks FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_inv_upd BEFORE UPDATE ON public.invoice_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Outros',
  default_amount numeric(12,2) NOT NULL DEFAULT 0,
  recurrence text NOT NULL DEFAULT 'monthly',
  due_day int,
  weekday int,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recurring_expenses TO authenticated;
GRANT ALL ON public.recurring_expenses TO service_role;
ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec_all" ON public.recurring_expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_rec_upd BEFORE UPDATE ON public.recurring_expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_expense_id uuid REFERENCES public.recurring_expenses(id) ON DELETE SET NULL,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'Outros',
  competence_date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  payment_date date,
  expected_amount numeric(12,2) NOT NULL DEFAULT 0,
  actual_amount numeric(12,2),
  status text NOT NULL DEFAULT 'Pendente',
  work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  receipt_url text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_expenses_recurring_unique ON public.expenses(recurring_expense_id, due_date) WHERE recurring_expense_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exp_all" ON public.expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_exp_upd BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.monthly_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month date NOT NULL UNIQUE,
  goal_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_goals TO authenticated;
GRANT ALL ON public.monthly_goals TO service_role;
ALTER TABLE public.monthly_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goal_all" ON public.monthly_goals FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_goal_upd BEFORE UPDATE ON public.monthly_goals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.daily_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  technician_id uuid REFERENCES public.technicians(id),
  route_date date NOT NULL,
  segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  calculated_km numeric(10,2),
  real_km numeric(10,2),
  adjustment_reason text,
  estimated_minutes int,
  cost_per_km numeric(10,2),
  total_cost numeric(12,2),
  allocation_method text NOT NULL DEFAULT 'equal',
  calculated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (technician_id, route_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_routes TO authenticated;
GRANT ALL ON public.daily_routes TO service_role;
ALTER TABLE public.daily_routes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "route_all" ON public.daily_routes FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_route_upd BEFORE UPDATE ON public.daily_routes FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- SEED
INSERT INTO public.config_options (kind,name,display_order) VALUES
 ('sales_origin','Google',1),('sales_origin','Facebook',2),('sales_origin','Instagram',3),
 ('sales_origin','Indicação',4),('sales_origin','Cliente recorrente',5),('sales_origin','Outros',6),
 ('service_type','Higienização',1),('service_type','Impermeabilização',2),
 ('upholstery_type','Sofá retrátil',1),('upholstery_type','Sofá fixo',2),('upholstery_type','Poltrona',3),
 ('upholstery_type','Cadeira',4),('upholstery_type','Colchão',5),('upholstery_type','Cabeceira',6),
 ('upholstery_type','Tapete',7),('upholstery_type','Banco automotivo',8),('upholstery_type','Outros',9),
 ('payment_method','Pix',1),('payment_method','Dinheiro',2),('payment_method','Débito',3),
 ('payment_method','Crédito',4),('payment_method','Transferência',5),('payment_method','Link de pagamento',6),
 ('payment_channel','Pix direto',1),('payment_channel','Dinheiro',2),('payment_channel','Transferência',3),
 ('payment_channel','Maquininha',4),('payment_channel','Link de pagamento',5),('payment_channel','Outro',6),
 ('expense_category','Salários',1),('expense_category','Marketing',2),('expense_category','Veículo',3),
 ('expense_category','Contabilidade',4),('expense_category','Sistemas',5),('expense_category','Escritório',6),
 ('expense_category','Materiais',7),('expense_category','Combustível',8),('expense_category','Pedágio',9),
 ('expense_category','Estacionamento',10),('expense_category','Manutenção',11),('expense_category','Impostos',12),
 ('expense_category','Outros',13);

INSERT INTO public.salespeople (name, commission_percentage, display_order) VALUES ('Maria',3,1),('Carol',3,2);
INSERT INTO public.technicians (name, base_address, display_order) VALUES ('Josué','Rua Mercedes Baravelle Fraga, São Paulo - SP',1);

INSERT INTO public.payment_rates (channel,payment_type,installments,rate_percent) VALUES
 ('Maquininha','Pix',1,0.00),('Maquininha','Débito',1,2.58),
 ('Maquininha','Crédito',1,4.91),('Maquininha','Crédito',2,6.47),('Maquininha','Crédito',3,7.20),
 ('Maquininha','Crédito',4,7.92),('Maquininha','Crédito',5,8.63),('Maquininha','Crédito',6,9.33),
 ('Maquininha','Crédito',7,10.03),('Maquininha','Crédito',8,10.72),('Maquininha','Crédito',9,11.41),
 ('Maquininha','Crédito',10,12.08),('Maquininha','Crédito',11,12.75),('Maquininha','Crédito',12,13.41),
 ('Link de pagamento','Pix',1,0.00),
 ('Link de pagamento','Crédito',1,4.20),('Link de pagamento','Crédito',2,6.09),('Link de pagamento','Crédito',3,7.01),
 ('Link de pagamento','Crédito',4,7.91),('Link de pagamento','Crédito',5,8.80),('Link de pagamento','Crédito',6,9.67),
 ('Link de pagamento','Crédito',7,12.59),('Link de pagamento','Crédito',8,13.42),('Link de pagamento','Crédito',9,14.25),
 ('Link de pagamento','Crédito',10,15.06),('Link de pagamento','Crédito',11,15.87),('Link de pagamento','Crédito',12,16.66),
 ('Pix direto','Pix',1,0.00),('Dinheiro','Dinheiro',1,0.00),('Transferência','Transferência',1,0.00),('Outro','Outro',1,0.00);

INSERT INTO public.recurring_expenses (name,category,default_amount,recurrence,due_day,weekday) VALUES
 ('Salário Leandro','Salários',1500.00,'monthly',5,NULL),
 ('Salário Maria','Salários',1500.00,'monthly',5,NULL),
 ('Salário Carol','Salários',500.00,'monthly',5,NULL),
 ('Salário Josué','Salários',3000.00,'monthly',5,NULL),
 ('Marketing','Marketing',10000.00,'monthly',10,NULL),
 ('Escritório virtual','Escritório',63.00,'monthly',10,NULL),
 ('WhatsApp verificado','Sistemas',55.00,'monthly',10,NULL),
 ('Contabilidade','Contabilidade',762.50,'monthly',10,NULL),
 ('StayCloud','Sistemas',40.00,'monthly',10,NULL),
 ('Carro','Veículo',727.72,'weekly',NULL,1);

INSERT INTO public.app_settings (key,value) VALUES
 ('company','{"name":"Gestão Estofados","document":"","phone":""}'::jsonb),
 ('mileage','{"cost_per_km":null,"allocation_method":"equal"}'::jsonb),
 ('message_template','{"body":"{{dia_da_semana}}, {{data}}, às {{horario}}\n\nOS {{numero_os}}\n{{nome_cliente}}\n\n{{descricao_estofado}}\n\nServiço: {{servico}}\n\nEndereço:\n{{endereco_completo}}\n\nValor: {{valor_formatado}}"}'::jsonb);