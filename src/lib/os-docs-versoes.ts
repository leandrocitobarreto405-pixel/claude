/**
 * Um documento só por OS na pasta do cliente: quando o documento (ou o termo de garantia) é
 * gerado de novo, o anterior sai da pasta do cliente e vai para a pasta "Controle interno" da OS
 * (não compartilhada), com a data em que foi substituído.
 */

export type RegistroDoc = {
  id: string;
  created_at: string;
  google_document_id: string | null;
  generation_status: string;
  is_active: boolean;
};

export type ArquivoDrive = { id: string; name: string; createdTime: string; mimeType?: string };

const DOC_GOOGLE = "application/vnd.google-apps.document";

function semAcento(t: string) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Mesmo documento: o nome-base, com ou sem " - V2", " - V3"... */
export function ehMesmoDocumento(nomeArquivo: string, base: string): boolean {
  const n = semAcento(nomeArquivo);
  const b = semAcento(base);
  if (!b) return false;
  if (n === b) return true;
  return n.startsWith(`${b} - v`) && /^\d+$/.test(n.slice(b.length + 4));
}

/**
 * O que sai da pasta do cliente. Fica o documento gerado mais recente (pela hora em que a geração
 * começou), mesmo que duas gerações terminem juntas. Sai o resto: os registros anteriores e os
 * arquivos com o mesmo nome criados antes dele (de gerações antigas que perderam o registro).
 * Arquivo de uma geração ainda em andamento nunca sai.
 */
export function escolherSubstituidos(input: {
  registros: RegistroDoc[];
  arquivos: ArquivoDrive[];
  base: string;
}) {
  const gerados = input.registros
    .filter((r) => r.generation_status === "Gerado" && r.is_active && r.google_document_id)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const vencedor = gerados.at(-1) ?? null;
  if (!vencedor) return { vencedor: null, registros: [], arquivos: [] as string[] };

  const registros = gerados.filter((r) => r.id !== vencedor.id);
  const protegidos = new Set(
    input.registros
      .filter((r) => r.generation_status === "Gerando" && r.google_document_id)
      .map((r) => r.google_document_id!),
  );
  protegidos.add(vencedor.google_document_id!);

  const arquivos = new Set(registros.map((r) => r.google_document_id!));
  const inicio = Date.parse(vencedor.created_at);
  for (const a of input.arquivos) {
    if (a.mimeType && a.mimeType !== DOC_GOOGLE) continue;
    if (!ehMesmoDocumento(a.name, input.base)) continue;
    if (Date.parse(a.createdTime) >= inicio) continue;
    arquivos.add(a.id);
  }
  for (const id of protegidos) arquivos.delete(id);
  return { vencedor, registros, arquivos: [...arquivos] };
}

/** Nome do documento guardado no controle interno. */
export function nomeSubstituido(nome: string, quando: Date): string {
  const f = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(quando);
  return `${nome} (substituído em ${f.replace(",", "")})`;
}
