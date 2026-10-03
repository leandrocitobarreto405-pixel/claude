-- Cidade e estado da empresa (aprovado em 03/10/2026): entram empresas de outras cidades e estados.
-- Só acrescenta campos; a Turbine Clean fica com São Paulo/SP. (O fuso por empresa fica para quando
-- entrar uma empresa de AM, RR, RO, MT, MS ou AC — ver docs/nexa-os/PUBLICACOES.md.)
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS cidade text CHECK (cidade IS NULL OR length(btrim(cidade)) BETWEEN 2 AND 80),
  ADD COLUMN IF NOT EXISTS estado text CHECK (estado IS NULL OR estado IN (
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR',
    'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'));
UPDATE public.empresas SET cidade = 'São Paulo', estado = 'SP'
 WHERE id = '11111111-1111-1111-1111-111111111111' AND cidade IS NULL AND estado IS NULL;
