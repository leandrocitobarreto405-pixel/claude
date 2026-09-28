# Origem dos leads e emissão de nota fiscal

Situação em 28/09/2026: **em produção** (migrações `20260930120000` e `20260930130000` aplicadas
no Supabase "Nexa OS Sao Paulo").

## Origem do lead

Origem é **de onde o cliente veio**. O canal de atendimento (WhatsApp pelo Chatwoot) não é origem.

Lista padrão por empresa, editável em **Configurações → Cadastros → Origens de venda**:

1. Google
2. Instagram
3. Facebook
4. Indicação
5. Blog
6. Cliente existente / Recorrência
7. Outra origem

Dá para criar outras origens na mesma tela.

### Identificação automática

Acontece quando o Chatwoot cria o lead, nesta ordem:

| Regra | Origem |
|---|---|
| Telefone já é de um cliente cadastrado | Cliente existente / Recorrência |
| Conversa numa caixa do Instagram ou do Facebook | Instagram / Facebook |
| Anúncio "clique para WhatsApp" (dados do anúncio com instagram, facebook, fb.me ou ctwa) | Instagram / Facebook |
| Palavra-chave na mensagem do cliente | A origem da palavra |

Sobre as palavras-chave:
- Cada origem tem as suas, editáveis na tela de origens, separadas por vírgula.
- A comparação ignora maiúsculas e acentos, e só vale a palavra inteira ("insta" não pega
  "instalação").
- Um lead ainda sem origem ganha uma origem na próxima mensagem do cliente que tiver palavra-chave.
- Uma origem escolhida à mão nunca é trocada.

Sem identificação, a origem fica **"Não identificada"** (lista de leads, ficha e indicadores) e
pode ser escolhida na ficha do lead. A lista mostra "(auto)" quando a origem foi identificada
automaticamente.

**Recomendação.** Use um link de WhatsApp com mensagem pronta diferente em cada canal:
- `https://wa.me/55XXXXXXXXXXX?text=Olá!%20Vim%20pelo%20Google` no Perfil da Empresa no Google;
- "Olá! Vim pelo blog" no blog;
- "Olá! Vim pelo Instagram" na bio do Instagram.

Se o texto de algum link não tiver o nome do canal, cadastre um trecho dele como palavra-chave da
origem certa.

### Lista de leads

Colunas:
- entrada (data e hora para leads do Chatwoot; só o dia para importados/manuais);
- nome, telefone e cliente novo × existente;
- status e etapa do funil;
- origem;
- última interação;
- link **"Abrir no Chatwoot"**, direto na conversa.

O link é calculado pelo banco (`url_chatwoot`) e só existe para conversas que o usuário pode ver.

## Nota fiscal

A nota continua **sem emissão automática**. O sistema monta a mensagem para o grupo que emite as
notas e controla a situação.

- **Onde**:
  - na OS, seção "Emissão de nota fiscal";
  - em **Notas fiscais**, a lista de todas as notas, com filtro por situação e "Copiar todas".
- **Situação**: Pendente → Solicitada → Emitida. Também existem Cancelada e Não necessária.
- **Mensagem**: modelo por empresa em **Configurações → Mensagem**. O padrão é:

  ```
  Nota fiscal — {{nome_cliente}}
  CPF/CNPJ: {{cpf_cnpj}}
  E-mail: {{email}}
  Data do serviço: {{data_servico}}
  Forma de pagamento: {{forma_pagamento}}
  Valor: {{valor}}
  OS: {{numero_os}}
  ```

  Não inclui endereço. Se faltar algum dado no cadastro, a tela avisa antes de copiar e a mensagem
  sai com "não informado".
- **De onde vêm os dados**:

  | Campo | Origem |
  |---|---|
  | Nome, CPF/CNPJ e e-mail | Cadastro do cliente. O CPF/CNPJ informado ao concluir o serviço tem prioridade. |
  | Data do serviço | Conclusão do serviço |
  | Forma de pagamento | **Da OS**, não do cliente: os pagamentos recebidos (ex.: "Pix + Crédito em 3x"). Sem pagamento lançado, vale a forma combinada na OS. |

- **Arquivo da nota**:
  - PDF, imagem ou XML de até 10 MB, guardado no Supabase Storage (bucket privado `notas-fiscais`,
    uma pasta por empresa);
  - só usuários com acesso à empresa leem e gravam;
  - "Ver nota" e "Baixar" usam um link temporário de 10 minutos.

## Testes

| Teste | O que verifica |
|---|---|
| `supabase/tests/040_origem_leads.sql` | Lista padrão, palavras-chave, palavra inteira, prioridade de cliente existente, canal Instagram, anúncio do Facebook, identificação posterior, origem manual mantida, palavras editáveis, isolamento entre empresas, nome do lead × nome editado, "Não identificada" nos indicadores, link só da própria empresa. |
| `src/lib/nota-fiscal.test.ts` | Montagem da mensagem, forma de pagamento recebida × combinada, prioridade do CPF/CNPJ, aviso de campos em branco, modelo personalizado. |

As proteções foram validadas com mutação: ao desligar cada uma, o teste correspondente falha.
