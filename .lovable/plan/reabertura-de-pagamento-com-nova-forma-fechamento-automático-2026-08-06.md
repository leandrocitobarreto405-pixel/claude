# Reabertura de pagamento com nova forma + fechamento automático de rotas às 23:59

Duas correções pontuais no Turbine Clean. Nada de OS, agenda, Google Docs, mensagens, DRE ou visual muda além do necessário.

## O que verifiquei antes

- Os pagamentos ficam em `payments`, um registro por parte do pagamento, com canal, forma, parcelas, valor bruto, percentual aplicado (`applied_rate`), taxa, valor líquido, data e status ("Não pago", "Parcialmente pago", "Pago", "Estornado", "Cancelado"). As taxas vêm de `payment_rates` por canal + forma + parcelas + vigência.
- Hoje "Marcar como pago" e "Reabrir" na página **Pagamentos** apenas trocam o campo de status — não há modal, então a forma antiga (ex.: Pix) permanece ativa. É exatamente a origem do problema.
- Já existe rotina de fechamento de rota (`syncDailyRoute`) com chave única por técnico + data e chave de idempotência `mileage:{tecnico}:{data}` na despesa; hoje ela é acionada ao concluir serviço e pelos botões da página de rotas.
- Já existe um job agendado mensal (despesas recorrentes) chamando um endpoint interno protegido — vou seguir o mesmo padrão para o fechamento diário. As extensões de agendamento estão ativas.

## Parte 1 — Reabrir pagamento e escolher a nova forma

**Reabrir pagamento** passa a pedir confirmação: "Deseja reabrir este pagamento?" com o texto "O pagamento atual será retirado dos cálculos ativos, mas continuará disponível no histórico." e um campo **Motivo da reabertura** (Forma de pagamento incorreta, Número de parcelas incorreto, Valor informado incorretamente, Pagamento ainda não confirmado, Estorno, Outro).

Ao confirmar:

- O pagamento atual sai dos cálculos ativos (caixa, taxas, líquido) e o valor volta a contas a receber.
- O registro anterior é preservado no histórico com canal, forma, parcelas, valor, percentual, taxa, líquido, data, quem reabriu, quando e o motivo.
- Nada é apagado, a receita da OS não é duplicada nem removida, e a **forma de pagamento combinada** da OS continua intacta.

**Marcar como pago** deixa de aplicar valores antigos: sempre abre o modal **Registrar pagamento** com canal, forma, parcelas (quando cartão de crédito), valor pago, data, status e observação. Aparece também no primeiro registro, em serviço não pago e ao acrescentar parcela em pagamento parcial.

No modal, um cartão pequeno **Pagamento anterior** mostra forma, valor e data anteriores, apenas como referência. Os campos começam vazios; só o botão **Reutilizar dados anteriores** copia os valores.

Ao confirmar: busca a taxa ativa por canal + forma + parcelas + vigência, guarda o percentual como histórico do lançamento, recalcula taxa (`valor × %/100`) e líquido (`valor − taxa`), e atualiza pagamentos, caixa, contas a receber, relatórios e a taxa no DRE. Taxas históricas não são alteradas.

**Editar pagamento** (na página de pagamentos e no detalhe da OS) permite corrigir canal, forma, parcelas, valor, data e observação, com confirmação, preservação do valor anterior no histórico e recálculo de taxa e líquido — sem criar pagamento duplicado.

Pagamentos divididos continuam independentes: reabrir uma parte não afeta as outras.

## Parte 2 — Fechamento automático das rotas às 23:59

Todo dia às **23:59 (America/São Paulo)** o sistema fecha as rotas sozinho: para cada técnico com atendimentos elegíveis na data local, monta o trajeto (base → paradas na ordem dos horários → base), calcula a quilometragem, aplica o custo por km, rateia igualmente entre as OSs elegíveis e cria **uma** despesa de quilometragem por técnico e data, sempre **Pendente**, nunca paga automaticamente.

Elegíveis: Concluído; Reagendado com deslocamento (com deslocamento e preservação da rota); cancelado após deslocamento. Ficam fora: cancelado antes do deslocamento, reagendado sem deslocamento, excluídos, sem técnico e sem endereço válido.

