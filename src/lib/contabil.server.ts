/**
 * Área da contadora no servidor: arquivos da nota e das despesas no Storage, situação da nota,
 * aviso ao admin e cópia para o Google Drive da empresa (com nova tentativa pela rotina de cada
 * minuto). Usa a chave de serviço, sempre depois de conferir contadora_pode no banco.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { executarNaEmpresa } from "@/lib/request-db.server";
import { NOTA_BUCKET } from "@/lib/nota-fiscal";
import { tentarCopiaDrive, type ResultadoDrive } from "@/lib/contabil";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export async function dbServico(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Db;
}

async function driveConfigurado(db: Db, empresaId: string): Promise<string | null> {
  const { data } = await db
    .from("app_settings")
    .select("value")
    .eq("empresa_id", empresaId)
    .eq("key", "os_document_settings")
    .maybeSingle();
  const s = (data?.value ?? {}) as { enabled?: boolean; folderId?: string };
  return s.enabled && s.folderId ? s.folderId : null;
}

async function baixar(db: Db, caminho: string): Promise<Uint8Array> {
  const { data, error } = await db.storage.from(NOTA_BUCKET).download(caminho);
  if (error || !data) throw new Error("Não foi possível ler o arquivo guardado.");
  return new Uint8Array(await data.arrayBuffer());
}

const tipoDoNome = (nome: string) =>
  /\.xml$/i.test(nome)
    ? "application/xml"
    : /\.png$/i.test(nome)
      ? "image/png"
      : /\.jpe?g$/i.test(nome)
        ? "image/jpeg"
        : "application/pdf";

/** Copia o PDF/XML da nota para "Controle interno/…/<OS>/Nota fiscal" (pasta não compartilhada). */
async function copiarNota(db: Db, notaId: string): Promise<{ url: string } | "sem_drive"> {
  const { data: n, error } = await db
    .from("invoice_tasks")
    .select("id, empresa_id, work_order_id, arquivo_path, arquivo_nome, xml_path, xml_nome")
    .eq("id", notaId)
    .single();
  if (error || !n) throw new Error("Nota não encontrada.");
  if (!(await driveConfigurado(db, n.empresa_id))) return "sem_drive";
  return executarNaEmpresa({ db, empresaId: n.empresa_id, userId: "" }, async () => {
    const { ensureInternalFolder } = await import("@/lib/os-media.server");
    const { findOrCreateFolderStrict, uploadFile, driveFolderUrl } =
      await import("@/lib/google-docs.server");
    const interna = await ensureInternalFolder(n.work_order_id);
    const pasta = await findOrCreateFolderStrict("Nota fiscal", interna);
    for (const [caminho, nome] of [
      [n.arquivo_path, n.arquivo_nome],
      [n.xml_path, n.xml_nome],
    ] as const) {
      if (!caminho) continue;
      await uploadFile({
        name: nome || caminho.split("/").pop()!,
        mimeType: tipoDoNome(nome || caminho),
        parentId: pasta,
        bytes: await baixar(db, caminho),
      });
    }
    return { url: driveFolderUrl(pasta) };
  });
}

/** Copia o comprovante da despesa para "Despesas/AAAA-MM" na pasta do Drive da empresa. */
async function copiarDespesa(db: Db, despesaId: string): Promise<{ url: string } | "sem_drive"> {
  const { data: e, error } = await db
    .from("expenses")
    .select(
      "id, empresa_id, comprovante_path, comprovante_nome, competence_date, due_date, payment_date",
    )
    .eq("id", despesaId)
    .single();
  if (error || !e || !e.comprovante_path) throw new Error("Despesa sem comprovante.");
  const raiz = await driveConfigurado(db, e.empresa_id);
  if (!raiz) return "sem_drive";
  const mes = String(e.competence_date ?? e.due_date ?? e.payment_date ?? "").slice(0, 7);
  return executarNaEmpresa({ db, empresaId: e.empresa_id, userId: "" }, async () => {
    const { findOrCreateFolderStrict, uploadFile, driveFolderUrl } =
      await import("@/lib/google-docs.server");
    const despesas = await findOrCreateFolderStrict("Despesas", raiz);
    const pasta = await findOrCreateFolderStrict(mes || "sem-data", despesas);
    await uploadFile({
      name: e.comprovante_nome || e.comprovante_path.split("/").pop()!,
      mimeType: tipoDoNome(e.comprovante_nome || e.comprovante_path),
      parentId: pasta,
      bytes: await baixar(db, e.comprovante_path),
    });
    return { url: driveFolderUrl(pasta) };
  });
}

async function gravarDrive(
  db: Db,
  tabela: "invoice_tasks" | "expenses",
  id: string,
  r: ResultadoDrive,
) {
  await db
    .from(tabela)
    .update({
      drive_situacao: r.situacao,
      drive_tentativas: r.tentativas,
      drive_erro: r.erro,
      ...(r.url ? { drive_url: r.url } : {}),
    })
    .eq("id", id);
}

/** Uma tentativa de cópia da nota (logo depois do anexo, ou pela rotina). */
export async function copiarNotaParaDrive(db: Db, notaId: string): Promise<ResultadoDrive> {
  const { data } = await db
    .from("invoice_tasks")
    .select("drive_tentativas")
    .eq("id", notaId)
    .single();
  const r = await tentarCopiaDrive(Number(data?.drive_tentativas ?? 0), () =>
    copiarNota(db, notaId),
  );
  await gravarDrive(db, "invoice_tasks", notaId, r);
  return r;
}

export async function copiarDespesaParaDrive(db: Db, despesaId: string): Promise<ResultadoDrive> {
  const { data } = await db
    .from("expenses")
    .select("drive_tentativas")
    .eq("id", despesaId)
    .single();
  const r = await tentarCopiaDrive(Number(data?.drive_tentativas ?? 0), () =>
    copiarDespesa(db, despesaId),
  );
  await gravarDrive(db, "expenses", despesaId, r);
  return r;
}

/** Rotina de cada minuto: refaz as cópias pendentes (no máximo 10 por vez). */
export async function rotinaDriveContabil(dbArg?: Db) {
  const db = dbArg ?? (await dbServico());
  const [notas, despesas] = await Promise.all([
    db.from("invoice_tasks").select("id").eq("drive_situacao", "pendente").limit(10),
    db.from("expenses").select("id").eq("drive_situacao", "pendente").limit(10),
  ]);
  let copiadas = 0;
  let falhas = 0;
  for (const n of notas.data ?? []) {
    const r = await copiarNotaParaDrive(db, n.id);
    if (r.situacao === "copiada") copiadas++;
    else if (r.situacao !== "sem_drive") falhas++;
  }
  for (const d of despesas.data ?? []) {
    const r = await copiarDespesaParaDrive(db, d.id);
    if (r.situacao === "copiada") copiadas++;
    else if (r.situacao !== "sem_drive") falhas++;
  }
  return { copiadas, falhas };
}
