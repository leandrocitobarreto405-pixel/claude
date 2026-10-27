/**
 * Funções da área da contadora. Leituras pelas funções contadora_* do banco (com o login dela, que
 * conferem o vínculo); anexar e marcar pelo servidor com a chave de serviço, sempre depois de
 * contadora_pode(empresa). Ela nunca recebe acesso direto às tabelas nem ao Storage.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  STATUS_DA_ACAO,
  csv,
  nomeSeguro,
  periodoDoMes,
  validarAcaoNota,
  validarArquivo,
  type AcaoNota,
} from "@/lib/contabil";
import { NOTA_BUCKET } from "@/lib/nota-fiscal";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown, campo = "empresa") => {
  const s = String(v ?? "");
  if (!UUID.test(s)) throw new Error(`Identificador de ${campo} inválido.`);
  return s;
};

type Ctx = { supabase: import("@supabase/supabase-js").SupabaseClient; userId: string };

async function exigirAcesso(ctx: Ctx, empresaId: string) {
  const { data, error } = await ctx.supabase.rpc(
    "contadora_pode" as never,
    { _emp: empresaId } as never,
  );
  if (error || data !== true) throw new Error("Você não tem acesso a esta empresa.");
}

async function chamar<T>(ctx: Ctx, nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await ctx.supabase.rpc(nome as never, args as never);
  if (error) throw new Error(error.code === "42501" ? "Sem acesso." : "Não foi possível carregar.");
  return data as T;
}

export type OsRealizada = {
  id: string;
  os: string;
  cliente: string | null;
  documento: string | null;
  email: string | null;
  endereco: string | null;
  servicos: Array<{
    servico: string;
    descricao: string | null;
    valor: number | null;
    repasse_parceiro: number | null;
  }> | null;
  valor: number | null;
  repasse_total: number | null;
  data: string;
  pagamento: string | null;
  recebido: number;
  nota_id: string | null;
  nota: string;
  nota_numero: string | null;
};

export type NotaContabil = {
  id: string;
  status: string;
  os: string;
  cliente: string | null;
  documento: string | null;
  email: string | null;
  endereco: string | null;
  valor: number | null;
  data_servico: string | null;
  numero: string | null;
  data_emissao: string | null;
  arquivo_path: string | null;
  arquivo_nome: string | null;
  xml_path: string | null;
  xml_nome: string | null;
  motivo_cancelamento: string | null;
  drive: string | null;
  drive_url: string | null;
  criada_em: string;
};

export type DespesaContabil = {
  id: string;
  descricao: string | null;
  fornecedor: string | null;
  categoria: string | null;
  status: string | null;
  valor: number | null;
  data: string | null;
  pagamento: string | null;
  comprovante_path: string | null;
  comprovante_nome: string | null;
  drive: string | null;
  drive_url: string | null;
};

export const empresasDaContadoraFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    chamar<Array<{ empresa_id: string; nome: string }>>(context, "contadora_minhas_empresas", {}),
  );

export const osRealizadasFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { empresaId: string; mes: string }) => ({
    empresaId: uuid(i.empresaId),
    ...periodoDoMes(String(i.mes)),
  }))
  .handler(async ({ data, context }) =>
    chamar<OsRealizada[]>(context, "contadora_os_realizadas", {
      _emp: data.empresaId,
      _de: data.de,
      _ate: data.ate,
    }),
  );

export const notasContabilFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: { empresaId: string; filtro: "para_emitir" | "todas" | "emitidas"; mes?: string }) => ({
      empresaId: uuid(i.empresaId),
      filtro: ["para_emitir", "todas", "emitidas"].includes(i.filtro) ? i.filtro : "para_emitir",
      ...(i.mes ? periodoDoMes(String(i.mes)) : { de: null, ate: null }),
    }),
  )
  .handler(async ({ data, context }) =>
    chamar<NotaContabil[]>(context, "contadora_notas", {
      _emp: data.empresaId,
      _filtro: data.filtro,
      _de: data.de,
      _ate: data.ate,
    }),
  );

export const despesasContabilFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { empresaId: string; mes: string }) => ({
    empresaId: uuid(i.empresaId),
    ...periodoDoMes(String(i.mes)),
  }))
  .handler(async ({ data, context }) =>
    chamar<DespesaContabil[]>(context, "contadora_despesas", {
      _emp: data.empresaId,
      _de: data.de,
      _ate: data.ate,
    }),
  );

/** Link de 10 minutos para um arquivo da nota ou comprovante desta empresa. */
export const linkArquivoContabilFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { empresaId: string; caminho: string; baixar?: boolean }) => ({
    empresaId: uuid(i.empresaId),
    caminho: String(i.caminho ?? ""),
    baixar: Boolean(i.baixar),
  }))
  .handler(async ({ data, context }) => {
    await exigirAcesso(context, data.empresaId);
    if (!data.caminho.startsWith(`${data.empresaId}/`) || data.caminho.includes(".."))
      throw new Error("Arquivo inválido.");
    const { dbServico } = await import("@/lib/contabil.server");
    const db = await dbServico();
    const [n, e] = await Promise.all([
      db
        .from("invoice_tasks")
        .select("id")
        .eq("empresa_id", data.empresaId)
        .or(`arquivo_path.eq.${data.caminho},xml_path.eq.${data.caminho}`)
        .limit(1),
      db
        .from("expenses")
        .select("id")
        .eq("empresa_id", data.empresaId)
        .eq("comprovante_path", data.caminho)
        .limit(1),
    ]);
    if (!n.data?.length && !e.data?.length) throw new Error("Arquivo não encontrado.");
    const { data: s, error } = await db.storage
      .from(NOTA_BUCKET)
      .createSignedUrl(data.caminho, 600, data.baixar ? { download: true } : undefined);
    if (error || !s) throw new Error("Não foi possível abrir o arquivo.");
    return s.signedUrl;
  });

