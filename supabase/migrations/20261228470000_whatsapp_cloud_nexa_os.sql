-- WhatsApp Cloud API pelo app próprio da Nexa ("Nexa OS", Cadastro Incorporado) — 06/11, plano
-- aprovado pelo dono. Tudo NOVO e separado: não muda meta_conexoes / meta_conexao_segredos (modelos
-- da Turbine), o Chatwoot nem o webhook atual. Nenhum número é conectado aqui.
--
-- Liberação por empresa: sem linha em whatsapp_cloud_conexoes = desligado (botão escondido). A
-- Nexa libera inserindo a linha com situacao 'liberado'. As empresas atuais (Turbine inclusive) não
-- ganham linha.
--
-- Tokens: o token do cliente (vem do Cadastro Incorporado, vence em 60 dias) só serve no cadastro
-- (subscribed_apps e register). No dia a dia, as chamadas usam o token PERMANENTE do usuário do
-- sistema da Nexa (secret NEXA_META_SYSTEM_TOKEN), atribuído ao WABA do cliente (assigned_users).

-- ================================================================ 1. conexão (sem segredo)
CREATE TABLE public.whatsapp_cloud_conexoes (
  empresa_id uuid PRIMARY KEY REFERENCES public.empresas(id) ON DELETE CASCADE,
  situacao text NOT NULL DEFAULT 'liberado'
    CHECK (situacao IN ('liberado', 'pendente', 'conectado', 'erro', 'desautorizado')),
  waba_id text CHECK (waba_id IS NULL OR waba_id ~ '^[0-9]{5,25}$'),
  phone_number_id text CHECK (phone_number_id IS NULL OR phone_number_id ~ '^[0-9]{5,25}$'),
  numero_exibicao text CHECK (numero_exibicao IS NULL OR length(numero_exibicao) <= 40),
  nome_verificado text CHECK (nome_verificado IS NULL OR length(nome_verificado) <= 200),
  -- Texto curto para a tela; nunca leva token nem resposta crua da Meta.
  erro text CHECK (erro IS NULL OR length(erro) <= 500),
  -- Quem autorizou no Facebook (ID do usuário no app): liga o callback de desautorizar à empresa.
  meta_user_id text CHECK (meta_user_id IS NULL OR length(meta_user_id) <= 100),
  -- Vencimento do token do cliente (só registro; o dia a dia usa o token da Nexa).
  token_cliente_vence_em timestamptz,
  -- O WABA aparece entre as contas de clientes do portfólio da Nexa (Business 1819405918725550)?
  waba_compartilhado boolean,
  -- Usuário do sistema da Nexa atribuído ao WABA (assigned_users, tasks MANAGE).
  atribuicao_ok boolean,
  atribuicao_erro text CHECK (atribuicao_erro IS NULL OR length(atribuicao_erro) <= 500),
  atribuido_em timestamptz,
  desautorizado_em timestamptz,
  liberado_em timestamptz NOT NULL DEFAULT now(),
  conectado_em timestamptz,
  conectado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_whatsapp_cloud_phone ON public.whatsapp_cloud_conexoes (phone_number_id)
  WHERE phone_number_id IS NOT NULL;
CREATE INDEX idx_whatsapp_cloud_waba ON public.whatsapp_cloud_conexoes (waba_id)
  WHERE waba_id IS NOT NULL;
CREATE INDEX idx_whatsapp_cloud_meta_user ON public.whatsapp_cloud_conexoes (meta_user_id)
  WHERE meta_user_id IS NOT NULL;
ALTER TABLE public.whatsapp_cloud_conexoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_cloud_conexoes FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_cloud_conexoes TO authenticated;
GRANT ALL ON public.whatsapp_cloud_conexoes TO service_role;
CREATE POLICY whatsapp_cloud_conexoes_select ON public.whatsapp_cloud_conexoes FOR SELECT TO authenticated
  USING (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')));
CREATE TRIGGER trg_whatsapp_cloud_conexoes_upd BEFORE UPDATE ON public.whatsapp_cloud_conexoes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ================================================================ 2. segredos (só o servidor)
-- Token do cliente (registro e nova tentativa da atribuição; vence em 60 dias) e PIN do registro,
-- criptografados (AES-256-GCM) pela Edge Function com a chave do secret NEXA_META_TOKEN_KEY. O banco
-- nunca vê o texto aberto.
CREATE TABLE public.whatsapp_cloud_segredos (
  empresa_id uuid PRIMARY KEY REFERENCES public.whatsapp_cloud_conexoes(empresa_id) ON DELETE CASCADE,
  token_cifrado text NOT NULL CHECK (length(token_cifrado) BETWEEN 20 AND 4000),
  pin_cifrado text CHECK (pin_cifrado IS NULL OR length(pin_cifrado) BETWEEN 20 AND 400),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.whatsapp_cloud_segredos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_cloud_segredos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.whatsapp_cloud_segredos TO service_role;
CREATE POLICY whatsapp_cloud_segredos_sem_acesso ON public.whatsapp_cloud_segredos
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ================================================================ 3. eventos do webhook
-- O que a Meta manda ao webhook do app Nexa OS (mensagens e status). empresa_id vazio = número sem
-- empresa (ex.: o número de teste da Meta). Evento bruto fica 90 dias (limpeza diária, abaixo).
CREATE TABLE public.whatsapp_cloud_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid REFERENCES public.empresas(id) ON DELETE CASCADE,
  waba_id text,
  phone_number_id text,
  tipo text NOT NULL CHECK (tipo IN ('mensagem', 'status', 'outro')),
  wa_message_id text,
  -- Quem mandou (mensagem) ou para quem foi (status), só dígitos.
  contato text,
  -- Texto curto da mensagem (para a tela de teste); o resto fica no payload.
  texto text CHECK (texto IS NULL OR length(texto) <= 4096),
  status text,
  payload jsonb NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_whatsapp_cloud_eventos_empresa ON public.whatsapp_cloud_eventos (empresa_id, recebido_em DESC);
CREATE INDEX idx_whatsapp_cloud_eventos_phone ON public.whatsapp_cloud_eventos (phone_number_id, recebido_em DESC);
CREATE UNIQUE INDEX uq_whatsapp_cloud_eventos_msg ON public.whatsapp_cloud_eventos (wa_message_id, tipo, coalesce(status, ''))
  WHERE wa_message_id IS NOT NULL;
ALTER TABLE public.whatsapp_cloud_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.whatsapp_cloud_eventos FROM anon, authenticated;
GRANT SELECT ON public.whatsapp_cloud_eventos TO authenticated;
GRANT ALL ON public.whatsapp_cloud_eventos TO service_role;
CREATE POLICY whatsapp_cloud_eventos_select ON public.whatsapp_cloud_eventos FOR SELECT TO authenticated
  USING (empresa_id IS NOT NULL AND empresa_id = (SELECT private.empresa_ativa())
         AND (SELECT private.tem_papel('admin')));

-- ================================================================ 4. pedidos de exclusão (Meta)
-- Callback de exclusão de dados e de desautorizar do app Nexa OS. Sem dado do titular além do ID
-- que a Meta manda (ID do usuário no app).
CREATE TABLE public.meta_exclusao_pedidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z0-9]{10,32}$'),
  origem text NOT NULL CHECK (origem IN ('exclusao', 'desautorizar')),
  meta_user_id text NOT NULL CHECK (length(meta_user_id) <= 100),
  situacao text NOT NULL DEFAULT 'recebido' CHECK (situacao IN ('recebido', 'em_andamento', 'concluido')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz
);
ALTER TABLE public.meta_exclusao_pedidos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_exclusao_pedidos FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.meta_exclusao_pedidos TO service_role;
CREATE POLICY meta_exclusao_pedidos_sem_acesso ON public.meta_exclusao_pedidos
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- ================================================================ 5. guarda de 90 dias
CREATE OR REPLACE FUNCTION private.whatsapp_cloud_limpar_eventos()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  n integer;
BEGIN
  DELETE FROM public.whatsapp_cloud_eventos WHERE recebido_em < now() - interval '90 days';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION private.whatsapp_cloud_limpar_eventos() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.whatsapp_cloud_limpar_eventos() TO service_role;

-- Todo dia às 03:17 (horário de Brasília). Só onde o pg_cron existe (produção).
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL THEN
    PERFORM cron.schedule('whatsapp_cloud_limpar_eventos', '17 6 * * *',
                          'SELECT private.whatsapp_cloud_limpar_eventos()');
  END IF;
END $$;

COMMENT ON TABLE public.whatsapp_cloud_conexoes IS 'WhatsApp Cloud pelo app Nexa OS (Cadastro Incorporado): liberação e situação por empresa. Sem linha = desligado.';
COMMENT ON TABLE public.whatsapp_cloud_segredos IS 'Token e PIN do WhatsApp Cloud por empresa, criptografados pela Edge Function. Só o servidor.';
COMMENT ON TABLE public.whatsapp_cloud_eventos IS 'Eventos do webhook do app Nexa OS (mensagens e status). Guardados por 90 dias.';
COMMENT ON TABLE public.meta_exclusao_pedidos IS 'Pedidos de exclusão e de desautorizar recebidos da Meta pelo app Nexa OS.';

SELECT private.instalar_travas_somente_leitura();
