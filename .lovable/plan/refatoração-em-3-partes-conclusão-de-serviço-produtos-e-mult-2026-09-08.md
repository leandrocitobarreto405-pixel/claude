# Refatoração em 3 partes: conclusão de serviço, produtos e multiempresa

Entrega em três etapas, cada uma testável antes da próxima. Decisões já fechadas:
os gastos da conclusão reaproveitam a estrutura mensal que já existe hoje
(nada de histórico duplicado ou perdido), os papéis passam a ser
**admin / atendente / técnico** (quem é "operador" hoje vira atendente) e os
dados atuais ficam todos na empresa **Turbine Clean — CNPJ 49.665.244/0001-82**.

---

## Parte 1 — Cadastro de produtos + wizard de conclusão em 3 etapas

### Produtos em Configurações
Nova seção **Produtos** na tela de Configurações, com duas listas separadas:
Higienização e Impermeabilização. O botão "+ Adicionar produto" pede nome,
tipo de serviço, volume da embalagem (ml ou L), preço pago e um botão de
ativo/inativo. A listagem mostra sozinha o **custo por ml** e o **custo por
litro**. É possível editar e desativar. Ao mudar o preço, as OSs já concluídas
mantêm o custo congelado do dia da conclusão.

### Toggle "Controlar consumo de produtos por serviço"
Também em Configurações, desligado por padrão, com o texto de apoio pedido.
Desligado: a seção Produtos fica oculta, a etapa de produtos não aparece no
wizard, e a OS e o DRE não mostram custo de produtos/CMV. Ligado: fluxo completo.

### Wizard "Concluir serviço" (celular em primeiro lugar)
Ao concluir um atendimento na agenda, abre um passo a passo:

1. **Produtos utilizados** (só quando o controle está ligado) — para
   higienização, lista os produtos ativos de higienização para marcar e
   informar os ml usados; para impermeabilização, mostra o produto e pede a
   quantidade em **litros** (convertida internamente). Ao salvar, calcula o
   custo, baixa o estoque e grava o consumo.
2. **Gastos do técnico** — "Você teve algum gasto neste serviço?" com
   Pedágio, Zona Azul e Estacionamento (pode marcar vários ou nenhum) e um
   valor para cada marcado. Cada gasto entra como um lançamento vinculado à OS
   e ao técnico e alimenta o mesmo acumulado mensal de reembolso que já existe.
3. **Pagamento** — "O serviço foi pago?" Sim registra o pagamento como hoje
   (forma + valor); Não manda a OS para **A Receber** com destaque de pendência
   de cobrança, com botão de marcar como Pago (forma e data).

O atendimento só passa para concluído ao terminar o wizard. Nada é lançado
duas vezes: se o pagamento já foi registrado, a etapa 3 mostra o que existe.

### Rentabilidade por OS
No detalhe da OS, um bloco novo: Receita do serviço, menos custo de produtos
(oculto quando o controle está desligado), menos combustível vindo da
logística, menos gastos do técnico, resultando na **margem real em R$ e %**.
No DRE mensal, o custo de produtos entra como **CMV** (também só quando o
controle está ligado).

---

## Parte 2 — Remover a aba "Lançar gastos" da Logística

A tela de lançamento manual sai do menu e do app; os gastos passam a ser
informados na conclusão do serviço. Rotas, quilometragem e cálculo de
combustível continuam iguais. Os lançamentos já feitos continuam no banco e
seguem somando na despesa mensal do técnico.

---

## Parte 3 — Multiempresa (isolamento total)

- Tabelas novas **empresas** (nome, CNPJ, telefone, ativo, plano,
  `controle_insumos_ativo`) e **usuarios_empresa** (usuário, empresa, papel).
- A empresa Turbine Clean é criada e todos os registros atuais, além dos
  usuários atuais, são vinculados a ela — nada se perde.
- Todas as tabelas de negócio (OS, clientes, agenda, pagamentos, despesas,
  rotas, produtos, CRM/origens de lead, configurações, etc.) recebem a empresa
  e passam a ser filtradas por ela no banco, não só na tela.
- Cadastro: quem se cadastra cria a empresa e entra como admin. Tela de
  convites por e-mail onde o admin escolhe o papel.
- Permissões: **admin** vê tudo; **atendente** vê operação, agenda, criação de
  OS, A Receber e cobrança; **técnico** vê apenas a agenda dele e conclui
  serviços, sem financeiro.
- Novas opções por empresa (como o controle de insumos) sempre ficam como
  chave na empresa, nunca fixas no código.

---

## Detalhes técnicos

**Parte 1 (migração)**
- `produtos` (empresa_id, nome, tipo_servico enum `higienizacao|impermeabilizacao`,
  volume_embalagem_ml, preco_pago, `custo_por_ml` GENERATED, estoque_atual_ml, ativo).
- `os_produtos_utilizados` (empresa_id, os_id → work_orders, visit_id, produto_id,
  quantidade_ml, custo_calculado congelado, created_at). Baixa de estoque via
  função server-side, não no cliente.
- Gastos da etapa 2 gravam em `technician_expenses` (já existe: categorias em
  array, `work_order_id`, `expense_id`) para reaproveitar
  `consolidateTechnicianExpenses` e o `reference_key`
  `tech-expenses:{tecnico}:{YYYY-MM}`. As tabelas `os_gastos_tecnico` /
  `os_produtos_utilizados` do briefing viram: só a de produtos é criada;
  os gastos usam a tabela existente para não duplicar o acumulado mensal.
- Toggle e produtos: enquanto a Parte 3 não roda, a preferência fica em
  `app_settings` (`controle_insumos_ativo`) e migra para `empresas` na Parte 3.
- Wizard: refatorar `src/components/visit-dialog.tsx` em passos (mantendo a
  lógica de cobrança/`collection_rule` já existente), nova UI de produtos e
  gastos, e `src/routes/_authenticated/configuracoes.tsx` ganha a aba Produtos.
- Rentabilidade: helper em `src/lib/os.ts`/`reports.ts` somando receita paga,
  custo de produtos, `route_cost_allocations.allocated_cost` e gastos do técnico
  por OS; CMV entra em `src/lib/reports.ts` (DRE) somando o custo dos consumos
  do mês por competência do serviço.

**Parte 3 (migração e RLS)**
- `empresa_id` entra como coluna anulável com FK, backfill para a empresa
  Turbine Clean, default fixado depois; `NOT NULL` só numa migração posterior,
  já com todas as linhas preenchidas (rota sem downtime).
- Função `public.empresa_do_usuario()` (security definer, stable) devolvendo a
  empresa do `auth.uid()` em `usuarios_empresa`; políticas RLS em todas as
  tabelas usando `empresa_id = public.empresa_do_usuario()`, mais
  `public.tem_papel(uid, papel)` para as restrições de papel. GRANTs revistos.
- Enum novo `papel_empresa` (`admin|atendente|tecnico`); `app_role` continua
  existindo (não é removível sem quebra) mas deixa de ser consultado —
  `is_staff`/`has_role` passam a delegar para `usuarios_empresa`.
- `ensure_my_access()` reescrita para provisionar perfil + vínculo de empresa.
- Guardas de papel nas rotas (`_authenticated`) e no menu, com a segurança real
  no RLS. Técnico vinculado ao registro em `technicians` para filtrar a agenda.
- Webhooks públicos (CRM/leads, fechamentos) recebem a empresa pela integração
  chamada, para continuarem funcionando com RLS ativo.