Atendimentos ainda em aberto às 23:59 não entram como deslocamento e não travam o cálculo: a rota é feita com os finalizados e fica o aviso "Existem atendimentos do dia que ainda não foram finalizados.", com a lista pendente. Ao finalizar depois, a rota é marcada para recálculo, recalcula sozinha e **atualiza** a despesa pendente existente (sem criar uma segunda).

Sem custo por km: os km são salvos, a despesa monetária não é criada, o status fica "Aguardando custo por km" com a mensagem "Rota calculada, mas o custo por km ainda não foi configurado."; quando o custo for configurado, as rotas pendentes são processadas automaticamente.

Status de rota: Aguardando fechamento diário, Calculando, Calculada, Aguardando custo por km, Custo gerado, Recalculada, Erro no cálculo, Possui atendimentos não finalizados. Origem do cálculo: "Automática — fechamento diário".

Se a despesa já estiver paga e a rota mudar, nada muda em silêncio: aparece "A rota foi alterada após o pagamento da despesa." com valor pago, novo valor e diferença, e as ações Criar ajuste financeiro, Manter valor pago e Reabrir despesa como pendente (lógica atual preservada).

Rede de segurança: além do job, o sistema verifica rotas passadas sem despesa ao concluir serviço de data anterior, ao abrir o app e ao abrir "Rotas e quilometragem" — processando só o que falta. O botão **Sincronizar rotas pendentes** fica apenas como recurso de correção.

Erro em um técnico não interrompe os outros; as mensagens seguem em português ("Não foi possível calcular a rota do técnico.", "Existem atendimentos sem endereço válido.", "Já existe uma despesa de quilometragem para este técnico e esta data." etc.).

**Início** ganha os indicadores com link direto: rotas calculadas hoje, rotas aguardando fechamento, rotas com erro, rotas aguardando custo por km, quilometragem pendente de pagamento e atendimentos não finalizados.

A página "Rotas e quilometragem" continua completa (visualizar, recalcular, km real, custo por km, rateio, sincronizar custo, abrir despesa, ver erros) — só deixa de ser necessária no dia a dia.

## Parte técnica

- Migração: `payment_history` (pagamento, valores/canal/forma/parcelas/percentual/taxa/líquido anteriores, data, quem, quando, motivo, tipo do evento) com grants + RLS de staff; `payments` ganha marcação de inativo/estornado e vínculo com o evento; `daily_routes` ganha `last_auto_sync_at` e os novos status; `job_runs` (nome, data de referência, início, fim, status, técnicos processados, rotas criadas/atualizadas/ignoradas, despesas criadas/atualizadas, erros); índice único parcial garantindo uma rota e uma despesa ativas por técnico + data; opções de motivo de reabertura em `config_options`.
- `src/lib/payments.ts` (novo, seguindo o padrão de `expenses.ts`): `reopenPayment`, `registerPayment`, `editPayment`, todos gravando histórico e recalculando taxa/líquido com `rateFor` de `src/lib/data.ts`.
- `src/components/payment-dialog.tsx` (novo): modal único de registro/edição, com cartão "Pagamento anterior" e "Reutilizar dados anteriores"; usado por `pagamentos.tsx` e `os.$osNumber.tsx`. `mudarStatus` em `pagamentos.tsx` deixa de escrever status direto.
- `src/lib/route-auto.server.ts`: novos status/origem, `last_auto_sync_at`, atualização (não duplicação) da despesa pendente; novo `closeDailyRoutes(db, { date })` percorrendo os técnicos com tolerância a falhas e gravando `job_runs`.
- `src/routes/api/public/hooks/daily-route-closing.ts` (novo, mesmo padrão de autenticação por `apikey` do hook de recorrentes) + `cron.schedule` diário `59 2 * * *` UTC = 23:59 em São Paulo, com a data local derivada no handler.
- `src/lib/routes.functions.ts`: server functions `sincronizarRotasPendentes` e `fecharRotasDoDia` para a recuperação e o botão manual; `rotas.tsx` e `inicio.tsx` consomem status/indicadores; `reports.ts` passa a ignorar pagamentos inativos no caixa, taxas e contas a receber.
