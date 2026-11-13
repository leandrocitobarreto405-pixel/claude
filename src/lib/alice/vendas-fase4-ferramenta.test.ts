// Fase 4 de "Alice e vendas" de ponta a ponta no banco simulado (dados fictícios): o orçamento
// refeito com a condição do follow-up 5 novo e o contato marcado no fora da área.
import { test } from "node:test";
import assert from "node:assert/strict";
import { executarFerramenta } from "./ferramentas.server";
import { contexto } from "./banco-simulado";

const semNbsp = (s: string) => s.replace(/\u00a0/g, " ");
const pedido = {
  servico: "higienizacao",
  itens: [{ item: "Sofá comum 3 lugares", quantidade: 1 }],
  endereco: "Rua Fictícia, Bairro Teste",
  desconto: "oferta_followup",
};

function comToque5(tabelas: Record<string, Array<Record<string, unknown>>>, oferta: object) {
  tabelas["crm_followups"] = [
    {
      id: "fu-5",
      empresa_id: "emp",
      conversa_id: "conv-1",
      etapa: "A5",
      status: "Concluída",
      canal: "texto",
      completed_at: "2026-10-19T14:00:00Z",
      ia_tarefa_id: "t-5",
    },
  ];
  tabelas["ia_tarefas"] = [{ id: "t-5", empresa_id: "emp", dados: { oferta5: oferta } }];
}

test("follow-up 5 novo: o orçamento sai com o valor da mensagem, sem Pix por cima", async () => {
  const { ctx, tabelas } = contexto({ followup5_novo: true });
  comToque5(tabelas, {
    tipo: "desconto",
    valor: 208,
    cheio: 260,
    vinte: true,
    comVaga: true,
    texto: "x",
  });
  const r = await executarFerramenta(ctx, "criar_orcamento", pedido);
  assert.equal(r.erro, false, r.conteudo);
  const texto = semNbsp(r.conteudo);
  assert.match(texto, /Condição especial \(vaga nesta semana\)/);
  const q = tabelas["quotes"]![0]!;
  assert.equal(q["total"], 208);
  assert.equal(q["desconto"], 52);
  assert.equal(q["desconto_tipo"], "manual");
});

test("follow-up 5 novo: lembrete (sem desconto novo) não libera condição", async () => {
  const { ctx, tabelas } = contexto({ followup5_novo: true });
  comToque5(tabelas, { tipo: "lembrete", valor: 260, cheio: 260, comVaga: false, texto: "x" });
  const r = await executarFerramenta(ctx, "criar_orcamento", pedido);
  assert.equal(r.erro, true);
  assert.match(r.conteudo, /não teve condição nova/);
  assert.equal(tabelas["quotes"]!.length, 0);
});

test("fora da área com a chave: o contato fica não cliente e sem pós-venda", async () => {
  const { ctx, tabelas } = contexto({ fora_area_regra: true });
  (ctx as { contatoId: string | null }).contatoId = "contato-1";
  tabelas["whatsapp_contacts"] = [
    { id: "contato-1", empresa_id: "emp", nao_cliente_em: null, sem_pos_venda: false },
  ];
  const r = await executarFerramenta(ctx, "registrar_motivo_perda", { motivo: "Fora da área" });
  assert.equal(r.erro, false, r.conteudo);
  const c = tabelas["whatsapp_contacts"]![0]!;
  assert.equal(c["nao_cliente_motivo"], "Fora da área");
  assert.equal(c["sem_pos_venda"], true);
  assert.ok(c["nao_cliente_em"]);
});

test("fora da área sem a chave: o contato não muda", async () => {
  const { ctx, tabelas } = contexto();
  (ctx as { contatoId: string | null }).contatoId = "contato-1";
  tabelas["whatsapp_contacts"] = [
    { id: "contato-1", empresa_id: "emp", nao_cliente_em: null, sem_pos_venda: false },
  ];
  await executarFerramenta(ctx, "registrar_motivo_perda", { motivo: "Fora da área" });
  assert.equal(tabelas["whatsapp_contacts"]![0]!["sem_pos_venda"], false);
});
