import { createServerFn } from "@tanstack/react-start";
import { SELECT_VISITA_SEM_TESTE } from "@/lib/consultas";
import { requireEmpresa } from "@/lib/empresa.middleware";
import { addDaysISO, monthEnd, monthStart, todayISO } from "@/lib/format";
import type { Indicadores } from "@/lib/funil";
import {
  PERIODOS,
  conversao,
  dentro,
  intervalosDoPeriodo,
  percentualDaMeta,
  round2,
  semanasAte,
  ticketMedio,
  type PartesVendido,
  type Periodo,
  type ResumoPainel,
} from "@/lib/painel";
import { fetchReceivables } from "@/lib/receivables";
import { fetchMonthSummary } from "@/lib/reports";
import {
  vendidoNoPeriodo,
  vendidoParaProximosMeses,
  vendidoPorOrigemServico,
  vendidoPorSemanaServico,
  vendidoPorVendedora,
  type Vendido,
} from "@/lib/vendido";
import { buscarOsDoPeriodo, buscarOsVendidasNoPeriodo } from "@/lib/vendido-dados";

// Painel financeiro do Início. Roda no servidor com o cliente da própria pessoa (RLS da empresa
// ativa), devolve só totais e corta despesas/lucro para quem não é admin. OS marcadas como
// teste ficam fora de tudo. Vendido = pela data do serviço (vendido.ts), líquido do repasse.

const menor = (...d: string[]) => d.reduce((a, b) => (a < b ? a : b));
const maior = (...d: string[]) => d.reduce((a, b) => (a > b ? a : b));
const partes = (v: Vendido): PartesVendido => ({
  valor: v.valor,
  cheio: v.cheio,
  realizado: v.realizado,
  agendado: v.agendado,
  atrasado: v.atrasado,
  atrasadoQtd: v.atrasadoQtd,
});

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

    const [oss, recebidosRes, aReceber, funil, funilAnterior] = await Promise.all([
      buscarOsDoPeriodo(
        db,
        menor(anterior.de, semanas[0]!.de, noMes.de),
        maior(atual.ate, semanas[semanas.length - 1]!.ate, noMes.ate),
      ),
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
    for (const r of [recebidosRes, funil, funilAnterior]) if (r.error) throw r.error;

    const [metaRes, qtdHoje, qtdAmanha, paraConcluir, resumoMes, vendidasNoMes] = await Promise.all(
      [
        db.from("monthly_goals").select("goal_amount").eq("month", `${mes}-01`).maybeSingle(),
        contar(
          db
            .from("visits")
            .select(SELECT_VISITA_SEM_TESTE, { count: "exact", head: true })
            .eq("work_order.eh_teste", false)
            .eq("scheduled_date", hoje)
            .neq("status", "Cancelado"),
        ),
        contar(
          db
            .from("visits")
            .select(SELECT_VISITA_SEM_TESTE, { count: "exact", head: true })
            .eq("work_order.eh_teste", false)
            .eq("scheduled_date", amanha)
            .neq("status", "Cancelado"),
        ),
        contar(
          db
            .from("visits")
            .select(SELECT_VISITA_SEM_TESTE, { count: "exact", head: true })
            .eq("work_order.eh_teste", false)
            .lte("scheduled_date", hoje)
            .neq("status", "Concluído")
            .neq("status", "Cancelado"),
        ),
        admin ? fetchMonthSummary(noMes.de, noMes.ate, db) : Promise.resolve(null),
        buscarOsVendidasNoPeriodo(db, noMes.de, noMes.ate),
      ],
    );
    if (metaRes.error) throw metaRes.error;

    // Vendido pela data do serviço (sem OS de teste, cancelada ou excluída; visita cancelada fora).
    const vAtual = vendidoNoPeriodo(oss, atual, hoje);
    const vAnterior = vendidoNoPeriodo(oss, anterior, hoje);
    const vMes = vendidoNoPeriodo(oss, noMes, hoje);

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
        ...partes(vAtual),
        quantidade: vAtual.quantidade,
        anterior: { valor: vAnterior.valor, quantidade: vAnterior.quantidade },
      },
      vendidoMes: partes(vMes),
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
        valor: ticketMedio(vAtual.valor, vAtual.quantidade),
        anterior: ticketMedio(vAnterior.valor, vAnterior.quantidade),
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
        pct: percentualDaMeta(vMes.valor, metaValor),
      },
      // Só o admin recebe despesas e lucro: quem não é admin nem vê o número passar pela rede.
      despesas: resumoMes
        ? { pagas: resumoMes.fixedCosts, aPagar: resumoMes.expensesUnpaid }
        : null,
      lucro: resumoMes ? round2(resumoMes.netProfit) : null,
      vendidoPorSemana: vendidoPorSemanaServico(oss, semanas, hoje),
      vendidoPorOrigem: vendidoPorOrigemServico(vAtual),
      quemVendeu: vendidoPorVendedora(vAtual),
      proximosMeses: vendidoParaProximosMeses(vendidasNoMes, noMes, hoje),
      chips: { hoje: qtdHoje, amanha: qtdAmanha, paraConcluir },
    };
  });
