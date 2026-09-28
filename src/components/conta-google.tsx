import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dateTimeBR } from "@/lib/format";
import { desconectarGoogle, iniciarConexaoGoogle, situacaoGoogle } from "@/lib/google.functions";

const AVISOS_RETORNO: Record<string, string> = {
  expirado: "O pedido de conexão expirou. Clique em “Conectar conta Google” de novo.",
  cancelado: "A conexão com o Google foi cancelada.",
  sem_permissao: "Apenas administradores da empresa podem conectar a conta Google.",
  sem_token:
    "O Google não enviou a autorização permanente. Remova o acesso do Nexa OS em myaccount.google.com/permissions e conecte de novo.",
  falha: "Não foi possível concluir a conexão com o Google. Tente novamente.",
};

export const GOOGLE_QUERY_KEY = ["google_conexao"];

/** Conta Google da empresa: usada pelos documentos da OS, pastas do Drive e Google Agenda. */
export function ContaGoogle() {
  const qc = useQueryClient();
  const situacaoFn = useServerFn(situacaoGoogle);
  const iniciarFn = useServerFn(iniciarConexaoGoogle);
  const desconectarFn = useServerFn(desconectarGoogle);
  const query = useQuery({ queryKey: GOOGLE_QUERY_KEY, queryFn: () => situacaoFn({}) });
  const [ocupado, setOcupado] = useState(false);

  // Mensagem da volta do Google (/configuracoes?google=...), mostrada uma vez.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resultado = params.get("google");
    if (!resultado) return;
    if (resultado === "conectado") toast.success("Conta Google conectada.");
    else if (resultado === "parcial")
      toast.warning(
        "Conta conectada, mas alguma permissão não foi marcada. Conecte de novo e marque todas.",
      );
    else toast.error(AVISOS_RETORNO[params.get("motivo") ?? ""] ?? AVISOS_RETORNO["falha"]!);
    params.delete("google");
    params.delete("motivo");
    const resto = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${resto ? `?${resto}` : ""}`);
  }, []);

  async function conectar() {
    setOcupado(true);
    try {
      const { url } = await iniciarFn({ data: { origem: window.location.origin } });
      window.location.assign(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível iniciar a conexão.");
      setOcupado(false);
    }
  }

  async function desconectar() {
    if (
      !window.confirm("Desconectar a conta Google? Documentos e agenda param até conectar outra.")
    ) {
      return;
    }
    setOcupado(true);
    try {
      await desconectarFn({});
      toast.success("Conta Google desconectada.");
      await qc.invalidateQueries({ queryKey: GOOGLE_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ["google_calendar_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desconectar.");
    } finally {
      setOcupado(false);
    }
  }

  const s = query.data;
  const comErro = s?.situacao === "erro" || (s?.permissoesFaltando.length ?? 0) > 0;

  return (
    <section className="card-surface max-w-3xl p-5">
      <h2 className="mb-1 text-lg font-semibold">Conta Google da empresa</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Usada para criar a pasta e o documento de cada OS no Google Drive, compartilhar com o
        cliente e lançar os serviços no Google Agenda. Conecte a conta que tem os modelos e a pasta
        de destino.
      </p>

      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : !s?.disponivel ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          O acesso ao Google ainda não foi liberado no servidor pela Nexa.
        </p>
      ) : s.conectado ? (
        <div className="grid gap-3">
          <div className="flex items-start gap-2 text-sm">
            {comErro ? (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            ) : (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
            )}
            <div className="min-w-0">
              <p>
                Conectada: <strong className="break-all">{s.email ?? "conta Google"}</strong>
              </p>
              {s.conectadoEm ? (
                <p className="text-xs text-muted-foreground">desde {dateTimeBR(s.conectadoEm)}</p>
              ) : null}
              {s.situacao === "erro" && s.erro ? (
                <p className="mt-1 text-amber-900">{s.erro}</p>
              ) : null}
              {s.permissoesFaltando.length ? (
                <p className="mt-1 text-amber-900">
                  Falta permissão para: {s.permissoesFaltando.join(", ")}. Conecte de novo e marque
                  todas as caixas na tela do Google.
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void conectar()} disabled={ocupado}>
              {comErro ? "Conectar de novo" : "Trocar conta"}
            </Button>
            <Button variant="outline" onClick={() => void desconectar()} disabled={ocupado}>
              Desconectar
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <Button className="w-fit" onClick={() => void conectar()} disabled={ocupado}>
            {ocupado ? "Abrindo o Google…" : "Conectar conta Google"}
          </Button>
          <p className="text-xs text-muted-foreground">
            O Google vai pedir para autorizar o Nexa OS a usar o Drive e a Agenda. Marque todas as
            permissões. Enquanto o app não for verificado pelo Google, aparece um aviso: clique em
            “Avançado” e depois em “Acessar Nexa OS”.
          </p>
        </div>
      )}
    </section>
  );
}
