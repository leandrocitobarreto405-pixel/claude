# Corrigir "Salvar rota" e lançar o combustível em Despesas

## O erro ao salvar

Confirmei a causa no banco: a tabela de rotas diárias tem chave única por **técnico + dia**, mas a tela tenta salvar usando apenas o **dia**. Como essa combinação não existe, o banco recusa a gravação e aparece "não foi possível salvar a rota".

Correção: gravar a rota buscando primeiro se já existe um registro daquele dia para aquele técnico; se existir, atualiza; se não, cria. Isso também funciona quando o filtro está em "Todos" (sem técnico).

Além disso a tela vai mostrar a mensagem real do erro no aviso, para qualquer falha futura ficar clara.

## Salvar a rota vai lançar em Despesas?

Hoje **não** — salvar só grava a quilometragem e rateia o custo entre os serviços do dia. Vou passar a lançar também:

- Uma despesa de categoria **Combustível**, com data de competência = dia da rota, valor = km × R$ 0,57, descrição no formato "Combustível — Josué — 03/08/2026", status "Pago".
- Se você recalcular e salvar de novo o mesmo dia/técnico, a despesa existente é **atualizada** (não duplica).
- Essa despesa entra normalmente no DRE como custo variável, junto com as demais.

O rateio por serviço continua existindo (é o que mostra o custo dentro de cada atendimento), mas o valor que conta no financeiro é a despesa única do dia — sem contagem dobrada.

## Sobre a diferença de ~5 km

O cálculo usa o trajeto rodoviário de mapas gratuitos, sem a volta para casa e sem desvios reais (trânsito, retorno a algum ponto). A diferença de poucos km é esperada; o campo de ajuste manual com motivo continua disponível e, quando preenchido, é ele que vira a despesa.

## Parte técnica

- `src/routes/_authenticated/rotas.tsx`: substituir o `upsert(..., { onConflict: "route_date" })` por seleção prévia (`route_date` + `technician_id` nulo ou igual) seguida de `update` ou `insert`; exibir `error.message` no toast.
- Mesmo fluxo grava/atualiza uma linha em `expenses` (categoria "Combustível", `competence_date` = dia, `expected_amount`/`actual_amount` = custo total, `status` = "Pago", `notes` com km e R$/km) identificada pela descrição do dia/técnico.
- Nenhuma mudança de schema é necessária.
