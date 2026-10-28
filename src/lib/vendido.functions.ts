import { createServerFn } from "@tanstack/react-start";
import { requireEmpresa } from "@/lib/empresa.middleware";
import { todayISO } from "@/lib/format";
import {
  vendidoNoPeriodo,
  vendidoParaProximosMeses,
  vendidoPorOrigemServico,
  vendidoPorVendedora,
} from "@/lib/vendido";
import { buscarOsDoPeriodo, buscarOsVendidasNoPeriodo } from "@/lib/vendido-dados";

// Vendido de um período qualquer (telas com filtro de datas), pela data do serviço: a mesma regra
// do Início. Roda com o cliente da pessoa (RLS da empresa ativa).

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export type VendidoDoPeriodo = {
  valor: number;
  quantidade: number;
  porOrigem: { origem: string; valor: number; quantidade: number }[];
  quemVendeu: { vendedora: string; valor: number; quantidade: number }[];
  proximosMeses: { valor: number; quantidade: number };
};

export const vendidoDoPeriodoFn = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .inputValidator((input: { de: string; ate: string }) => {
    if (!DATA.test(input.de) || !DATA.test(input.ate) || input.ate < input.de)
      throw new Error("Período inválido.");
    return input;
  })
  .handler(async ({ data, context }): Promise<VendidoDoPeriodo> => {
    const hoje = todayISO();
    const periodo = { de: data.de, ate: data.ate };
    const [oss, vendidas] = await Promise.all([
      buscarOsDoPeriodo(context.supabase, data.de, data.ate),
      buscarOsVendidasNoPeriodo(context.supabase, data.de, data.ate),
    ]);
    const v = vendidoNoPeriodo(oss, periodo, hoje);
    return {
      valor: v.valor,
      quantidade: v.quantidade,
      porOrigem: vendidoPorOrigemServico(v),
      quemVendeu: vendidoPorVendedora(v),
      proximosMeses: vendidoParaProximosMeses(vendidas, periodo, hoje),
    };
  });
