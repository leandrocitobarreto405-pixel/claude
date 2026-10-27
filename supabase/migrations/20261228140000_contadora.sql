-- Papel "Contadora" (27/10/2026). A contadora NÃO entra em usuarios_empresa (a equipe): fica em
-- contadoras_empresa. Assim nenhuma regra de acesso existente a enxerga (empresa_ativa() devolve
-- nulo para ela) e ela não conta no limite de usuários. Ela só lê pelas funções contadora_* abaixo,
-- que conferem o vínculo e devolvem só os campos combinados. Anexar e marcar a nota passam pelo
-- servidor (que confere com contadora_pode). Nada é apagado; só tabelas, colunas e funções novas.

-- ------------------------------------------------------------------ vínculo e convites
CREATE TABLE IF NOT EXISTS public.contadoras_empresa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  email text NOT NULL,
  criado_por uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_contadoras_empresa_user ON public.contadoras_empresa (user_id);

CREATE TABLE IF NOT EXISTS public.convites_contadora (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  criado_por uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  aceito_em timestamptz,
  UNIQUE (empresa_id, email)
);

ALTER TABLE public.contadoras_empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.convites_contadora ENABLE ROW LEVEL SECURITY;

-- Admin da empresa ativa vê e gerencia; a contadora vê só os próprios vínculos.
CREATE POLICY contadoras_admin_ver ON public.contadoras_empresa FOR SELECT TO authenticated
  USING ((empresa_id = private.empresa_ativa() AND private.tem_papel('admin')) OR user_id = auth.uid()
         OR private.is_nexa_admin(auth.uid()));
CREATE POLICY contadoras_admin_apagar ON public.contadoras_empresa FOR DELETE TO authenticated
  USING (empresa_id = private.empresa_ativa() AND private.tem_papel('admin'));
CREATE POLICY convites_contadora_admin ON public.convites_contadora FOR ALL TO authenticated
  USING (empresa_id = private.empresa_ativa() AND private.tem_papel('admin'))
  WITH CHECK (empresa_id = private.empresa_ativa() AND private.tem_papel('admin'));
GRANT SELECT, DELETE ON public.contadoras_empresa TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.convites_contadora TO authenticated;

CREATE OR REPLACE FUNCTION private.sou_contadora(_emp uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.contadoras_empresa c WHERE c.user_id = auth.uid() AND c.empresa_id = _emp)
    AND private.empresa_situacao(_emp) <> 'bloqueada';
$$;

