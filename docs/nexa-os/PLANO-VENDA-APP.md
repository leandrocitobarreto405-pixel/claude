# Plano: venda do Nexa OS (só o plano, nada implementado)

Decisão pedida em 26/10/2026. Cada parte vira um item com ensaio, testes e PUBLICACOES quando for
aprovada. Nada cobra de verdade nem manda mensagem sem o ok do dono.

## a) Cobrança na ficha da empresa (Painel Nexa)

O que já existe: assinatura com plano, valor, status (`ativa`, `trial`, `inadimplente`,
`cancelada`), `gratis_ate`, carência e portão (somente leitura, bloqueio).

Proposta:

- Na ficha da empresa (Painel Nexa › Empresas), dois controles:
  - **Cobrança: Cobrar / Isenta.** Isenta = não gera fatura no Asaas e não entra no MRR (como a
    Turbine). Guardado na assinatura (`isenta boolean`), com quem marcou e quando.
  - **Em teste até [data]**, com atalhos **30 dias** e **3 meses**. Usa o `gratis_ate` que já
    existe e põe o status em `trial`.
- Na lista de empresas, a situação numa etiqueta: **Isenta**, **Em teste até dd/mm**, **Ativa**,
  **Carência**, **Somente consulta**, **Bloqueada** (a mesma regra do portão de hoje).
- Tamanho: pequeno (1 coluna, 2 controles, 1 etiqueta, teste de banco). Pode ser o próximo item.

## b) Autoatendimento com venda assistida

Fluxo: página de vendas → **Testar 30 dias grátis** → cadastro → 30 dias sem cartão → escolher
plano e pagar (Asaas) → portão no fim do teste.

Cadastro (todos obrigatórios, menos os indicados):

- Nome, empresa, e-mail, **WhatsApp com DDD**, cidade, nº de técnicos, como conheceu.
- Aceite dos termos (já existe a tela de termos).
- Caixa obrigatória **"Aceito receber contato da Nexa pelo WhatsApp"**, guardando data, hora e IP.

O que acontece ao cadastrar:

- Cria a empresa pelo `provisionar_empresa` (cópia do Modelo Nexa, Alice desligada), assinatura
  `trial` com `gratis_ate` = hoje + 30, plano escolhido como referência.
- Vira **lead no CRM da própria Nexa** (empresa Nexa dentro do Nexa OS), com origem e
  utm/gclid/fbclid, e **aviso no sininho** do Painel Nexa.
- Nada é enviado ao cliente pelo WhatsApp automaticamente; a equipe da Nexa chama.

Painel dos testes (Painel Nexa › Testes), ordenado por **"precisa de contato"**:

- Dias restantes, último acesso, criou OS, cadastrou técnicos, conectou WhatsApp, ligou a Alice.
- "Precisa de contato" = poucos dias restantes e pouco uso (ex.: 7 dias sem acesso, ou faltam 5
  dias e não criou OS).

Proteção contra abuso:

- Um teste por CNPJ, por WhatsApp e por e-mail (índices únicos; segundo pedido vira lead para a
  equipe, sem criar empresa).
- Captcha no cadastro (Cloudflare Turnstile, grátis) e limite de cadastros por IP por dia.
- Confirmação do e-mail antes de liberar.

Alice no teste (escolha do dono; cada uma tem custo):

1. Sem Alice no teste (custo zero; aparece com cadeado e "Quero testar a Alice").
2. Alice com franquia de teste (ex.: 30 conversas no período; ~US$ 0,24 cada hoje = ~US$ 7 por
   teste se usar tudo).
3. Alice só em modo demonstração (conversa de teste dentro do app, sem WhatsApp do cliente).

Conversão para anúncios:

- A página guarda `utm_*`, `gclid` e `fbclid` (cookie primário) e manda junto no cadastro.
- No cadastro concluído: evento de conversão para o Google Ads (conversão offline pelo `gclid`) e
  para a Meta (API de Conversões, servidor). Tokens só no Secret Manager.
- No pagamento da 1ª fatura: segunda conversão ("assinou"), para otimizar por cliente pagante.

## c) Página de vendas: rota pública no app ou página no Lovable

| | Rota pública no app (`/vendas`) | Página no Lovable |
|---|---|---|
| Velocidade de mudar texto | precisa de commit e build | muito rápida, pelo editor |
| Formulário de teste grátis | direto no app, mesma sessão e validação | chama o app por API (mais uma peça) |
| utm/gclid/fbclid | mesmo domínio, cookie simples | domínio diferente: passa pela URL |
| Desempenho e SEO | bom, mas o app carrega coisas que a página não precisa | página leve, feita para isso |
| Risco | mexer no app pode afetar o sistema | isolada do sistema |

Recomendação: **página no Lovable** para o conteúdo (rápida de testar anúncios) com o botão
**Testar grátis** levando para a rota de cadastro do app (`/comecar`), que fica no app por segurança
e para o cadastro, os termos e os eventos de conversão ficarem num lugar só.

## d) Vídeo do anúncio (30–60 s, vertical 9:16 e horizontal 16:9)

Empresa de demonstração com dados 100% fictícios (nomes, telefones e endereços inventados), em
cima do Modelo Nexa.

Ferramentas:

- Gravação da tela: celular (gravador nativo) para o vertical; navegador no computador para o
  horizontal.
- Narração: ElevenLabs (a mesma conta), voz em português do Brasil, modelo v4.
- Edição: CapCut ou ElevenLabs (composição de vídeo e áudio), legendas automáticas.

Roteiro de cenas (45 s):

1. (0–4 s) Gancho: "Seu WhatsApp responde cliente sozinho de madrugada?" — celular recebendo
   mensagem.
2. (4–12 s) A Alice respondendo e mandando o orçamento em PDF (conversa fictícia).
3. (12–20 s) OS criada, agenda do técnico, técnico recebendo a agenda no WhatsApp.
4. (20–28 s) Início: vendido no mês, a receber, funil de leads.
5. (28–36 s) Rotas do dia e quilometragem; cupom aplicado no orçamento.
6. (36–45 s) Chamada: "Teste 30 dias grátis, sem cartão" + endereço da página.

Versões: 30 s (cenas 1, 2, 4 e 6) e 60 s (todas, com mais tempo na Alice).
