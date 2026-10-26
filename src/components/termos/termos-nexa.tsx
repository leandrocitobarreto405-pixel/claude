// Painel Nexa: versão vigente dos termos e link do documento. Versão nova = todos aceitam de novo.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Botao } from "@/components/nexa";
import { CHAVE_TERMOS, salvarTermosConfigFn, termosConfigFn } from "@/lib/termos.functions";

export function TermosNexa() {
  const queryClient = useQueryClient();
  const lerFn = useServerFn(termosConfigFn);
  const salvarFn = useServerFn(salvarTermosConfigFn);
  const q = useQuery({ queryKey: [...CHAVE_TERMOS, "config"], queryFn: () => lerFn() });
  const [versao, setVersao] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const v = versao ?? q.data?.versao ?? "";
  const u = url ?? q.data?.url ?? "";

  async function salvar() {
    setSalvando(true);
    try {
      await salvarFn({ data: { versao: v, url: u } });
      toast.success("Termos salvos. Quem ainda não aceitou esta versão vai ser perguntado.");
      await queryClient.invalidateQueries({ queryKey: CHAVE_TERMOS });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="card-surface mt-6 space-y-3 p-4">
      <h2 className="text-lg font-semibold">Termos de uso e privacidade</h2>
      <p className="text-sm text-muted-foreground">
        Com a versão preenchida, cada pessoa marca “li e aceito” ao entrar (guardamos quem, quando,
        IP e versão). Trocar a versão pede o aceite de novo para todos. Vazio: ninguém é perguntado.
      </p>
      {q.data?.versao ? (
        <p className="text-sm">
          Versão {q.data.versao}: {q.data.aceites} aceite(s).
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="termos-versao">Versão</Label>
          <Input
            id="termos-versao"
            placeholder="2026-11"
            value={v}
            onChange={(e) => setVersao(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="termos-url">Link do documento</Label>
          <Input
            id="termos-url"
            type="url"
            placeholder="https://…"
            value={u}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <Botao disabled={salvando || !v || !u} onClick={() => void salvar()}>
          Salvar
        </Botao>
      </div>
    </section>
  );
}
