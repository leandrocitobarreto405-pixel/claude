import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import { addDaysISO, monthEnd, monthStart, todayISO } from "@/lib/format";
import type { Indicadores } from "@/lib/funil";
import {
  PERIODOS,
  conversao,
  dentro,
  intervalosDoPeriodo,
  percentualDaMetaComAgendado,
  round2,
  semanasAte,
  ticketMedio,
  vendidoPorOrigem,
  vendidoPorSemana,
  type Periodo,
  type ResumoPainel,
  type Venda,
} from "@/lib/painel";
import { RECEIVABLE_SCHEDULED_STATUSES, fetchReceivables } from "@/lib/receivables";
import { repasseDaOs, valorLiquido } from "@/lib/terceirizados";
import { fetchMonthSummary } from "@/lib/reports";
import { effectiveVisitValue } from "@/lib/visit-value";

// Painel financeiro do Início. Roda no servidor com o cliente da própria pessoa (RLS da empresa
// ativa), devolve só totais e corta despesas/lucro para quem não é admin. OS marcadas como
// teste ficam fora de tudo.

type OsResumo = { eh_teste: boolean; deleted_at: string | null; status: string } | null;
type VisitaResumo = {
  completion_date: string | null;
  final_value: number | null;
  visit_value: number | null;
  repasse_parceiro?: number | null;
  work_order: OsResumo;
};

const osValida = (o: OsResumo) => !!o && !o.deleted_at && !o.eh_teste && o.status !== "Cancelada";
const menor = (a: string, b: string) => (a < b ? a : b);
const maior = (a: string, b: string) => (a > b ? a : b);
// Sem o repasse a parceiros dos itens terceirizados (só a receita líquida conta).
const soma = (lista: VisitaResumo[]) =>
  round2(lista.reduce((t, v) => t + valorLiquido(effectiveVisitValue(v), v.repasse_parceiro), 0));

