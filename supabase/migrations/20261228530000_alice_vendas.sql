-- Alice e vendas, foco nas primeiras 48 horas (plano aprovado pelo dono em 12/11).
-- Uma migração só para o plano inteiro. Só cria: três tabelas novas, colunas novas com padrão em
-- ia_configuracoes e mais valores aceitos em duas listas. Nada é apagado nem alterado nas tabelas
-- que já existem, e nenhuma linha de dados muda.
--
-- TUDO NASCE DESLIGADO: as chaves novas de ia_configuracoes começam em false. Nenhuma mensagem sai
-- e nenhum comportamento da Alice muda só por rodar esta migração.
--
-- 1. ia_configuracoes: chaves (ligar/desligar) e parâmetros de cada item do plano.
-- 2. alice_autorizacoes: pedido de autorização de desconto (item 5), com o placar.
-- 3. alice_transferencias: transferência da Alice para a equipe, com o alarme (item 7).
-- 4. alice_eventos: medição (item 12).
-- 5. push_envios: tipos novos de push. 6. quotes: tipos novos de desconto (combo, negociação).

-- ---------------------------------------------------------------- 1. chaves e parâmetros
ALTER TABLE public.ia_configuracoes
  -- Item 1: atalho do apressado (item + CEP + pedido explícito de preço: orçamento sem mais pergunta).
  ADD COLUMN IF NOT EXISTS atalho_apressado boolean NOT NULL DEFAULT false,
  -- Item 3: a Alice orça o combo higienização + impermeabilização com desconto.
  ADD COLUMN IF NOT EXISTS combo_ligado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS combo_pct numeric(5, 2) NOT NULL DEFAULT 10
    CHECK (combo_pct >= 0 AND combo_pct <= 30),
  -- Item 5: desconto com autorização. Teto total (combo, cupom e negociação juntos); com Pix; minutos
  -- sem resposta até a Alice seguir sozinha dentro do teto; minutos mínimos antes de ela voltar.
  ADD COLUMN IF NOT EXISTS negociacao_ligada boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS negociacao_teto_pct numeric(5, 2) NOT NULL DEFAULT 12
    CHECK (negociacao_teto_pct >= 0 AND negociacao_teto_pct <= 30),
  ADD COLUMN IF NOT EXISTS negociacao_teto_pix_pct numeric(5, 2) NOT NULL DEFAULT 15
    CHECK (negociacao_teto_pix_pct >= 0 AND negociacao_teto_pix_pct <= 30),
  ADD COLUMN IF NOT EXISTS negociacao_espera_min integer NOT NULL DEFAULT 10
    CHECK (negociacao_espera_min BETWEEN 1 AND 120),
  ADD COLUMN IF NOT EXISTS negociacao_volta_min integer NOT NULL DEFAULT 4
    CHECK (negociacao_volta_min BETWEEN 1 AND 30),
  -- Item 6: retorno combinado pela equipe; sem a equipe chamar em N minutos, a Alice chama.
  ADD COLUMN IF NOT EXISTS retorno_alice_cobre boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retorno_alice_cobre_min integer NOT NULL DEFAULT 15
    CHECK (retorno_alice_cobre_min BETWEEN 1 AND 240),
  -- Item 7: alarme da transferência sem resposta e o prazo que a Alice diz ao cliente.
  ADD COLUMN IF NOT EXISTS alarme_transferencia boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS transferencia_prazo_min integer NOT NULL DEFAULT 10
    CHECK (transferencia_prazo_min BETWEEN 1 AND 240),
  -- Item 8: retomada da manhã (toque 3) enviada pela Alice às 8h.
  ADD COLUMN IF NOT EXISTS retomada_manha_alice boolean NOT NULL DEFAULT false,
  -- Item 9: follow-up 5 novo. O desconto TOTAL chega a este teto e nunca passa; o valor final
  -- nunca fica abaixo do piso (pedido mínimo).
  ADD COLUMN IF NOT EXISTS followup5_novo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup5_total_pct numeric(5, 2) NOT NULL DEFAULT 20
    CHECK (followup5_total_pct >= 0 AND followup5_total_pct <= 40),
  ADD COLUMN IF NOT EXISTS followup5_piso numeric(12, 2) NOT NULL DEFAULT 200
    CHECK (followup5_piso >= 0),
  -- Item 10: fora da área. Até esta distância e acima deste valor de pedido, a equipe decide.
  ADD COLUMN IF NOT EXISTS fora_area_regra boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fora_area_decisao_km numeric(6, 1) NOT NULL DEFAULT 50
    CHECK (fora_area_decisao_km >= 0),
  ADD COLUMN IF NOT EXISTS fora_area_pedido_minimo numeric(12, 2) NOT NULL DEFAULT 1000
    CHECK (fora_area_pedido_minimo >= 0),
  -- Item 11: push só para o admin quando a Alice para de responder e há cliente esperando.
  ADD COLUMN IF NOT EXISTS aviso_fora_do_ar boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------- 2. pedido de autorização
