/**
 * Exportar mês da contadora: zip das notas emitidas (PDF e XML), planilha/CSV das OS realizadas e
 * CSV das despesas com o link do comprovante (link de 7 dias). Arquivos em base64 para o navegador
 * baixar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { csv } from "@/lib/contabil";
import { NOTA_BUCKET } from "@/lib/nota-fiscal";
import type { DespesaContabil, NotaContabil, OsRealizada } from "@/lib/contadora.functions";

type Ctx = { supabase: SupabaseClient };
type Pedido = {
  empresaId: string;
  mes: string;
  de: string;
  ate: string;
  tipo: "notas_zip" | "os_csv" | "os_xlsx" | "despesas_csv";
};
export type Arquivo = { nome: string; tipo: string; base64: string; quantidade: number };

const b64 = (b: Uint8Array | Buffer | string) => Buffer.from(b).toString("base64");
const dataBR = (d: string | null) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "");

async function rpc<T>(ctx: Ctx, nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.supabase.rpc(nome as never, args as never);
  if (error) throw new Error("Não foi possível carregar.");
  return data as T;
}

export function linhasOs(os: OsRealizada[]) {
  return [
    [
      "OS",
      "Data",
      "Cliente",
      "CPF/CNPJ",
      "E-mail",
      "Endereço",
      "Serviços",
      "Valor",
      "Pagamento recebido",
      "Valor recebido",
      "Repasse a parceiro",
      "Nota",
      "Nº da nota",
    ],
    ...os.map((o) => [
      o.os,
      dataBR(o.data),
      o.cliente,
      o.documento,
      o.email,
      o.endereco,
      (o.servicos ?? [])
        .map(
          (s) =>
            `${s.servico}${s.descricao ? ` (${s.descricao})` : ""}${s.repasse_parceiro ? ` [parceiro: ${s.repasse_parceiro}]` : ""}`,
        )
        .join("; "),
      o.valor === null ? null : Number(o.valor),
      o.pagamento,
      Number(o.recebido ?? 0),
      o.repasse_total === null ? null : Number(o.repasse_total),
      o.nota === "Não emitir" ? "Não necessária" : o.nota,
      o.nota_numero,
    ]),
  ];
}

export async function exportarMes(ctx: Ctx, p: Pedido): Promise<Arquivo> {
  const { dbServico } = await import("@/lib/contabil.server");
  if (p.tipo === "os_csv" || p.tipo === "os_xlsx") {
    const os = await rpc<OsRealizada[]>(ctx, "contadora_os_realizadas", {
      _emp: p.empresaId,
      _de: p.de,
      _ate: p.ate,
    });
    const linhas = linhasOs(os);
    if (p.tipo === "os_csv")
      return {
        nome: `os-realizadas-${p.mes}.csv`,
        tipo: "text/csv",
        base64: b64(csv(linhas)),
        quantidade: os.length,
      };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), "OS realizadas");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return {
      nome: `os-realizadas-${p.mes}.xlsx`,
      tipo: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      base64: b64(buf),
      quantidade: os.length,
    };
  }
  const db = await dbServico();
  if (p.tipo === "despesas_csv") {
    const despesas = await rpc<DespesaContabil[]>(ctx, "contadora_despesas", {
      _emp: p.empresaId,
      _de: p.de,
      _ate: p.ate,
    });
    const linhas: Array<Array<string | number | null>> = [
      [
        "Data",
        "Descrição",
        "Fornecedor",
        "Categoria",
        "Situação",
        "Valor",
        "Pago em",
        "Comprovante (link de 7 dias)",
      ],
    ];
    for (const d of despesas) {
      let link: string | null = null;
      if (d.comprovante_path) {
        const { data } = await db.storage
          .from(NOTA_BUCKET)
          .createSignedUrl(d.comprovante_path, 7 * 86400);
        link = data?.signedUrl ?? null;
      }
      linhas.push([
        dataBR(d.data),
        d.descricao,
        d.fornecedor,
        d.categoria,
        d.status,
        d.valor === null ? null : Number(d.valor),
        dataBR(d.pagamento),
        link ?? (d.comprovante_path ? "indisponível" : "sem comprovante"),
      ]);
    }
    return {
      nome: `despesas-${p.mes}.csv`,
      tipo: "text/csv",
      base64: b64(csv(linhas)),
      quantidade: despesas.length,
    };
  }
  // Notas emitidas no mês (pela data de emissão): PDF e XML de cada uma.
  const notas = await rpc<NotaContabil[]>(ctx, "contadora_notas", {
    _emp: p.empresaId,
    _filtro: "emitidas",
    _de: p.de,
    _ate: p.ate,
  });
  const zip = XLSX.CFB.utils.cfb_new();
  let n = 0;
  const usados = new Set<string>();
  for (const nota of notas) {
    for (const [caminho, nome] of [
      [nota.arquivo_path, nota.arquivo_nome],
      [nota.xml_path, nota.xml_nome],
    ] as const) {
      if (!caminho) continue;
      const { data } = await db.storage.from(NOTA_BUCKET).download(caminho);
      if (!data) continue;
      const ext = (nome || caminho).split(".").pop()?.toLowerCase() ?? "pdf";
      let arq = `OS ${nota.os} - nota ${nota.numero ?? "s-n"}.${ext}`.replace(/[\\/:*?"<>|]/g, "-");
      for (let i = 2; usados.has(arq); i++) arq = arq.replace(/(\.\w+)$/, ` (${i})$1`);
      usados.add(arq);
      XLSX.CFB.utils.cfb_add(zip, arq, Buffer.from(await data.arrayBuffer()));
      n++;
    }
  }
  const lista = csv([
    ["OS", "Cliente", "CPF/CNPJ", "Nº da nota", "Emissão", "Valor"],
    ...notas.map((x) => [
      x.os,
      x.cliente,
      x.documento,
      x.numero,
      dataBR(x.data_emissao),
      x.valor === null ? null : Number(x.valor),
    ]),
  ]);
  XLSX.CFB.utils.cfb_add(zip, `notas-${p.mes}.csv`, Buffer.from(lista));
  const buf = XLSX.CFB.write(zip, { type: "buffer", fileType: "zip" }) as Buffer;
  return {
    nome: `notas-emitidas-${p.mes}.zip`,
    tipo: "application/zip",
    base64: b64(buf),
    quantidade: n,
  };
}
