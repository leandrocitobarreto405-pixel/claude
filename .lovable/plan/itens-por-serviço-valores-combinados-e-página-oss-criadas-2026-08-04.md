# Itens por serviço, valores combinados e página "OSs criadas"

Atualização controlada do Turbine Clean. Nada de login, agenda, DRE, comissões, rotas, despesas, exportações, conexão Google, modelos ou pasta configurada é recriado. A integração com o Google Docs continua a mesma — só muda o conteúdo enviado para a tabela de itens.

## O que existe hoje (verificado)

- Cada serviço (tabela `visits`) guarda **um único** estofado: tipo, descrição, `item_quantity` e `visit_value`. Daí vem o erro "6 poltronas e sofá".
- A OS (`work_orders`) tem `total_gross_value`, `manual_total_reason`, `negotiated_payment_method` e `negotiated_installments`. Não existe campo de texto do valor exibido na OS, nem cancelamento/exclusão com histórico.
- Documentos ficam em `work_order_documents` (versão, status, link) e já detectam "Desatualizado" comparando com a alteração da OS.
- Menu atual não tem "OSs criadas"; a página de detalhe da OS existe, mas simplificada.
- Opções de negócio ficam em `config_options` (por `kind`), então dá para acrescentar motivos de ajuste sem código.

## Banco (uma migração, sem apagar nada)

- Nova tabela **`service_items`**: `visit_id`, `upholstery_type_id`, `description`, `quantity`, `unit_price`, `subtotal`, `item_group_id`, `display_order`, `active`, timestamps — com as mesmas regras de acesso das outras tabelas (equipe lê/edita, admin exclui).
- **Migração dos dados atuais**: cada serviço existente gera automaticamente 1 item com o tipo, descrição, quantidade e valor atuais. Nenhum total, agendamento, link de documento ou lançamento financeiro é recalculado. As colunas antigas de `visits` continuam existindo (compatibilidade), mas o formulário novo não as usa mais.
- Novas colunas em `work_orders`: `items_sum` (soma dos itens), `os_value_text` (texto do valor exibido na OS), `payment_notes`, `adjustment_reason`, `cancelled_at`/`cancelled_by`/`cancellation_reason`, `deleted_at`/`deleted_by`/`deletion_reason`. O total oficial continua sendo `total_gross_value` (valor combinado) — nenhum campo concorrente é criado.
- Nova tabela **`work_order_history`** para o histórico (criação, edições, serviços, pagamento, documento, cancelamento, exclusão).
- Novos `config_options` de tipo "motivo de ajuste": Desconto comercial, Pacote de serviços, Negociação com o cliente, Arredondamento, Outro.

## Nova OS e edição da OS

- Cada serviço mantém tipo de serviço, data, horário, técnico, observações e status.
- Dentro do serviço, seção **"Itens deste serviço"**: tipo de estofado, descrição, quantidade, valor unitário e subtotal calculado, com **Adicionar item, Duplicar item, Remover item** e reordenação. Serviço novo já vem com um item; não salva sem pelo menos um item válido.
- Ação **"Copiar itens de outro serviço"**, com caixa opcional "Copiar também os valores"; o item copiado mantém o mesmo `item_group_id` para casar higienização e impermeabilização do mesmo móvel.
- Seção "Valores e pagamento combinado" sem o botão "Informar total manualmente": mostra **Soma dos itens** (somente leitura) e **Valor total combinado com o cliente** (editável, pré-preenchido com a soma). Quando diferem, aviso "O valor combinado é diferente da soma dos itens." + "Ajuste comercial: -R$ 50,00" e campo opcional "Motivo do ajuste".
- Campo **"Texto do valor exibido na OS"** com sugestão automática ("R$ 450,00 no Pix", "R$ 500,00 em até 5x sem juros"), editável a qualquer momento.
- Totais (subtotal do item, total do serviço, soma geral) recalculam na hora na tela e são revalidados no servidor ao salvar.
- A mesma tela passa a servir para **editar uma OS existente**: cliente, origem, vendedora, serviços, itens, valores, pagamento combinado e observações. Remoções de itens/serviços já ligados a histórico usam desativação, não exclusão física.

