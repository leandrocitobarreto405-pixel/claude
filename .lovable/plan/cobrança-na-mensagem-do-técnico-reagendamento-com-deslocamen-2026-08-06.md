# Cobrança na mensagem do técnico + Reagendamento com deslocamento

Duas correções operacionais, sem tocar em financeiro, Google Docs, valores de itens, total negociado ou taxas.

## Parte 1 — Momento da cobrança na mensagem do técnico

### Respostas às perguntas pedidas

- **Função alterada:** `visitMessageContext` / `renderMessage` em `src/lib/os.ts` (usadas por `mensagens.tsx` e pelo diálogo da visita). Nenhuma outra função de mensagem existe.
- **Onde a regra fica salva:** na própria OS (`work_orders`), campos novos `collection_rule`, `collection_visit_id`, `payment_instruction`, `collection_configuration_updated_at`. Não há sistema de pagamento novo.
- **Como a visita de cobrança é escolhida:** se `collection_visit_id` estiver preenchido, ela manda. Senão a regra decide: impermeabilização → última visita ativa de impermeabilização por data+hora; higienização → primeira visita ativa de higienização; visita específica exige seleção manual.
- **Como evitar valor duplicado:** o total só aparece na visita de cobrança calculada (uma única visita por OS). Todas as outras recebem instrução "não cobrar". Se as duas datas coincidirem, ainda assim só a visita de cobrança mostra o valor; visita com os dois serviços mostra "Higienização e Impermeabilização" e o total uma vez.

### Banco

Migração mínima em `work_orders`:

- `collection_rule text not null default 'split_by_service'`
- `collection_visit_id uuid` (referência a `visits`)
- `payment_instruction text` (instrução personalizada, quando editada)
- `collection_configuration_updated_at timestamptz`

Valores: `cleaning_visit`, `waterproofing_visit`, `split_by_service`, `specific_visit`, `prepaid`, `no_on_site_collection`. OSs históricas não são alteradas; combinadas sem regra usam a impermeabilização como fallback apenas na geração da mensagem.

### Lógica de mensagem (`src/lib/os.ts`)

Nova função pura que recebe a visita, as visitas ativas da OS e a configuração de cobrança, e devolve os campos:
`{{INSTRUCAO_PAGAMENTO}}`, `{{VALOR_A_COBRAR}}`, `{{VALOR_TOTAL_COMBINADO}}`, `{{VALOR_DO_SERVICO}}`, `{{FORMA_PAGAMENTO_COMBINADA}}`, `{{DATA_VISITA_COBRANCA}}`, `{{SERVICO_VISITA_COBRANCA}}`.

Textos por regra, exatamente como especificado (não cobrar / valor total a cobrar / valor a cobrar neste atendimento / antecipado / não cobrar no local). O template padrão passa a usar `{{INSTRUCAO_PAGAMENTO}}` no lugar de `Valor: {{valor_formatado}}`; os placeholders antigos continuam funcionando para templates já salvos. Se `payment_instruction` estiver preenchida manualmente, ela substitui a instrução automática.

A consulta de mensagens passa a trazer também as demais visitas da OS e a configuração de cobrança. Mensagem é sempre recalculada na leitura, então qualquer mudança (regra, visita, total, forma, data, tipo de serviço, instrução) reflete na hora.

### Interface (pt-BR)

Seção **"Momento da cobrança"** dentro da área de pagamento existente:

- `nova-os.tsx` (criação e edição): seletor com as 6 opções, seletor de visita quando "Cobrar em uma visita específica", campo "Instrução de cobrança para a equipe" com botão "Restaurar instrução automática". Padrão para OS nova com higienização + impermeabilização ativas: "Cobrar na impermeabilização".
- `os.$osNumber.tsx`: mesma seção editável no bloco de pagamento, com prévia da instrução.

Nada é lançado em pagamentos, DRE ou fluxo de caixa; é só instrução operacional. Documentos do Google Docs não são marcados como desatualizados por mudança de instrução de cobrança.

## Parte 2 — Reagendar mantendo o deslocamento

### Banco

Campos novos em `visits`:

- `reschedule_type text` (`no_travel` | `with_travel`)
- `technician_travel_occurred boolean not null default false`
- `preserve_original_route boolean not null default false`
- `rescheduled_from_visit_id uuid`, `rescheduled_to_visit_id uuid`
- `reschedule_reason text`, `reschedule_notes text`
- `original_scheduled_date date`, `rescheduled_at timestamptz`, `rescheduled_by uuid`

Novo status de visita: **"Reagendado com deslocamento"** (adicionado a `VISIT_STATUSES` e ao mapa de cores).

### Fluxo no diálogo da visita

O botão "Reagendar" abre a pergunta "Como este atendimento deve ser reagendado?" com duas opções:

- **Reagendar sem deslocamento** — comportamento atual (move a visita, sai da rota original, rota marcada para recálculo).
- **Reagendar mantendo o deslocamento** — mantém a visita original na data original com status "Reagendado com deslocamento", `technician_travel_occurred = true`, `preserve_original_route = true`, motivo (cliente ausente, não foi possível realizar, problema no local, falta de acesso, estofado sem condição, cliente solicitou nova data, outro) e observações; cria uma nova visita vinculada com nova data/hora/técnico, mesma OS, mesmo tipo de serviço e cópia dos itens de serviço. Sem nova OS, sem duplicar o total negociado.

### Rota e quilometragem

- `ACTIVE_PENDING_STATUSES` deixa de bloquear o cálculo por causa de "Reagendado com deslocamento": esse status conta como **finalizado para cálculo de rota**, mas nunca como concluído para receita/comissão.
- O cálculo do trajeto inclui a parada da visita reagendada com deslocamento na data original.
- Idempotência atual mantida: uma despesa de combustível por rota/dia; sem duplicar. Se a rota já existia sem a parada, ela é marcada para recálculo; se a despesa já está paga, segue o fluxo existente de diferença financeira, sem alterar valor pago em silêncio.

### Agenda, mensagens, histórico e exclusão

- Agenda: badge "Reagendado com deslocamento" + "Novo atendimento: {{NOVA_DATA}} às {{NOVO_HORARIO}}"; na nova visita, "Reagendado do atendimento de {{DATA_ORIGINAL}}", com link entre as duas.
- Mensagens: a visita original com deslocamento não gera mensagem de agendamento; a nova visita gera normalmente, já com as regras de cobrança da Parte 1.
- Histórico da OS: registro do tipo "Visita de 04/08/2026 reagendada para 06/08/2026 com deslocamento preservado.", com motivo, usuário, data/hora, preservação de rota e ID da nova visita.
- Tentativa de excluir a visita original avisa: "Este atendimento possui deslocamento contabilizado. A exclusão poderá alterar a rota e o custo de quilometragem." com confirmação e motivo.

## Verificação

Testes manuais no preview: OS combinada 10/08 + 11/08 com total R$ 700,00 nas três regras (impermeabilização, separado, antecipado); reagendamento com e sem deslocamento para o técnico Josué, conferindo rota, despesa pendente única e ausência de receita na visita incompleta.