-- Quem pode ver as telas da contadora: ela mesma ou o admin da empresa (para conferir).
CREATE OR REPLACE FUNCTION private.ve_contabil(_emp uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.sou_contadora(_emp)
      OR (_emp = private.empresa_ativa() AND private.tem_papel('admin'));
$$;

CREATE OR REPLACE FUNCTION public.contadora_pode(_emp uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT private.ve_contabil(_emp);
$$;

CREATE OR REPLACE FUNCTION public.contadora_minhas_empresas()
RETURNS TABLE (empresa_id uuid, nome text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.id, e.nome FROM public.contadoras_empresa c JOIN public.empresas e ON e.id = c.empresa_id
   WHERE c.user_id = auth.uid() AND private.empresa_situacao(e.id) <> 'bloqueada'
   ORDER BY e.nome;
$$;

-- Aceite no login: além dos convites da equipe, os de contadora (sem entrar na equipe).
CREATE OR REPLACE FUNCTION private.ensure_my_access()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  uname text;
  convite public.convites_empresa;
  cc public.convites_contadora;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

  SELECT email, COALESCE(raw_user_meta_data->>'full_name', split_part(email,'@',1))
    INTO uemail, uname FROM auth.users WHERE id = uid;

  INSERT INTO public.users_profiles (id, full_name, email)
  VALUES (uid, COALESCE(uname,''), uemail)
  ON CONFLICT (id) DO NOTHING;

  FOR convite IN
    SELECT * FROM public.convites_empresa
     WHERE lower(email) = lower(uemail) AND aceito_em IS NULL ORDER BY created_at
  LOOP
    INSERT INTO public.usuarios_empresa (user_id, empresa_id, papel)
    VALUES (uid, convite.empresa_id, convite.papel)
    ON CONFLICT (user_id, empresa_id) DO NOTHING;
    UPDATE public.convites_empresa SET aceito_em = now() WHERE id = convite.id;
  END LOOP;

  FOR cc IN
    SELECT * FROM public.convites_contadora
     WHERE email = lower(uemail) AND aceito_em IS NULL ORDER BY created_at
  LOOP
    INSERT INTO public.contadoras_empresa (empresa_id, user_id, email, criado_por)
    VALUES (cc.empresa_id, uid, lower(uemail), cc.criado_por)
    ON CONFLICT (empresa_id, user_id) DO NOTHING;
    UPDATE public.convites_contadora SET aceito_em = now() WHERE id = cc.id;
  END LOOP;
END $function$;

-- ------------------------------------------------------------------ nota fiscal e despesas
ALTER TABLE public.invoice_tasks
  ADD COLUMN IF NOT EXISTS motivo_cancelamento text,
  ADD COLUMN IF NOT EXISTS xml_path text,
  ADD COLUMN IF NOT EXISTS xml_nome text,
  ADD COLUMN IF NOT EXISTS emitida_em timestamptz,
  ADD COLUMN IF NOT EXISTS emitida_por uuid,
  ADD COLUMN IF NOT EXISTS drive_situacao text CHECK (drive_situacao IN ('pendente', 'copiada', 'sem_drive', 'erro')),
  ADD COLUMN IF NOT EXISTS drive_tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_erro text,
  ADD COLUMN IF NOT EXISTS drive_url text;
CREATE INDEX IF NOT EXISTS idx_invoice_tasks_drive_pendente ON public.invoice_tasks (drive_situacao)
  WHERE drive_situacao = 'pendente';

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS comprovante_path text,
  ADD COLUMN IF NOT EXISTS comprovante_nome text,
  ADD COLUMN IF NOT EXISTS comprovante_em timestamptz,
  ADD COLUMN IF NOT EXISTS drive_situacao text CHECK (drive_situacao IN ('pendente', 'copiada', 'sem_drive', 'erro')),
  ADD COLUMN IF NOT EXISTS drive_tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drive_erro text,
  ADD COLUMN IF NOT EXISTS drive_url text;
CREATE INDEX IF NOT EXISTS idx_expenses_drive_pendente ON public.expenses (drive_situacao)
  WHERE drive_situacao = 'pendente';

-- ------------------------------------------------------------------ leituras da contadora
-- OS realizadas no período (concluída ou parcialmente concluída; data = última conclusão).
CREATE OR REPLACE FUNCTION public.contadora_os_realizadas(_emp uuid, _de date, _ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.ve_contabil(_emp) THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'data' DESC, x->>'os')
      FROM (
        SELECT jsonb_build_object(
          'id', w.id,
          'os', w.os_number,
          'cliente', c.full_name,
          'documento', coalesce(nullif(it.document_number, ''), c.document_number),
          'email', c.email,
          'endereco', coalesce(nullif(c.full_address, ''),
                               concat_ws(', ', nullif(c.street, '') || coalesce(' ' || nullif(c.street_number, ''), ''),
                                         nullif(c.neighborhood, ''), nullif(c.city, '') || coalesce('/' || nullif(c.state, ''), ''),
                                         nullif(c.postal_code, ''))),
          'servicos', (SELECT jsonb_agg(jsonb_build_object(
                          'servico', coalesce(st.name, 'Serviço'),
                          'descricao', v.upholstery_description,
                          'valor', coalesce(v.final_value, v.visit_value),
                          'repasse_parceiro', nullif(v.repasse_parceiro, 0)) ORDER BY v.completion_date)
                         FROM public.visits v LEFT JOIN public.config_options st ON st.id = v.service_type_id
                        WHERE v.work_order_id = w.id AND v.status = 'Concluído'),
          'valor', w.total_gross_value,
          'repasse_total', (SELECT nullif(sum(coalesce(v.repasse_parceiro, 0)), 0) FROM public.visits v
                             WHERE v.work_order_id = w.id AND v.status = 'Concluído'),
          'data', fim.data,
          'pagamento', (SELECT string_agg(DISTINCT coalesce(p.payment_type, p.payment_channel)
                                 || CASE WHEN p.installments > 1 THEN ' em ' || p.installments || 'x' ELSE '' END, ' + ')
                          FROM public.payments p
                         WHERE p.work_order_id = w.id AND p.is_active IS DISTINCT FROM false
                           AND p.payment_status IN ('Pago', 'Parcialmente pago')),
          'recebido', (SELECT coalesce(sum(p.gross_amount), 0) FROM public.payments p
                        WHERE p.work_order_id = w.id AND p.is_active IS DISTINCT FROM false
                          AND p.payment_status IN ('Pago', 'Parcialmente pago')),
          'nota_id', it.id,
          'nota', coalesce(it.status, 'Sem pedido'),
          'nota_numero', it.invoice_number) AS x
          FROM public.work_orders w
          JOIN public.customers c ON c.id = w.customer_id
          JOIN LATERAL (SELECT max(v.completion_date) AS data FROM public.visits v
                         WHERE v.work_order_id = w.id AND v.status = 'Concluído') fim ON true
          LEFT JOIN LATERAL (SELECT * FROM public.invoice_tasks i WHERE i.work_order_id = w.id
                              ORDER BY i.created_at DESC LIMIT 1) it ON true
         WHERE w.empresa_id = _emp AND w.deleted_at IS NULL AND w.cancelled_at IS NULL
           AND NOT coalesce(w.eh_teste, false)
           AND w.status IN ('Concluída', 'Parcialmente concluída')
           AND fim.data BETWEEN _de AND _ate) s), '[]'::jsonb);
END $$;

-- Notas: fila "Para emitir" (Pendente/Solicitada, mais antigas primeiro) ou todas do período.
CREATE OR REPLACE FUNCTION public.contadora_notas(_emp uuid, _filtro text DEFAULT 'para_emitir',
                                                  _de date DEFAULT NULL, _ate date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.ve_contabil(_emp) THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY (x->>'ordem')::timestamptz, x->>'os')
      FROM (
        SELECT jsonb_build_object(
          'id', i.id,
          'ordem', coalesce(i.solicitada_em, i.created_at),
          'status', i.status,
          'os', w.os_number,
          'cliente', c.full_name,
          'documento', coalesce(nullif(i.document_number, ''), c.document_number),
          'email', c.email,
          'endereco', c.full_address,
          'valor', coalesce(i.invoice_amount, w.total_gross_value),
          'data_servico', i.service_date,
          'numero', i.invoice_number,
          'data_emissao', i.issue_date,
          'arquivo_path', i.arquivo_path,
          'arquivo_nome', i.arquivo_nome,
          'xml_path', i.xml_path,
          'xml_nome', i.xml_nome,
          'motivo_cancelamento', i.motivo_cancelamento,
          'drive', i.drive_situacao,
          'drive_url', i.drive_url,
          'criada_em', i.created_at) AS x
          FROM public.invoice_tasks i
          JOIN public.work_orders w ON w.id = i.work_order_id
          LEFT JOIN public.customers c ON c.id = w.customer_id
         WHERE i.empresa_id = _emp AND w.deleted_at IS NULL AND NOT coalesce(w.eh_teste, false)
           AND CASE _filtro
                 WHEN 'para_emitir' THEN i.status IN ('Pendente', 'Solicitada')
                 WHEN 'emitidas' THEN i.status = 'Emitida'
                   AND (_de IS NULL OR coalesce(i.issue_date, i.emitida_em::date) >= _de)
                   AND (_ate IS NULL OR coalesce(i.issue_date, i.emitida_em::date) <= _ate)
                 ELSE (_de IS NULL OR coalesce(i.service_date, i.created_at::date) >= _de)
                   AND (_ate IS NULL OR coalesce(i.service_date, i.created_at::date) <= _ate)
               END) s), '[]'::jsonb);