function lerFormulario(f: FormData) {
  if (!(f instanceof FormData)) throw new Error("Envio inválido.");
  const arquivo = f.get("arquivo");
  if (!(arquivo instanceof File)) throw new Error("Escolha o arquivo.");
  return { arquivo, campo: (k: string) => String(f.get(k) ?? "") };
}

/** Anexa o PDF (ou imagem) ou o XML da nota. */
export const anexarArquivoNotaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((f: FormData) => {
    const { arquivo, campo } = lerFormulario(f);
    const tipo = campo("tipo") === "xml" ? "xml" : "pdf";
    const v = validarArquivo(arquivo.name, arquivo.size, tipo);
    if (!v.ok) throw new Error(v.motivo);
    return {
      empresaId: uuid(campo("empresaId")),
      notaId: uuid(campo("notaId"), "nota"),
      tipo,
      arquivo,
      mime: v.tipo,
    };
  })
  .handler(async ({ data, context }) => {
    await exigirAcesso(context, data.empresaId);
    const { dbServico, copiarNotaParaDrive } = await import("@/lib/contabil.server");
    const db = await dbServico();
    const { data: nota } = await db
      .from("invoice_tasks")
      .select("id, status")
      .eq("id", data.notaId)
      .eq("empresa_id", data.empresaId)
      .maybeSingle();
    if (!nota) throw new Error("Nota não encontrada.");
    const caminho = `${data.empresaId}/${data.notaId}/${Date.now()}-${nomeSeguro(data.arquivo.name)}`;
    const { error: up } = await db.storage
      .from(NOTA_BUCKET)
      .upload(caminho, new Uint8Array(await data.arquivo.arrayBuffer()), {
        contentType: data.mime,
        upsert: false,
      });
    if (up) throw new Error("Não foi possível guardar o arquivo.");
    const campos =
      data.tipo === "xml"
        ? { xml_path: caminho, xml_nome: data.arquivo.name.slice(0, 200) }
        : { arquivo_path: caminho, arquivo_nome: data.arquivo.name.slice(0, 200) };
    const { error } = await db.from("invoice_tasks").update(campos).eq("id", data.notaId);
    if (error) throw new Error("Não foi possível registrar o arquivo.");
    // Nota já emitida: o arquivo novo também vai para o Drive.
    const drive = nota.status === "Emitida" ? await copiarNotaParaDrive(db, data.notaId) : null;
    return { ok: true, drive: drive?.situacao ?? null };
  });

