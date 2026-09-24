# Documento da OS no Google Docs

Integração para gerar automaticamente o documento da OS a partir dos três modelos do Google Docs, salvando no Google Drive. Nada da aplicação atual (agenda, financeiro, DRE, comissões, rotas, despesas, login) é redesenhado ou recalculado.

## O que já existe hoje (verificado)

- Cada OS (`work_orders`) tem número, cliente, valor total negociado, forma de pagamento negociada e parcelas.
- Cada item da OS é uma visita (`visits`) com tipo de serviço, descrição do estofado e valor. **Não existe quantidade** nem valor separado de higienização/impermeabilização.
- Não existe página de detalhe da OS: hoje só há Nova OS, Agenda, Serviços realizados e o diálogo da visita.
- Nenhuma conexão Google está ligada ao projeto ainda.

## Decisões confirmadas

- O documento é gerado **automaticamente ao finalizar a criação da OS** (com opção de desligar nas Configurações).
- `{{NUMERO_CLIENTE_TEXTO}}` = últimos 4 dígitos do telefone do cliente, no formato `nº 6690` (vazio se não houver telefone).
- O formulário de Nova OS passa a ter, por item: **Item, Quantidade e Valor**, alinhados com as colunas do documento.

## Conexão Google

Vou pedir a conexão das contas **Google Docs** e **Google Drive** (cards de conexão no chat). Todas as chamadas ao Google acontecem no servidor; nenhum token, ID de modelo ou ID de pasta aparece no navegador.

## Configurações → “Modelos de ordem de serviço”

Nova aba com: link/ID dos três modelos (Higienização, Impermeabilização, Higienização e Impermeabilização), link/ID da pasta de destino, padrão do nome do documento (padrão `OS {{NUMERO_OS}} - {{NOME_CLIENTE}}`), “Gerar documento automaticamente ao salvar a OS” e “Integração ativa”.
Validação dos links/IDs antes de salvar, status em português (Não configurada, Configurada, Testando conexão, Conexão validada, Erro na conexão) e botão **Testar integração** que confere acesso aos três modelos, cópia, edição e gravação na pasta.

## Geração do documento

- Escolha automática do modelo pelos serviços ativos da OS (só higienização, só impermeabilização, ou os dois → modelo combinado, mesmo em datas diferentes; itens cancelados são ignorados).
- Cópia do modelo → renomeada → salva na pasta configurada, organizada em `ano / mês` quando possível (se a pasta do mês não puder ser criada, salva na pasta principal).
- Substituição de `{{NUMERO_OS}}`, `{{NOME_CLIENTE}}`, `{{NUMERO_CLIENTE_TEXTO}}`, `{{RESUMO_VALOR}}` (ex.: “R$ 900,00 no Pix”, “R$ 750,00 em até 5x sem juros”) e `{{FORMA_PAGAMENTO}}`.
- Tabela dinâmica: a linha marcadora (`{{ITEM}}`, `{{QTD}}`, `{{VALOR}}` ou `{{VALOR_HIG}}`/`{{VALOR_IMP}}`) é duplicada por item, preservando bordas e formatação, e a linha marcadora original é removida. No modelo combinado, higienização e impermeabilização do mesmo estofado viram uma linha só; coluna sem valor recebe “—”.
- Placeholders sem dado são removidos (nunca ficam visíveis). O modelo original nunca é alterado.
- Aviso antes de gerar quando faltar valor individual: “Existem itens sem valor individual. Revise os dados antes de gerar a OS.”

## Seção “Documento da OS”

Nova página de detalhe da OS (aberta a partir da Agenda, de Serviços realizados e logo após criar a OS), usando os componentes atuais, com: status (Não gerado, Gerando, Gerado, Desatualizado, Erro) e ações **Gerar documento, Abrir no Google Docs, Copiar link, Atualizar documento, Gerar nova versão, Tentar novamente**.

- Se dados relevantes mudarem depois da geração, status vira **Desatualizado** com o aviso “Os dados da OS foram alterados após a geração do documento.” — o usuário escolhe atualizar (mesma URL) ou gerar nova versão (`- V2`, preservando a anterior).
- Se já existir documento: “Esta OS já possui um documento. O que deseja fazer?” com abrir / atualizar / nova versão / cancelar.
- Botão bloqueado durante a geração (“Gerando documento...”), sem duplicar arquivos.
- Falha na geração nunca desfaz o salvamento da OS: “A OS foi salva, mas não foi possível gerar o documento.” com botão de tentar novamente.
- Erros em português (integração não configurada, modelo não encontrado, sem acesso, falha na tabela, falha ao salvar no Drive), com log técnico só no servidor.

## Detalhes técnicos

- Banco (migração mínima, sem renomear nada): nova tabela `work_order_documents` (work_order_id, template_type, google_document_id, google_document_url, document_name, document_version, generation_status, generated_at, generated_by, source_updated_at, last_synced_at, error_message, timestamps) com RLS igual ao padrão do projeto (equipe lê/escreve, admin exclui); e novas colunas opcionais em `visits`: `item_quantity` (padrão 1) e `item_unit_label`. Cálculos financeiros existentes seguem usando `visit_value` sem alteração.
- Configurações da integração salvas em `app_settings` (chave `os_document_settings`); IDs de modelo/pasta lidos só no servidor.
- Backend: novos `createServerFn` em `src/lib/os-docs.functions.ts` + `src/lib/google-docs.server.ts` (gateway do Google Drive/Docs: copiar arquivo, criar pastas, `documents:batchUpdate` para texto e `insertTableRow`/`deleteTableRow` para a tabela). Nenhuma Edge Function nova.
- Arquivos alterados: `src/routes/_authenticated/configuracoes.tsx` (nova aba), `src/routes/_authenticated/nova-os.tsx` (campos Item/Quantidade/Valor + disparo automático pós-salvamento), `src/lib/os.ts` (gravar quantidade), `src/routes/_authenticated/agenda.tsx` e `servicos.tsx` (link para a OS), `src/components/visit-dialog.tsx` (link), nova rota de detalhe da OS e novos arquivos de servidor.
- Sem upload/galeria/inserção de fotos em nenhum ponto.