END $$;

-- Despesas do mês (competência; sem competência, vencimento).
CREATE OR REPLACE FUNCTION public.contadora_despesas(_emp uuid, _de date, _ate date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.ve_contabil(_emp) THEN RAISE EXCEPTION 'sem acesso' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((
    SELECT jsonb_agg(x ORDER BY x->>'data', x->>'descricao')
      FROM (
        SELECT jsonb_build_object(
          'id', e.id,
          'descricao', e.description,
          'fornecedor', e.beneficiary,
          'categoria', e.category,
          'status', e.status,
          'valor', coalesce(e.actual_amount, e.paid_amount, e.expected_amount),
          'data', coalesce(e.competence_date, e.due_date, e.payment_date),
          'pagamento', e.payment_date,
          'comprovante_path', e.comprovante_path,
          'comprovante_nome', e.comprovante_nome,
          'drive', e.drive_situacao,
          'drive_url', e.drive_url) AS x
          FROM public.expenses e
         WHERE e.empresa_id = _emp AND e.deleted_at IS NULL
           AND coalesce(e.competence_date, e.due_date, e.payment_date) BETWEEN _de AND _ate) s), '[]'::jsonb);
END $$;

REVOKE ALL ON FUNCTION private.sou_contadora(uuid), private.ve_contabil(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contadora_pode(uuid), public.contadora_minhas_empresas(),
  public.contadora_os_realizadas(uuid, date, date), public.contadora_notas(uuid, text, date, date),
  public.contadora_despesas(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contadora_pode(uuid), public.contadora_minhas_empresas(),
  public.contadora_os_realizadas(uuid, date, date), public.contadora_notas(uuid, text, date, date),
  public.contadora_despesas(uuid, date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.sou_contadora(uuid), private.ve_contabil(uuid) TO authenticated, service_role;

-- Tabelas novas com empresa_id ganham a trava de somente leitura (empresa bloqueada).
SELECT private.instalar_travas_somente_leitura();