CREATE TABLE IF NOT EXISTS public.alice_autorizacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  -- pendente: esperando a equipe. autorizado: aceitaram o valor sugerido. outro_valor: digitaram
  -- outro. negado. automatico: ninguém respondeu no prazo e a Alice seguiu dentro do teto.
  -- assumido: alguém da equipe entrou na conversa. cancelado: o cliente desistiu ou fechou antes.
  situacao text NOT NULL DEFAULT 'pendente'
    CHECK (situacao IN ('pendente', 'autorizado', 'outro_valor', 'negado', 'automatico', 'assumido', 'cancelado')),
  -- O que o pedido mostra, guardado como estava na hora (o orçamento pode mudar depois).
  itens jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(itens) = 'array'),
  servico text CHECK (servico IS NULL OR servico IN ('higienizacao', 'impermeabilizacao', 'combo')),
  distancia_km numeric(6, 1) CHECK (distancia_km IS NULL OR distancia_km >= 0),
  bairro text CHECK (bairro IS NULL OR length(bairro) <= 120),
  valor_cheio numeric(12, 2) NOT NULL CHECK (valor_cheio > 0),
  valor_pix numeric(12, 2) CHECK (valor_pix IS NULL OR valor_pix > 0),
  -- Desconto que o orçamento já tinha antes do pedido (combo, cupom, campanha, indicação).
  desconto_atual_tipo text
    CHECK (desconto_atual_tipo IS NULL OR desconto_atual_tipo IN ('combo', 'cupom', 'campanha', 'indicacao')),
  desconto_atual_valor numeric(12, 2) NOT NULL DEFAULT 0 CHECK (desconto_atual_valor >= 0),
  cupom text CHECK (cupom IS NULL OR length(cupom) <= 40),
  concorrente_nome text CHECK (concorrente_nome IS NULL OR length(concorrente_nome) <= 120),
  concorrente_valor numeric(12, 2) CHECK (concorrente_valor IS NULL OR concorrente_valor > 0),
  frase_cliente text CHECK (frase_cliente IS NULL OR length(frase_cliente) <= 500),
  -- Sugestão da Alice: valor final, e quanto isso dá de desconto no total, sobre o valor cheio.
  valor_sugerido numeric(12, 2) NOT NULL CHECK (valor_sugerido > 0),
  desconto_valor numeric(12, 2) NOT NULL CHECK (desconto_valor >= 0),
  desconto_pct numeric(5, 2) NOT NULL CHECK (desconto_pct >= 0 AND desconto_pct <= 100),
  -- Quanto ainda falta para igualar o concorrente quando ele está abaixo do teto.
  falta_para_igualar numeric(12, 2) CHECK (falta_para_igualar IS NULL OR falta_para_igualar >= 0),
  -- true: dentro do teto e sem cupom; sem resposta até prazo_em, a Alice segue com o sugerido.
  -- false (cupom, ou acima do teto): só com autorização.
  segue_sozinha boolean NOT NULL DEFAULT false,
  prazo_em timestamptz,
  -- A Alice só volta ao cliente depois deste horário, mesmo que autorizem antes.
  voltar_apos timestamptz NOT NULL,
  fora_do_horario boolean NOT NULL DEFAULT false,
  valor_final numeric(12, 2) CHECK (valor_final IS NULL OR valor_final > 0),
  respondido_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  respondido_em timestamptz,
  cliente_avisado_em timestamptz,
  -- Placar: fechou ou não depois do desconto.
  fechou boolean,
  fechou_em timestamptz,
  ultimo_push_em timestamptz,
  pushes integer NOT NULL DEFAULT 0 CHECK (pushes >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT alice_autorizacoes_valor_final CHECK (
    situacao NOT IN ('autorizado', 'outro_valor', 'automatico') OR valor_final IS NOT NULL),
  CONSTRAINT alice_autorizacoes_prazo CHECK (NOT segue_sozinha OR prazo_em IS NOT NULL),
  CONSTRAINT alice_autorizacoes_sugerido CHECK (valor_sugerido <= valor_cheio)
);
-- Um pedido pendente por conversa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alice_autorizacoes_pendente
  ON public.alice_autorizacoes (conversa_id) WHERE situacao = 'pendente';
