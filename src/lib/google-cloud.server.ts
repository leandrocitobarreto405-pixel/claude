/**
 * Acesso às APIs do Google Cloud com a conta de serviço do próprio Cloud Run (servidor de
 * metadados). GCE_METADATA_HOST troca o servidor de metadados (padrão do Google; usado nos testes).
 */

function metadados(caminho: string) {
  const host = process.env["GCE_METADATA_HOST"] || "metadata.google.internal";
  return fetch(`http://${host}/computeMetadata/v1/${caminho}`, {
    headers: { "Metadata-Flavor": "Google" },
    signal: AbortSignal.timeout(5_000),
  });
}

export async function tokenDaContaDeServico(): Promise<string> {
  const res = await metadados("instance/service-accounts/default/token");
  if (!res.ok) throw new Error(`metadata do Google respondeu ${res.status}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

let projetoEmCache: string | null = null;

export async function projetoDoGoogle(): Promise<string> {
  if (projetoEmCache) return projetoEmCache;
  const res = await metadados("project/project-id");
  if (!res.ok) throw new Error(`metadata do Google respondeu ${res.status}`);
  projetoEmCache = (await res.text()).trim();
  return projetoEmCache;
}