export const resumoPainel = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { periodo: Periodo }) => {
    if (!PERIODOS.some((p) => p.id === input.periodo)) throw new Error("Período inválido.");
    return input;
  })
  .handler(async ({ data, context }): Promise<ResumoPainel> => {
    const db = context.supabase;
    const hoje = todayISO();
    const amanha = addDaysISO(hoje, 1);
    const mes = hoje.slice(0, 7);
    const { atual, anterior, comparacao } = intervalosDoPeriodo(data.periodo, hoje);
    const semanas = semanasAte(hoje, 8);
    const noMes = { de: monthStart(mes), ate: monthEnd(mes) };

    const { data: papel } = await db.rpc("meu_papel" as never);
    const admin = papel === "admin";

    const contar = (q: PromiseLike<{ count: number | null }>) => q.then((r) => r.count ?? 0);

    const [vendasRes, concluidosRes, agendadosRes, recebidosRes, aReceber, funil, funilAnterior] =
      await Promise.all([
        db
          .from("work_orders")
          .select(
            "id, sale_date, total_gross_value, status, eh_teste, sales_origin:sales_origin_id ( name ), visits ( repasse_parceiro )",
          )
          .is("deleted_at", null)
          .neq("status", "Cancelada")
          .gte("sale_date", menor(anterior.de, semanas[0]!.de))
          .lte("sale_date", maior(atual.ate, semanas[semanas.length - 1]!.ate)),
        db
          .from("visits")
          .select(
            "completion_date, final_value, visit_value, repasse_parceiro, work_order:work_order_id ( eh_teste, deleted_at, status )",
          )
          .eq("status", "Concluído")
          .gte("completion_date", menor(anterior.de, noMes.de))
          .lte("completion_date", maior(atual.ate, noMes.ate)),
        db
          .from("visits")
          .select(
            "completion_date, final_value, visit_value, repasse_parceiro, work_order:work_order_id ( eh_teste, deleted_at, status )",
          )
          .in("status", RECEIVABLE_SCHEDULED_STATUSES)
          .gte("scheduled_date", hoje)
          .lte("scheduled_date", noMes.ate),
        db
          .from("payments")
          .select("payment_date, gross_amount, net_amount, work_order:work_order_id ( eh_teste )")
          .eq("is_active", true)
          .in("payment_status", ["Pago", "Parcialmente pago"])
          .gte("payment_date", anterior.de)
          .lte("payment_date", atual.ate),
        fetchReceivables(db),
        db.rpc("indicadores_funil", { _de: atual.de, _ate: atual.ate, _entrada: "receptivo" }),
        db.rpc("indicadores_funil", {
          _de: anterior.de,
          _ate: anterior.ate,
          _entrada: "receptivo",
        }),
      ]);
    for (const r of [vendasRes, concluidosRes, agendadosRes, recebidosRes, funil, funilAnterior])
      if (r.error) throw r.error;

    const [metaRes, qtdHoje, qtdAmanha, paraConcluir, resumoMes] = await Promise.all([
      db.from("monthly_goals").select("goal_amount").eq("month", `${mes}-01`).maybeSingle(),
      contar(
        db
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("scheduled_date", hoje)
          .neq("status", "Cancelado"),
      ),
      contar(
        db
          .from("visits")
          .select("id", { count: "exact", head: true })
          .eq("scheduled_date", amanha)
          .neq("status", "Cancelado"),
      ),
      contar(
        db
          .from("visits")
          .select("id", { count: "exact", head: true })
          .lte("scheduled_date", hoje)
          .neq("status", "Concluído")
          .neq("status", "Cancelado"),
      ),
      admin ? fetchMonthSummary(noMes.de, noMes.ate, db) : Promise.resolve(null),
    ]);
    if (metaRes.error) throw metaRes.error;

    // Vendas (OS pela data da venda), sem canceladas nem de teste.
    const vendas: Venda[] = (
      (vendasRes.data ?? []) as unknown as {
        sale_date: string;
        total_gross_value: number | null;
        eh_teste: boolean;
        sales_origin: { name: string } | null;
        visits: { repasse_parceiro: number | null }[] | null;
      }[]
    )
      .filter((w) => !w.eh_teste)
      .map((w) => ({
        sale_date: w.sale_date,
        valor: valorLiquido(Number(w.total_gross_value ?? 0), repasseDaOs(w.visits)),
        origem: w.sales_origin?.name ?? null,
      }));
    const vendasAtual = vendas.filter((v) => dentro(v.sale_date, atual));
    const vendasAnterior = vendas.filter((v) => dentro(v.sale_date, anterior));
    const vendidoAtual = round2(vendasAtual.reduce((t, v) => t + v.valor, 0));
    const vendidoAnterior = round2(vendasAnterior.reduce((t, v) => t + v.valor, 0));

    // Realizado (serviços concluídos pela data de conclusão).
    const concluidos = ((concluidosRes.data ?? []) as unknown as VisitaResumo[]).filter((v) =>
      osValida(v.work_order),
    );
    const realizadoAtual = concluidos.filter((v) => dentro(v.completion_date, atual));
    const agendados = ((agendadosRes.data ?? []) as unknown as VisitaResumo[]).filter((v) =>
      osValida(v.work_order),
    );

    // Recebido = o que entrou no caixa (data do pagamento).
    const recebidos = (
      (recebidosRes.data ?? []) as unknown as {
        payment_date: string | null;
        gross_amount: number | null;
        net_amount: number | null;
        work_order: { eh_teste: boolean } | null;
      }[]
    ).filter((p) => !p.work_order?.eh_teste);
    const recebidosAtual = recebidos.filter((p) => dentro(p.payment_date, atual));
    const somaRecebido = (lista: typeof recebidos, campo: "gross_amount" | "net_amount") =>
      round2(lista.reduce((t, p) => t + Number(p[campo] ?? 0), 0));

    const f = (funil.data as unknown as Indicadores | null)?.funil;
    const fa = (funilAnterior.data as unknown as Indicadores | null)?.funil;
    const metaValor = metaRes.data ? Number(metaRes.data.goal_amount) : null;
    const realizadoMes = soma(concluidos.filter((v) => dentro(v.completion_date, noMes)));
    const agendadoAteFimDoMes = soma(agendados);
    const osSemRecebimento = new Set(
      aReceber.items.filter((i) => i.kind === "concluido").map((i) => i.workOrderId),
    );

    return {
      periodo: data.periodo,
      hoje,
      mes,
      atual,
      anterior,
      comparacao,
      vendido: {
        valor: vendidoAtual,
        quantidade: vendasAtual.length,
        anterior: { valor: vendidoAnterior, quantidade: vendasAnterior.length },
      },
      realizado: {
        valor: soma(realizadoAtual),
        quantidade: realizadoAtual.length,
        anterior: { valor: soma(concluidos.filter((v) => dentro(v.completion_date, anterior))) },
        agendadoAteFimDoMes,
        noMes: realizadoMes,
      },
      recebido: {
        valor: somaRecebido(recebidosAtual, "gross_amount"),
        liquido: somaRecebido(recebidosAtual, "net_amount"),
        quantidade: recebidosAtual.length,
        anterior: {
          valor: somaRecebido(
            recebidos.filter((p) => dentro(p.payment_date, anterior)),
            "gross_amount",
          ),
        },
      },
      aReceber: {
        total: aReceber.total,
        concluidos: aReceber.completed,
        agendados: aReceber.scheduled,
      },
      semRecebimento: { valor: aReceber.completed, quantidade: osSemRecebimento.size },
      ticketMedio: {
        valor: ticketMedio(vendidoAtual, vendasAtual.length),
        anterior: ticketMedio(vendidoAnterior, vendasAnterior.length),
      },
      conversao: {
        leads: f?.leads ?? 0,
        orcamentos: f?.orcamento ?? 0,
        os: f?.os_criada ?? 0,
        pct: conversao(f?.os_criada ?? 0, f?.leads ?? 0),
        anterior: {
          leads: fa?.leads ?? 0,
          os: fa?.os_criada ?? 0,
          pct: conversao(fa?.os_criada ?? 0, fa?.leads ?? 0),
        },
      },
      meta: {
        valor: metaValor,
        pct: percentualDaMetaComAgendado(realizadoMes, agendadoAteFimDoMes, metaValor),
      },
      // Só o admin recebe despesas e lucro: quem não é admin nem vê o número passar pela rede.
      despesas: resumoMes
        ? { pagas: resumoMes.fixedCosts, aPagar: resumoMes.expensesUnpaid }
        : null,
      lucro: resumoMes ? round2(resumoMes.netProfit) : null,
      vendidoPorSemana: vendidoPorSemana(vendas, semanas),
      vendidoPorOrigem: vendidoPorOrigem(vendasAtual),
      chips: { hoje: qtdHoje, amanha: qtdAmanha, paraConcluir },
    };
  });
