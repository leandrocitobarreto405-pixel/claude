# Corrigir duplicação de itens na edição da OS + Reincidência no reagendamento

## Parte 1 — Por que os estofados duplicam (causa confirmada)

Ao salvar a edição, o app apaga os itens antigos do atendimento e insere os novos. Mas a regra de acesso da tabela de itens só permite **excluir para administradores**, e o app ignora a falha: a exclusão não acontece, a inserção acontece, e os itens antigos ficam somados aos novos. Por isso "2 sofás e 2 cadeiras" viram 4 e 4, e a cada nova edição duplica outra vez.

Conferi no banco: existem atendimentos com a mesma linha repetida 3, 4 e 5 vezes, com datas de criação diferentes (uma por edição).

### Correção

- Trocar a estratégia de "apagar tudo e reinserir" por uma reconciliação por item: item existente é **atualizado**, item novo é **inserido**, item removido na tela é **desativado** (`active = false`) — sem depender de permissão de exclusão.
- Todas as leituras de itens passam a filtrar apenas itens ativos: formulário de edição da OS, detalhe da OS, lista de OSs criadas, geração do documento no Google Docs e mensagens.
- Qualquer erro nessas gravações passa a ser exibido em pt-BR, em vez de falhar em silêncio.
- **Limpeza dos dados atuais**: em cada atendimento afetado, manter apenas o último conjunto salvo e desativar as repetições anteriores. Nada é apagado fisicamente; valores da OS, total combinado, pagamentos, rotas e documentos não são recalculados por conta da limpeza — apenas a soma dos itens volta a refletir a realidade.
- Após a limpeza, revisar a soma dos itens das OSs afetadas para que a tela pare de mostrar quantidade dobrada. O valor total combinado com o cliente permanece exatamente como está.

## Parte 2 — Reagendamento: reincidência x reagendamento

O diálogo "Reagendar" passa a ter **três** opções:

1. **Reagendar sem deslocamento** — como hoje (o técnico não saiu).
2. **Reagendar mantendo o deslocamento** — como hoje (foi ao local, gastou combustível, não deu para executar; conta rota/combustível e não gera receita).
3. **Reincidência (retorno ao cliente)** — novo caso: o serviço foi feito, mas o cliente precisa de retorno.

### Como funciona a reincidência

- Cria uma **nova OS de reincidência vinculada à OS original**, com número próprio, mesmo cliente, mesmos serviços e itens copiados da OS de origem.
- **Motivo da reincidência é obrigatório**: lista de motivos (mancha retornou, cliente insatisfeito, falha no processo, secagem inadequada, uso indevido pelo cliente, outro) + campo de observações para explicar o caso.
- **Valor padrão R$ 0,00**, mas totalmente editável: se o técnico constatar que a causa foi do cliente, a equipe altera o valor da nova OS normalmente (itens, total combinado, forma de pagamento e cobrança seguem as regras já existentes). Nada fica travado.
- Comissão só existe se houver valor; com R$ 0,00 não gera comissão nem receita, mas o atendimento entra na agenda e na rota/quilometragem do técnico normalmente.
- O atendimento original **permanece concluído** (a receita original não é mexida).
- Na OS original e na nova OS aparece o vínculo ("Reincidência da OS nº ..." / "Gerou a reincidência OS nº ...") e o registro no histórico com motivo, usuário e data.
- Filtro/etiqueta "Reincidência" na página "OSs criadas" e distinção nos indicadores: reincidências com valor zero não inflam faturamento nem metas, mas ficam visíveis como volume de atendimento.

## Detalhes técnicos

- Banco: adicionar em `work_orders` os campos `os_type` ('venda' | 'reincidencia', padrão 'venda'), `origin_work_order_id`, `recurrence_reason`, `recurrence_notes`; em `visits`, permitir `reschedule_type = 'recurrence'` e guardar a OS de reincidência gerada.
- `src/lib/os.ts`: substituir `saveVisitItems` (delete + insert) por reconciliação por `id` com desativação; nova função `createRecurrenceOrder` que clona cliente/serviços/itens com valor zero.
- `src/components/visit-dialog.tsx`: terceira opção no fluxo de reagendamento, com seleção de motivo obrigatório, observações e data/hora/técnico do retorno.
- Consultas em `nova-os.tsx`, `os.$osNumber.tsx`, `oss.tsx` e `os-docs.server.ts` passam a filtrar `active = true` nos itens.
- Limpeza dos duplicados atuais via atualização de dados (desativação), preservando histórico.

## Verificação

Editar no preview a OS que hoje duplica (2 sofás + 2 cadeiras), salvar duas vezes seguidas e confirmar que continua 2 e 2; depois reagendar um atendimento concluído como reincidência e conferir a nova OS com valor zero, o vínculo, o histórico e a ausência de receita nova.
