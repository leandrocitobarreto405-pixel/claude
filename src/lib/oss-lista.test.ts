import { test } from "node:test";
import assert from "node:assert/strict";
import {
  atendimentoDoCartao,
  buscarOs,
  filtrarPorChip,
  resumoDoServico,
  situacaoDaOs,
  textoTotal,
  totalDaLista,
  type OsDaLista,
} from "./oss-lista";

const os = (extra: Partial<OsDaLista>): OsDaLista => ({
  id: extra.os_number ?? "x",
  os_number: "1",
  sale_date: "2026-10-10",
  status: "Agendada",
  total_gross_value: 100,
  eh_teste: false,
  cancelled_at: null,
  deleted_at: null,
  salesperson_id: null,
  customer: { full_name: "Cliente Fictício", phone: "(11) 97000-0001" },
  visits: [
    {
      status: "Agendado",
      scheduled_date: "2026-10-20",
      scheduled_time: "10:00",
      technician_id: null,
      upholstery_description: "Sofá 3 lugares",
      service_type: { name: "Higienização" },
      service_items: [],
    },
  ],
  work_order_documents: [],
  ...extra,
});

const agendada = os({ os_number: "1" });
const andamento = os({ os_number: "2", status: "Parcialmente concluída" });
const execucao = os({
  os_number: "3",
  visits: [{ ...agendada.visits[0]!, status: "Em execução" }],
});
const concluida = os({
  os_number: "4",
  status: "Concluída",
  work_order_documents: [{ is_active: true, generation_status: "Gerado" }],
});
const canceladaOs = os({ os_number: "5", cancelled_at: "2026-10-01T00:00:00Z" });
const excluida = os({ os_number: "6", deleted_at: "2026-10-01T00:00:00Z" });
const teste = os({ os_number: "7", eh_teste: true, total_gross_value: 9999 });
const lista = [agendada, andamento, execucao, concluida, canceladaOs, excluida, teste];

test("situação do cartão", () => {
  assert.deepEqual(situacaoDaOs(agendada), { rotulo: "Agendada", tom: "neutro" });
  assert.deepEqual(situacaoDaOs(andamento), { rotulo: "Em andamento", tom: "atencao" });
  assert.deepEqual(situacaoDaOs(execucao), { rotulo: "Em andamento", tom: "atencao" });
  assert.deepEqual(situacaoDaOs(concluida), { rotulo: "Concluída", tom: "sucesso" });
  assert.deepEqual(situacaoDaOs(canceladaOs), { rotulo: "Cancelada", tom: "problema" });
  assert.deepEqual(situacaoDaOs(excluida), { rotulo: "Excluída", tom: "problema" });
});

test("chips", () => {
  const ids = (l: OsDaLista[]) => l.map((r) => r.os_number);
  assert.deepEqual(ids(filtrarPorChip(lista, "todas")), ["1", "2", "3", "4", "5", "7"]);
  assert.deepEqual(ids(filtrarPorChip(lista, "agendadas")), ["1", "7"]);
  assert.deepEqual(ids(filtrarPorChip(lista, "andamento")), ["2", "3"]);
  assert.deepEqual(ids(filtrarPorChip(lista, "concluidas")), ["4"]);
  assert.deepEqual(ids(filtrarPorChip(lista, "sem-doc")), ["1", "2", "3", "7"]);
  assert.deepEqual(ids(filtrarPorChip(lista, "canceladas")), ["5"]);
});

test("busca por nº, cliente, telefone e estofado", () => {
  assert.equal(buscarOs(lista, "sofá").length, 7);
  assert.equal(buscarOs([agendada], "970000001").length, 1);
  assert.equal(buscarOs([agendada], "fictício").length, 1);
  assert.equal(buscarOs([agendada], "99").length, 0);
});

test("total sem teste, canceladas e excluídas; texto sem centavos", () => {
  const t = totalDaLista(lista);
  assert.deepEqual(t, { quantidade: 4, valor: 400 });
  assert.equal(
    textoTotal({ quantidade: 14, valor: 4465.4 }, "em outubro"),
    "14 OS em outubro · R$ 4.465",
  );
});

test("atendimento do cartão: o próximo a partir de hoje; sem futuro, o último", () => {
  const v = (d: string, status = "Agendado") => ({
    ...agendada.visits[0]!,
    scheduled_date: d,
    status,
  });
  assert.equal(
    atendimentoDoCartao([v("2026-10-01"), v("2026-10-20"), v("2026-10-25")], "2026-10-14")!
      .scheduled_date,
    "2026-10-20",
  );
  assert.equal(
    atendimentoDoCartao([v("2026-10-01"), v("2026-10-05", "Concluído")], "2026-10-14")!
      .scheduled_date,
    "2026-10-05",
  );
  assert.equal(atendimentoDoCartao([v("2026-10-20", "Cancelado")], "2026-10-14"), null);
  assert.equal(resumoDoServico(agendada), "Higienização · Sofá 3 lugares");
});
