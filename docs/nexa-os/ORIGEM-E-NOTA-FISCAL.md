# Origem dos leads e emissão de nota fiscal

Situação em 28/09/2026: **em produção** (migrações `20260930120000`, `20260930130000` e
`20261001120000` aplicadas no Supabase "Nexa OS Sao Paulo").

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
| **Mensagem pronta cadastrada** contida na mensagem do cliente | A origem da mensagem (e a campanha e o serviço dela) |
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

### Mensagens prontas dos links de WhatsApp

Ficam em **Configurações → Listas**, abaixo das origens. Cada empresa cadastra o texto que cada
link de WhatsApp já traz pronto (`wa.me/...?text=...`) e diz de onde ele vem. Para cada mensagem:
- **origem** (obrigatória);
- **campanha** (opcional);
- **serviço de interesse** (opcional);
- **onde está o link** (anotação livre).

Como funciona:
- A comparação ignora maiúsculas, acentos e pontuação, e vale se o texto cadastrado estiver
  **contido** na mensagem do cliente.
- Quando duas combinam, vence a mais longa. Exemplo: "Quero um orçamento de impermeabilização"
  ganha de "Quero um orçamento".
- Campanha e serviço são gravados mesmo quando o lead é cliente existente (a origem continua
  "Cliente existente / Recorrência").
- Uma mensagem repetida é recusada.
- **Testar uma mensagem**: cola-se um texto e a tela mostra origem, campanha e serviço
  identificados.
- **Aplicar aos leads sem origem**: revê as mensagens recebidas dos leads "Não identificada". Uma
  origem escolhida à mão nunca é trocada.

Limitação: se alguém digitar à mão exatamente um texto cadastrado (por exemplo, "Olá! Quero um
orçamento."), o lead também recebe essa origem. Quanto mais específico o texto do link, melhor.

**Turbine Clean (cadastrado em 28/09/2026)**: origem nova "Site" (orgânico), campanhas "Google —
Higienização" e "Google — Impermeabilização", e 9 mensagens:

| Origem | Mensagens |
|---|---|
| Google, campanha de higienização | "Olá, gostaria de um orçamento para higienização dos meus estofados, por favor." |
| Google, campanha de impermeabilização | "Olá! Gostaria de saber mais sobre a impermeabilização de estofados." |
| Blog | "Olá! Vi o blog e quero um orçamento."<br>Cupom BLOG50 (higienização)<br>Cupom BLOG82 (impermeabilização) |
| Site | "Olá! Quero um orçamento."<br>"Olá! Quero impermeabilizar meu estofado, pode me fazer um orçamento?"<br>"Olá! Represento uma empresa e quero um orçamento de higienização."<br>"Olá! Quero um orçamento de impermeabilização." |

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
| `040_origem_leads.sql`: mensagens prontas | Origem, campanha e serviço; a mais longa vence; sem acento/pontuação; cliente existente mantém a origem; mensagem de outra empresa não vale; referência cruzada, status como origem e texto repetido recusados; testar; reaplicar só em leads sem origem. |
| `src/lib/nota-fiscal.test.ts` | Montagem da mensagem, forma de pagamento recebida × combinada, prioridade do CPF/CNPJ, aviso de campos em branco, modelo personalizado. |

As proteções foram validadas com mutação: ao desligar cada uma, o teste correspondente falha.

## Leads novos × reativação (04/10/2026)

- **Lead novo (receptivo):** o cliente mandou a primeira mensagem. É o que mede a captação
  (Google, orgânico, indicação…) e é o único que recebe origem automática.
- **Reativação (ativo):** a empresa mandou a primeira mensagem (retorno de 6 meses da
  higienização, 1 ano da impermeabilização, leads antigos). Não entra nos números de captação.
- A classificação é automática, pela mensagem mais antiga da conversa do Chatwoot
  (`crm_leads.entrada`), e pode ser trocada à mão na tela do lead ("Quem chamou primeiro").
- **Funil e indicadores:** abas "Leads novos" e "Reativação". Na reativação o funil é
  Chamados → Responderam → Orçamento → OS…, e a tabela separa "Cliente (retorno)" de
  "Lead antigo".
- **CRM → Visão geral:** conversão, custo por lead e campanhas contam só leads novos.
- **Lista de leads:** filtro "Quem chamou" e etiqueta "Reativação".
- Testes: `supabase/tests/080_leads_entrada.sql` (validado com mutação).