/** Marca a nota: Emitida (número, data e arquivo), Cancelada (motivo) ou Não necessária. */
export const marcarNotaFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: {
      empresaId: string;
      notaId: string;
      acao: AcaoNota;
      numero?: string;
      data?: string;
      motivo?: string;
    }) => ({
      empresaId: uuid(i.empresaId),
      notaId: uuid(i.notaId, "nota"),
      acao: (["emitida", "cancelada", "nao_necessaria"] as const).includes(i.acao)
        ? i.acao
        : "emitida",
      numero: String(i.numero ?? "")
        .trim()
        .slice(0, 40),
      data: String(i.data ?? "").slice(0, 10),
      motivo: String(i.motivo ?? "")
        .trim()
        .slice(0, 300),
    }),
  )
  .handler(async ({ data, context }) => {
    await exigirAcesso(context, data.empresaId);
    const { dbServico, copiarNotaParaDrive } = await import("@/lib/contabil.server");
    const db = await dbServico();
    const { data: nota } = await db
      .from("invoice_tasks")
      .select(
        "id, arquivo_path, xml_path, work_order:work_order_id ( os_number, customer:customer_id ( full_name ) )",
      )
      .eq("id", data.notaId)
      .eq("empresa_id", data.empresaId)
      .maybeSingle();
    if (!nota) throw new Error("Nota não encontrada.");
    const erro = validarAcaoNota({
      ...data,
      temArquivo: Boolean(nota.arquivo_path || nota.xml_path),
    });
    if (erro) throw new Error(erro);
    const agora = new Date().toISOString();
    const campos: Record<string, unknown> = { status: STATUS_DA_ACAO[data.acao] };
    if (data.acao === "emitida")
      Object.assign(campos, {
        invoice_number: data.numero,
        issue_date: data.data,
        emitida_em: agora,
        emitida_por: context.userId,
        drive_situacao: "pendente",
        drive_tentativas: 0,
        drive_erro: null,
      });
    if (data.acao === "cancelada") campos["motivo_cancelamento"] = data.motivo;
    if (data.acao === "nao_necessaria" && data.motivo)
      campos["notes"] = `Não necessária: ${data.motivo}`;
    const { error } = await db.from("invoice_tasks").update(campos).eq("id", data.notaId);
    if (error) throw new Error("Não foi possível salvar.");
    let drive = null;
    if (data.acao === "emitida") {
      const wo = nota.work_order as unknown as {
        os_number: string;
        customer: { full_name: string | null } | null;
      } | null;
      // Aviso só no app, para a equipe (não vai WhatsApp, não vai para cliente).
      await db.from("mkt_avisos").insert({
        empresa_id: data.empresaId,
        tipo: "nota_emitida",
        titulo: "Nota fiscal emitida",
        mensagem: `OS ${wo?.os_number ?? "?"}${wo?.customer?.full_name ? ` · ${wo.customer.full_name}` : ""}: nota nº ${data.numero} emitida pela contadora.`,
        so_no_app: true,
        referencia: data.notaId,
      });
      drive = (await copiarNotaParaDrive(db, data.notaId)).situacao;
    }
    return { ok: true, drive };
  });

/** Anexa o comprovante (PDF, imagem ou XML) de uma despesa. */
export const anexarComprovanteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((f: FormData) => {
    const { arquivo, campo } = lerFormulario(f);
    const v = validarArquivo(arquivo.name, arquivo.size);
    if (!v.ok) throw new Error(v.motivo);
    return {
      empresaId: uuid(campo("empresaId")),
      despesaId: uuid(campo("despesaId"), "despesa"),
      arquivo,
      mime: v.tipo,
    };
  })
  .handler(async ({ data, context }) => {
    await exigirAcesso(context, data.empresaId);
    const { dbServico, copiarDespesaParaDrive } = await import("@/lib/contabil.server");
    const db = await dbServico();
    const { data: d } = await db
      .from("expenses")
      .select("id, competence_date, due_date, payment_date")
      .eq("id", data.despesaId)
      .eq("empresa_id", data.empresaId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!d) throw new Error("Despesa não encontrada.");
    const mes =
      String(d.competence_date ?? d.due_date ?? d.payment_date ?? "").slice(0, 7) || "sem-data";
    const caminho = `${data.empresaId}/despesas/${mes}/${data.despesaId}-${Date.now()}-${nomeSeguro(data.arquivo.name)}`;
    const { error: up } = await db.storage
      .from(NOTA_BUCKET)
      .upload(caminho, new Uint8Array(await data.arquivo.arrayBuffer()), {
        contentType: data.mime,
        upsert: false,
      });
    if (up) throw new Error("Não foi possível guardar o arquivo.");
    const { error } = await db
      .from("expenses")
      .update({
        comprovante_path: caminho,
        comprovante_nome: data.arquivo.name.slice(0, 200),
        comprovante_em: new Date().toISOString(),
        drive_situacao: "pendente",
        drive_tentativas: 0,
        drive_erro: null,
      })
      .eq("id", data.despesaId);
    if (error) throw new Error("Não foi possível registrar o comprovante.");
    const r = await copiarDespesaParaDrive(db, data.despesaId);
    return { ok: true, drive: r.situacao };
  });

/** Exportar mês: zip das notas emitidas, planilha das OS ou CSV das despesas (base64). */
export const exportarMesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (i: {
      empresaId: string;
      mes: string;
      tipo: "notas_zip" | "os_csv" | "os_xlsx" | "despesas_csv";
    }) => ({
      empresaId: uuid(i.empresaId),
      mes: String(i.mes),
      ...periodoDoMes(String(i.mes)),
      tipo: (["notas_zip", "os_csv", "os_xlsx", "despesas_csv"] as const).includes(i.tipo)
        ? i.tipo
        : "os_csv",
    }),
  )
  .handler(async ({ data, context }) => {
    await exigirAcesso(context, data.empresaId);
    const { exportarMes } = await import("@/lib/contabil-exportar.server");
    return exportarMes(context, data);
  });

export { csv };
