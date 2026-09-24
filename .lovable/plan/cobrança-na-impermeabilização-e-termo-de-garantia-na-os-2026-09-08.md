# Cobrança na impermeabilização e termo de garantia na OS

## 1. Valor certo na mensagem (higienização x impermeabilização)

O que acontece hoje: nas OS de higienização + impermeabilização a regra já está certa
(cobrar na impermeabilização), mas o texto da mensagem salvo nas configurações termina com
"Valor: {{valor_formatado}}", que mostra **o valor daquele atendimento**. No dia da
higienização isso imprime o valor da higienização e parece que é para cobrar.

O que vai mudar:

- O modelo de mensagem passa a usar a instrução de pagamento no lugar da linha de valor.
  Modelos antigos que ainda tenham a linha "Valor: ..." são convertidos automaticamente,
  sem você precisar mexer nas configurações.
- Resultado no dia da higienização: "Pagamento: Não cobrar neste atendimento. Pagamento
  previsto para o dia da impermeabilização."
- Resultado no dia da impermeabilização (último atendimento): "Valor total a cobrar:
  R$ 494,96 · Forma de pagamento combinada: ..." — o total da OS, não o valor do serviço.
- Vale para as mensagens da agenda, da OS e da página "Mensagens de confirmação".

Na conclusão dos atendimentos:

- Continuam sendo dois atendimentos (dias diferentes), mas ao concluir a higienização o app
  não oferece mais lançar pagamento: mostra o aviso de que a cobrança é no dia da
  impermeabilização.
- Ao concluir o último atendimento (o de cobrança), o lançamento de pagamento já vem com o
  **valor total da OS** preenchido.

## 2. Termo de garantia da impermeabilização

- Usa exatamente o termo que você enviou (12 meses, coberturas, exclusões, como acionar,
  observações e o rodapé da Turbine Clean). Não precisa criar modelo no Google Docs.
- Gerado só para OS que tenham impermeabilização, na **mesma pasta do Drive** que o app já
  cria para a OS do cliente, junto dos outros documentos.
- Campos preenchidos automaticamente: cliente, data do serviço (data da impermeabilização),
  técnico responsável, estofado(s) atendido(s) e **data da próxima impermeabilização**
  (12 meses depois).
- Aparece na OS como um documento a mais, com botões de abrir, gerar novamente e link para o
  arquivo — igual aos documentos atuais. Fica indisponível (com aviso) em OS sem
  impermeabilização.

## 3. Sugestão por CEP

Fica para depois, como você pediu.

## Detalhes técnicos

- `src/lib/data.ts`: `DEFAULT_MESSAGE_TEMPLATE` já usa `{{INSTRUCAO_PAGAMENTO}}`; adicionar
  `normalizeMessageTemplate()` em `src/lib/os.ts` (usado por `renderMessage`) que troca a
  linha `Valor: {{valor_formatado}}` por `{{INSTRUCAO_PAGAMENTO}}` quando o modelo salvo não
  tiver a variável de pagamento, e migração única do `app_settings.message_template`.
- `src/components/visit-dialog.tsx`: usar `collectionFields(...).isCollectionVisit` para
  esconder/mostrar o lançamento de pagamento na conclusão e pré-preencher
  `negotiatedTotal` quando for a visita de cobrança.
- `src/lib/os-docs.server.ts`: novo tipo de documento `"Termo de garantia"` gerado sem
  template (criar doc via Google Docs API + `insertText`/estilos e mover para a pasta da OS
  com o Drive), reaproveitando `findOrCreateFolder`, o nome (`Termo de garantia — OS
  {{NUMERO_OS}}`) e o registro em `work_order_documents` (sem constraint de
  `template_type`, nenhuma migração necessária).
- `src/routes/_authenticated/os.$osNumber.tsx`: card/ação do termo de garantia, habilitado
  quando existe visita de impermeabilização.

## Verificação

Abrir a OS 1603 (hig 19/09 + imper 21/09): a mensagem do dia 19 não deve mostrar valor a
cobrar e a do dia 21 deve mostrar R$ 494,96; gerar o termo de garantia e conferir o arquivo
na pasta da OS com cliente, data, técnico, estofados e próxima impermeabilização em 2027.
