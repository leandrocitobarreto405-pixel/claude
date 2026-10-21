// Anexos das mensagens no navegador: baixa pelo servidor (/api/anexo/<id>) com o token da
// pessoa e a empresa ativa, e guarda a URL local enquanto a tela estiver aberta.
import { supabase } from "@/integrations/supabase/client";
import { EMPRESA_HEADER, getEmpresaAtiva } from "@/lib/empresa-ativa";

const cache = new Map<string, Promise<Blob>>();

export async function baixarAnexo(mensagemId: string, n = 0): Promise<Blob> {
  const chave = `${mensagemId}:${n}`;
  let p = cache.get(chave);
  if (!p) {
    p = (async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const empresa = getEmpresaAtiva();
      const r = await fetch(`/api/anexo/${mensagemId}${n ? `?n=${n}` : ""}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(empresa ? { [EMPRESA_HEADER]: empresa } : {}),
        },
      });
      if (!r.ok) throw new Error("Não foi possível carregar o arquivo.");
      return r.blob();
    })();
    p.catch(() => cache.delete(chave));
    cache.set(chave, p);
  }
  return p;
}