## Documento no Google Docs (só o conteúdo muda)

- Escolha do modelo continua pelos tipos de serviço ativos da OS (higienização, impermeabilização ou combinado), ignorando cancelados/excluídos. IDs e pasta atuais intactos.
- `{{RESUMO_VALOR}}` passa a usar o "Texto do valor exibido na OS" (com o texto gerado do total/forma/parcelas combinadas como reserva). `{{FORMA_PAGAMENTO}}` continua sendo a forma **combinada**, nunca a efetiva.
- Higienização/Impermeabilização: **uma linha por item**, com a quantidade só daquele item e o valor unitário — `R$ 50,00/cada` quando a quantidade for maior que 1, `R$ 200,00` quando for 1.
- Combinado: uma linha por `item_group_id`, com `{{VALOR_HIG}}` e `{{VALOR_IMP}}` nas colunas certas e "—" na coluna sem valor. Sem agrupar por semelhança de descrição; itens antigos sem vínculo ficam em linhas separadas.
- Alterações relevantes (cliente, número, serviços, itens, quantidades, valores, total combinado, pagamento combinado, texto do valor) marcam o documento como **Desatualizado** com o aviso "Os dados desta OS foram alterados após a geração do documento." e as ações Abrir, Atualizar, Gerar nova versão. Alterar só o pagamento efetivo não mexe no documento.

## Pagamento efetivo

Seção separada, editável depois do serviço: status, canal, forma efetiva, parcelas, valor pago, data, taxa aplicada e valor líquido — usando a tabela de taxas atual. Ele alimenta taxas, líquido, fluxo de caixa, contas a receber e relatórios; o pagamento combinado permanece intacto.

## "OSs criadas" (novo item no menu)

- Lista todas as OSs independentemente da agenda, com busca parcial por número da OS, cliente, telefone, descrição do estofado ou nome do documento.
- Filtros: período, tipo de serviço, status da OS, status do pagamento, vendedora, técnico, origem, documento gerado/pendente e ativa/cancelada/excluída/arquivada.
- Colunas: número, cliente, telefone, serviços, datas, valor combinado, forma combinada, status do pagamento, status da OS, status do documento, criação e última alteração. Tabela no desktop, cartões no celular. Botão "Nova OS".

## Detalhe da OS

Seções Cliente, Serviços e agendamentos (com itens), Valores e pagamento combinado, Pagamento efetivo, Documento da OS e Histórico. Ações: Editar OS, Abrir WhatsApp, Abrir documento no Google Docs, Copiar link, Atualizar documento, Gerar nova versão, Cancelar OS, Excluir OS — ações de documento só aparecem quando existe documento.

- WhatsApp: telefone normalizado (sem espaços, parênteses, traços e "+", com 55 quando faltar), abre em nova aba. Com documento, "Enviar link da OS pelo WhatsApp" abre a mensagem pronta ("Olá, {{NOME_CLIENTE}}! Segue a sua Ordem de Serviço nº ...") para o usuário revisar e enviar — nada é enviado automaticamente.
- **Cancelar OS**: sai da agenda ativa e das metas, mantém histórico e documento. **Excluir OS**: exclusão suave com motivo obrigatório e confirmação "Tem certeza de que deseja excluir esta OS?", aviso reforçado quando houver pagamentos/notas/serviços concluídos, filtro "OSs excluídas" e ação "Restaurar OS". O documento no Google nunca é apagado.

## Como vou entregar

Em três etapas, cada uma verificada antes da seguinte: (1) banco + itens no formulário + payload do documento; (2) valores combinados, pagamento efetivo e opções em Configurações; (3) "OSs criadas", detalhe, edição, WhatsApp, cancelar/excluir/restaurar e histórico. Nada de e-mail, Gmail ou fotos nesta tarefa.
