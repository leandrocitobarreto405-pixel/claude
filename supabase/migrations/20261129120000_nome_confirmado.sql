-- Nome do cliente confirmado (todas as empresas).
--
-- O nome do perfil do WhatsApp (whatsapp_contacts.profile_name) às vezes não é nome de pessoa
-- ("Sou mais Jesus", "Cacau", loja, emoji). A Alice passa a guardar o nome confirmado num campo
-- separado, com a origem, e é esse nome que vai para a OS, o orçamento e os modelos. O nome do
-- perfil continua como está, só como referência.
--   whatsapp_contacts.nome_confirmado / _origem / _em: o nome da pessoa (vale para as próximas
--     conversas: cliente com nome confirmado não é perguntado de novo).
--   conversas.nome_confirmado / _origem: o nome nesta conversa.
--   conversas.nome_perguntas: quantas vezes a Alice perguntou o nome nesta conversa (no máximo 2).
-- Origem: perfil (nome do perfil aceito), cliente (o cliente disse), cadastro (nome da OS / cliente
-- cadastrado), equipe (corrigido pela equipe).
-- Só acrescenta colunas; nada é apagado nem alterado. O webhook do Chatwoot não mexe nelas.
ALTER TABLE public.whatsapp_contacts
  ADD COLUMN IF NOT EXISTS nome_confirmado text,
  ADD COLUMN IF NOT EXISTS nome_confirmado_origem text,
  ADD COLUMN IF NOT EXISTS nome_confirmado_em timestamptz;
ALTER TABLE public.whatsapp_contacts
  ADD CONSTRAINT whatsapp_contacts_nome_confirmado_origem_check
  CHECK (nome_confirmado_origem IS NULL OR nome_confirmado_origem IN ('perfil', 'cliente', 'cadastro', 'equipe'));

ALTER TABLE public.conversas
  ADD COLUMN IF NOT EXISTS nome_confirmado text,
  ADD COLUMN IF NOT EXISTS nome_confirmado_origem text,
  ADD COLUMN IF NOT EXISTS nome_perguntas smallint NOT NULL DEFAULT 0;
ALTER TABLE public.conversas
  ADD CONSTRAINT conversas_nome_confirmado_origem_check
  CHECK (nome_confirmado_origem IS NULL OR nome_confirmado_origem IN ('perfil', 'cliente', 'cadastro', 'equipe'));
ALTER TABLE public.conversas
  ADD CONSTRAINT conversas_nome_perguntas_check CHECK (nome_perguntas BETWEEN 0 AND 10);
