-- Roteiro da Alice por serviço (26/10/2026): núcleo (instrucoes) + módulos carregados sob demanda.
-- 1. ia_configuracoes.modulos: lista de { chave, titulo, texto } da empresa (vazia = roteiro inteiro
--    em instrucoes, como antes).
-- 2. conversas.alice_modulos: módulos já carregados na conversa (vêm junto nas próximas respostas).
-- 3. Upsell depois do agendamento: desconto do item adicional no mesmo atendimento, por empresa
--    (desligado por padrão, 20% sugerido). Substitui o preço de adicional fixo quando ligado.
-- Só acrescenta colunas.
ALTER TABLE public.ia_configuracoes
  ADD COLUMN IF NOT EXISTS modulos jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(modulos) = 'array');

ALTER TABLE public.conversas
  ADD COLUMN IF NOT EXISTS alice_modulos text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.orcamento_configuracoes
  ADD COLUMN IF NOT EXISTS desconto_upsell_ligado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS desconto_upsell_pct numeric(5,2) NOT NULL DEFAULT 20
    CHECK (desconto_upsell_pct BETWEEN 0 AND 100);