CREATE INDEX IF NOT EXISTS idx_alice_autorizacoes_empresa ON public.alice_autorizacoes (empresa_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_alice_autorizacoes_lead ON public.alice_autorizacoes (crm_lead_id);

ALTER TABLE public.alice_autorizacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alice_autorizacoes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.alice_autorizacoes TO authenticated;
GRANT ALL ON public.alice_autorizacoes TO service_role;
-- A equipe da empresa lê (admin e atendente). Quem grava é o servidor (autorizar, negar, outro valor).
DROP POLICY IF EXISTS alice_autorizacoes_select ON public.alice_autorizacoes;
CREATE POLICY alice_autorizacoes_select ON public.alice_autorizacoes FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa())
   AND ((SELECT private.tem_papel('admin')) OR (SELECT private.tem_papel('atendente'))))
  OR (SELECT private.is_nexa_admin()));
COMMENT ON TABLE public.alice_autorizacoes IS 'Pedido de autorização de desconto criado pela Alice (plano "Alice e vendas", item 5): o que o pedido mostrou, quem respondeu, em quanto tempo, o valor final e se fechou. Leitura da equipe da empresa; gravação só pelo servidor.';

-- ---------------------------------------------------------------- 3. transferência com alarme
CREATE TABLE IF NOT EXISTS public.alice_transferencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  conversa_id uuid NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  motivo text NOT NULL CHECK (length(motivo) BETWEEN 1 AND 200),
  -- Resumo da Alice para a equipe não repetir pergunta (aparece no topo da conversa).
  resumo text CHECK (resumo IS NULL OR length(resumo) <= 2000),
  valor_sugerido numeric(12, 2) CHECK (valor_sugerido IS NULL OR valor_sugerido > 0),
  -- Prazo que a Alice disse ao cliente; é ele que vira o alarme.
  prazo_em timestamptz,
  fora_do_horario boolean NOT NULL DEFAULT false,
  -- Fora do horário: a tarefa da manhã criada para a equipe.
  tarefa_id uuid REFERENCES public.crm_followups(id) ON DELETE SET NULL,
  criada_em timestamptz NOT NULL DEFAULT now(),
  -- Quando alguém da equipe respondeu na conversa (o alarme para).
  respondida_em timestamptz,
  respondida_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ultimo_push_em timestamptz,
  pushes integer NOT NULL DEFAULT 0 CHECK (pushes >= 0)
);
-- Uma transferência em aberto por conversa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alice_transferencias_aberta
  ON public.alice_transferencias (conversa_id) WHERE respondida_em IS NULL;
