/**
 * Integração servidor-only com Google Docs e Google Drive via connector gateway.
 * Nenhum ID de modelo, pasta ou token trafega para o navegador.
 */

const DOCS_BASE = "https://connector-gateway.lovable.dev/google_docs/v1";
const DRIVE_BASE = "https://connector-gateway.lovable.dev/google_drive/drive/v3";

function headers(connector: "docs" | "drive", includeJson = true) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connKey =
    connector === "docs" ? process.env["GOOGLE_DOCS_API_KEY"] : process.env["GOOGLE_DRIVE_API_KEY"];
  if (!lovableKey || !connKey) {
    throw new Error("Integração com o Google não está disponível no servidor.");
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connKey,
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
  };
}

async function call<T>(
  connector: "docs" | "drive",
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const base = connector === "docs" ? DOCS_BASE : DRIVE_BASE;
  const res = await fetch(`${base}${path}`, {
    method: init?.method ?? "GET",
    headers: headers(connector),
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Google ${connector} ${path} falhou [${res.status}]: ${text}`);
    if (res.status === 404) throw new Error("Modelo ou pasta não encontrado no Google.");
    if (res.status === 401 || res.status === 403)
      throw new Error("Sem acesso ao arquivo no Google. Verifique o compartilhamento.");
    throw new Error(`Falha na comunicação com o Google (${res.status}).`);
  }
  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/** Aceita link completo do Google ou o próprio ID. */
export function extractGoogleId(value: string): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const doc = raw.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (doc) return doc[1]!;
  const folder = raw.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folder) return folder[1]!;
  const query = raw.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (query) return query[1]!;
  if (/^[a-zA-Z0-9_-]{10,}$/.test(raw)) return raw;
  return "";
}

export type DriveFile = { id: string; name?: string; mimeType?: string; webViewLink?: string };

export async function getFile(fileId: string): Promise<DriveFile> {
  return call<DriveFile>(
    "drive",
    `/files/${fileId}?fields=id,name,mimeType,webViewLink&supportsAllDrives=true`,
  );
}

export async function copyFile(fileId: string, name: string, parentId?: string | null) {
  return call<DriveFile>(
    "drive",
    `/files/${fileId}/copy?fields=id,name,webViewLink&supportsAllDrives=true`,
    {
      method: "POST",
      body: { name, ...(parentId ? { parents: [parentId] } : {}) },
    },
  );
}

export async function deleteFile(fileId: string) {
  await call("drive", `/files/${fileId}?supportsAllDrives=true`, { method: "DELETE" });
}

export async function uploadFile(input: {
  name: string;
  mimeType: string;
  parentId: string;
  bytes: Uint8Array;
}): Promise<DriveFile> {
  const boundary = `nexa_os_${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const metadata = JSON.stringify({
    name: input.name,
    mimeType: input.mimeType,
    parents: [input.parentId],
  });
  const start = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`,
  );
  const end = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(start.length + input.bytes.length + end.length);
  body.set(start, 0);
  body.set(input.bytes, start.length);
  body.set(end, start.length + input.bytes.length);

  const response = await fetch(
    "https://connector-gateway.lovable.dev/google_drive/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,webViewLink",
    {
      method: "POST",
      headers: {
        ...headers("drive", false),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`Google Drive upload falhou [${response.status}]: ${errorBody}`);
    if (response.status === 401 || response.status === 403) {
      throw new Error("Sem acesso para enviar arquivos ao Google Drive.");
    }
    throw new Error(`Falha ao enviar arquivo ao Google Drive (${response.status}).`);
  }
  return (await response.json()) as DriveFile;
}

export async function shareFolderForAnyone(folderId: string) {
  await call("drive", `/files/${folderId}/permissions?supportsAllDrives=true`, {
    method: "POST",
    body: { type: "anyone", role: "reader", allowFileDiscovery: false },
  });
  return getFile(folderId);
}

/** Compartilha a pasta com o e-mail do cliente (leitura) e avisa por e-mail. */
export async function shareFolderWithEmail(folderId: string, email: string) {
  await call(
    "drive",
    `/files/${folderId}/permissions?supportsAllDrives=true&sendNotificationEmail=true`,
    {
      method: "POST",
      body: { type: "user", role: "reader", emailAddress: email },
    },
  );
}

/** Renomeia um arquivo ou pasta do Drive. */
export async function renameFile(fileId: string, name: string) {
  await call<DriveFile>("drive", `/files/${fileId}?supportsAllDrives=true&fields=id,name`, {
    method: "PATCH",
    body: { name },
  });
}

export function driveFolderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export async function findOrCreateFolderStrict(name: string, parentId: string): Promise<string> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and trashed=false`,
  );
  const found = await call<{ files?: DriveFile[] }>(
    "drive",
    `/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
  );
  const hit = found.files?.[0]?.id;
  if (hit) return hit;
  const created = await call<DriveFile>("drive", `/files?fields=id&supportsAllDrives=true`, {
    method: "POST",
    body: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
  });
  return created.id;
}

export async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  try {
    return await findOrCreateFolderStrict(name, parentId);
  } catch {
    return parentId;
  }
}

// ---------- Google Docs ----------

type TextRun = { content?: string };
type ParagraphElement = { textRun?: TextRun; startIndex?: number; endIndex?: number };
type Paragraph = { elements?: ParagraphElement[] };
type StructuralElement = {
  startIndex?: number;
  endIndex?: number;
  paragraph?: Paragraph;
  table?: Table;
};
type TableCell = { startIndex?: number; endIndex?: number; content?: StructuralElement[] };
type TableRow = { startIndex?: number; endIndex?: number; tableCells?: TableCell[] };
type Table = { tableRows?: TableRow[] };
export type GoogleDoc = {
  documentId: string;
  title?: string;
  body?: { content?: StructuralElement[] };
};

export async function getDocument(documentId: string) {
  return call<GoogleDoc>("docs", `/documents/${documentId}`);
}

export async function batchUpdate(documentId: string, requests: unknown[]) {
  if (!requests.length) return;
  await call("docs", `/documents/${documentId}:batchUpdate`, {
    method: "POST",
    body: { requests },
  });
}

function elementText(el: StructuralElement): string {
  if (!el.paragraph?.elements) return "";
  return el.paragraph.elements.map((e) => e.textRun?.content ?? "").join("");
}

function cellText(cell: TableCell): string {
  return (cell.content ?? []).map(elementText).join("");
}

function walkTables(content: StructuralElement[] | undefined, out: StructuralElement[] = []) {
  for (const el of content ?? []) {
    if (el.table) {
      out.push(el);
      for (const row of el.table.tableRows ?? [])
        for (const cell of row.tableCells ?? []) walkTables(cell.content, out);
    }
  }
  return out;
}

const ITEM_MARKERS = ["{{ITEM}}", "{{QTD}}", "{{VALOR}}", "{{VALOR_HIG}}", "{{VALOR_IMP}}"];

type MarkerRow = {
  tableElement: StructuralElement;
  rowIndex: number;
  columns: string[];
};

/** Localiza a linha marcadora da tabela de itens. */
function findMarkerRow(doc: GoogleDoc): MarkerRow | null {
  for (const tableEl of walkTables(doc.body?.content)) {
    const rows = tableEl.table?.tableRows ?? [];
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r]!.tableCells ?? [];
      const texts = cells.map(cellText);
      if (texts.some((t) => ITEM_MARKERS.some((m) => t.includes(m)))) {
        return { tableElement: tableEl, rowIndex: r, columns: texts };
      }
    }
  }
  return null;
}

export type DocItem = {
  item: string;
  qty: string;
  value: string;
  valueHig: string;
  valueImp: string;
};

function markerValue(marker: string, item: DocItem): string {
  switch (marker) {
    case "{{ITEM}}":
      return item.item;
    case "{{QTD}}":
      return item.qty;
    case "{{VALOR}}":
      return item.value;
    case "{{VALOR_HIG}}":
      return item.valueHig;
    case "{{VALOR_IMP}}":
      return item.valueImp;
    default:
      return "";
  }
}

/** Preenche a tabela dinâmica de itens preservando bordas e formatação da linha modelo. */
export async function fillItemsTable(documentId: string, items: DocItem[]) {
  if (!items.length) return;

  let doc = await getDocument(documentId);
  let marker = findMarkerRow(doc);
  if (!marker) throw new Error("Não foi possível montar a tabela de itens do documento.");

  const columnMarkers = marker.columns.map(
    (text) => ITEM_MARKERS.find((m) => text.includes(m)) ?? null,
  );

  // Duplica a linha modelo (mantém bordas/formatação) para os itens extras.
  if (items.length > 1) {
    const requests = [];
    for (let i = 0; i < items.length - 1; i++) {
      requests.push({
        insertTableRow: {
          tableCellLocation: {
            tableStartLocation: { index: marker.tableElement.startIndex },
            rowIndex: marker.rowIndex,
            columnIndex: 0,
          },
          insertBelow: true,
        },
      });
    }
    await batchUpdate(documentId, requests);
    doc = await getDocument(documentId);
    marker = findMarkerRow(doc);
    if (!marker) throw new Error("Não foi possível montar a tabela de itens do documento.");
  }

  const rows = marker.tableElement.table?.tableRows ?? [];
  const targetRows = rows.slice(marker.rowIndex, marker.rowIndex + items.length);

  // Preenche de baixo para cima para os índices não se deslocarem.
  const requests: unknown[] = [];
  for (let r = targetRows.length - 1; r >= 0; r--) {
    const row = targetRows[r]!;
    const item = items[r]!;
    const cells = row.tableCells ?? [];
    for (let c = cells.length - 1; c >= 0; c--) {
      const cell = cells[c]!;
      const mk = columnMarkers[c];
      if (!mk) continue;
      const current = cellText(cell);
      const text = markerValue(mk, item) || "—";
      if (current.includes(mk)) {
        // Linha original: troca o marcador pelo valor.
        requests.push({
          replaceAllText: { containsText: { text: mk, matchCase: true }, replaceText: text },
        });
      } else {
        const start = cell.content?.[0]?.startIndex;
        if (start == null) continue;
        requests.push({ insertText: { location: { index: start }, text } });
      }
    }
  }
  await batchUpdate(documentId, requests);
}

/** Substitui os placeholders simples; valores vazios removem o placeholder. */
export async function replacePlaceholders(documentId: string, values: Record<string, string>) {
  const requests = Object.entries(values).map(([key, value]) => ({
    replaceAllText: {
      containsText: { text: `{{${key}}}`, matchCase: true },
      replaceText: value ?? "",
    },
  }));
  await batchUpdate(documentId, requests);
}

/** Remove quaisquer placeholders remanescentes do documento. */
export async function stripRemainingPlaceholders(documentId: string) {
  const doc = await getDocument(documentId);
  const texts = new Set<string>();
  const collect = (content: StructuralElement[] | undefined) => {
    for (const el of content ?? []) {
      const t = elementText(el);
      for (const m of t.matchAll(/\{\{[A-Z0-9_]+\}\}/g)) texts.add(m[0]);
      for (const row of el.table?.tableRows ?? [])
        for (const cell of row.tableCells ?? []) collect(cell.content);
    }
  };
  collect(doc.body?.content);
  await batchUpdate(
    documentId,
    [...texts].map((t) => ({
      replaceAllText: { containsText: { text: t, matchCase: true }, replaceText: "" },
    })),
  );
}

export function docUrl(documentId: string) {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

/** Cria um documento vazio no Google Docs. */
export async function createDocument(title: string) {
  return call<{ documentId: string }>("docs", `/documents`, { method: "POST", body: { title } });
}

/** Move o arquivo para a pasta informada. */
export async function moveFile(fileId: string, parentId: string) {
  const file = await call<{ parents?: string[] }>(
    "drive",
    `/files/${fileId}?fields=parents&supportsAllDrives=true`,
  );
  const remover = (file.parents ?? []).join(",");
  const query = `addParents=${parentId}${remover ? `&removeParents=${remover}` : ""}`;
  await call("drive", `/files/${fileId}?${query}&fields=id&supportsAllDrives=true`, {
    method: "PATCH",
    body: {},
  });
}

export type DocBlock = { text: string; heading?: 1 | 2; bold?: boolean };

/** Escreve o conteúdo do documento a partir de blocos de parágrafo simples. */
export async function writeBlocks(documentId: string, blocks: DocBlock[]) {
  const texto = blocks.map((b) => b.text).join("\n") + "\n";
  await batchUpdate(documentId, [{ insertText: { location: { index: 1 }, text: texto } }]);

  const requests: unknown[] = [];
  let cursor = 1;
  for (const b of blocks) {
    const start = cursor;
    const end = start + b.text.length;
    if (b.text.length) {
      if (b.bold) {
        requests.push({
          updateTextStyle: {
            range: { startIndex: start, endIndex: end },
            textStyle: { bold: true },
            fields: "bold",
          },
        });
      }
      if (b.heading) {
        requests.push({
          updateParagraphStyle: {
            range: { startIndex: start, endIndex: end },
            paragraphStyle: { namedStyleType: `HEADING_${b.heading}` },
            fields: "namedStyleType",
          },
        });
      }
    }
    cursor = end + 1;
  }
  await batchUpdate(documentId, requests);
}
