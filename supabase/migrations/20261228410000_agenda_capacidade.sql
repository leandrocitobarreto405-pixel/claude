-- Agenda real (02/11/2026, todas as empresas): capacidade do técnico.
-- A regra de ocupação por sobreposição (cada atendimento ocupa o técnico por
-- agenda_configuracoes.duracao_atendimento_min a partir da hora marcada; visita sem técnico ocupa
-- todos) fica no app. Aqui entram só os dois campos novos:
-- 1. visits.ocupa_dia: true = ocupa o dia inteiro do técnico; false = só o horário; null =
--    automático (pela soma do dia).
-- 2. agenda_configuracoes.dia_inteiro_valor: a soma dos atendimentos do técnico no dia a partir
--    deste valor ocupa o dia inteiro (padrão R$ 1.000; 0 = regra do valor desligada).
ALTER TABLE public.visits ADD COLUMN IF NOT EXISTS ocupa_dia boolean;
ALTER TABLE public.agenda_configuracoes
  ADD COLUMN IF NOT EXISTS dia_inteiro_valor numeric(12,2) NOT NULL DEFAULT 1000
    CHECK (dia_inteiro_valor >= 0);