CREATE INDEX IF NOT EXISTS idx_alice_transferencias_empresa ON public.alice_transferencias (empresa_id, criada_em DESC);

ALTER TABLE public.alice_transferencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alice_transferencias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.alice_transferencias TO authenticated;
GRANT ALL ON public.alice_transferencias TO service_role;
DROP POLICY IF EXISTS alice_transferencias_select ON public.alice_transferencias;
CREATE POLICY alice_transferencias_select ON public.alice_transferencias FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa())
   AND ((SELECT private.tem_papel('admin')) OR (SELECT private.tem_papel('atendente'))))
  OR (SELECT private.is_nexa_admin()));
COMMENT ON TABLE public.alice_transferencias IS 'Transferência da Alice para a equipe (plano "Alice e vendas", item 7): motivo, resumo, prazo dito ao cliente, quando a equipe respondeu e quantos pushes saíram. Leitura da equipe da empresa; gravação só pelo servidor.';

-- ---------------------------------------------------------------- 4. medição
CREATE TABLE IF NOT EXISTS public.alice_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  -- atalho_apressado, combo_orcado, orcamento_enviado, foto_dispensada, encaixe, retomada_manha…
  tipo text NOT NULL CHECK (tipo ~ '^[a-z0-9_]{2,40}$'),
  conversa_id uuid REFERENCES public.conversas(id) ON DELETE SET NULL,
  crm_lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  quote_id uuid REFERENCES public.quotes(id) ON DELETE SET NULL,
  -- Só números e identificadores internos; nunca texto de cliente.
  dados jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dados) = 'object'),
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alice_eventos_empresa ON public.alice_eventos (empresa_id, tipo, criado_em);

ALTER TABLE public.alice_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alice_eventos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.alice_eventos TO authenticated;
GRANT ALL ON public.alice_eventos TO service_role;
-- Medição: o admin da empresa e a Nexa leem.
DROP POLICY IF EXISTS alice_eventos_select ON public.alice_eventos;
CREATE POLICY alice_eventos_select ON public.alice_eventos FOR SELECT TO authenticated USING (
  (empresa_id = (SELECT private.empresa_ativa()) AND (SELECT private.tem_papel('admin')))
  OR (SELECT private.is_nexa_admin()));
COMMENT ON TABLE public.alice_eventos IS 'Medição do plano "Alice e vendas" (item 12): uma linha por evento (atalho usado, combo orçado, orçamento enviado…), para comparar em 30 dias. Sem texto de cliente.';

-- ---------------------------------------------------------------- 5. tipos novos de push
-- Os tipos que já existiam continuam aceitos; entram quatro.
ALTER TABLE public.push_envios DROP CONSTRAINT IF EXISTS push_envios_tipo_check;
ALTER TABLE public.push_envios ADD CONSTRAINT push_envios_tipo_check
  CHECK (tipo IN ('cliente_esperando', 'servico_concluido', 'campanha_aprovacao', 'agendamento_promocao',
                  'resumo_dia', 'teste', 'tatiana_tarefas', 'tatiana_cobrancas',
                  'cliente_esperando_2h', 'equipe_sem_push', 'alerta_gerente',
                  'autorizacao_desconto', 'transferencia_alice', 'retorno_combinado', 'alice_fora_do_ar'));

-- ---------------------------------------------------------------- 6. tipos novos de desconto
-- Os tipos que já existiam continuam aceitos; entram combo e negociação.
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_desconto_tipo_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_desconto_tipo_check
  CHECK (desconto_tipo IN ('campanha', 'indicacao', 'manual', 'combo', 'negociacao'));

-- Empresa só de leitura (cancelada/suspensa) também não grava nas tabelas novas.
SELECT private.instalar_travas_somente_leitura();
