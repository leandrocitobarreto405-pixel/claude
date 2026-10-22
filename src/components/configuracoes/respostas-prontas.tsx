// Configurações › Mensagens › Respostas prontas: atalho + texto, por empresa. Na barra de
// resposta, "/atalho" (ou o botão ⚡) coloca o texto no campo. Variáveis: {nome}, {empresa},
// {atendente}.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Botao } from "@/components/nexa";
import {
  importarRespostasChatwootFn,
  listarRespostasFn,
  salvarRespostasFn,
} from "@/lib/respostas-prontas.functions";
import { limparAtalho, type RespostaPronta } from "@/lib/respostas-prontas";
import { mensagemDeErro } from "@/lib/erros";

const CHAVE = ["respostas-prontas"] as const;

export function RespostasProntasConfig() {
  const qc = useQueryClient();
  const listar = useServerFn(listarRespostasFn);
  const salvar = useServerFn(salvarRespostasFn);
  const importar = useServerFn(importarRespostasChatwootFn);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => listar() });
  const [itens, setItens] = useState<RespostaPronta[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (q.data && itens === null) setItens(q.data.itens);
  }, [q.data, itens]);
  const lista = itens ?? [];
  const mudou = q.data ? JSON.stringify(q.data.itens) !== JSON.stringify(lista) : false;

  function alterar(i: number, campo: "atalho" | "texto", valor: string) {
    setItens(lista.map((r, j) => (j === i ? { ...r, [campo]: valor } : r)));
  }

  async function gravar() {
    setOcupado(true);
    try {
      const r = await salvar({
        data: { itens: lista.map((x) => ({ ...x, atalho: limparAtalho(x.atalho) })) },
      });
      toast.success(`Respostas prontas salvas (${r.total}).`);
      setItens(null);
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não foi possível salvar."));
    } finally {
      setOcupado(false);
    }
  }

  async function trazerDoChatwoot() {
    if (mudou && !window.confirm("Há mudanças não salvas. Importar mesmo assim (elas se perdem)?"))
      return;
    setOcupado(true);
    try {
      const r = await importar();
      toast.success(
        r.novas
          ? `${r.novas} resposta(s) nova(s) do Chatwoot.`
          : `Nada novo: as ${r.noChatwoot} do Chatwoot já estão aqui.`,
      );
      setItens(null);
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não foi possível falar com o Chatwoot."));
    } finally {
      setOcupado(false);
    }
  }

  if (q.isLoading || itens === null)
    return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        Na conversa, digite <strong>/</strong> e o atalho (ex.: <strong>/bom</strong>) ou toque no
        raio ⚡ ao lado do campo. A resposta vai para o campo, sem enviar: dá para editar antes.
        Variáveis: <code>{"{nome}"}</code> (primeiro nome do cliente), <code>{"{empresa}"}</code> e{" "}
        <code>{"{atendente}"}</code> (quem está respondendo).
      </p>
      {q.data?.importadoEm ? (
        <p className="text-xs text-muted-foreground">
          Importadas do Chatwoot em{" "}
          {new Date(q.data.importadoEm).toLocaleString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            dateStyle: "short",
            timeStyle: "short",
          })}
          .
        </p>
      ) : null}
      {lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma resposta pronta ainda.</p>
      ) : (
        <ul className="grid gap-2">
          {lista.map((r, i) => (
            <li key={r.id} className="grid gap-2 rounded-card border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <span className="text-base font-bold text-marca">/</span>
                <input
                  value={r.atalho}
                  onChange={(ev) => alterar(i, "atalho", ev.target.value)}
                  placeholder="atalho"
                  aria-label="Atalho"
                  className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-base"
                />
                <button
                  type="button"
                  aria-label={`Apagar /${r.atalho}`}
                  onClick={() => {
                    if (window.confirm(`Apagar a resposta "/${r.atalho}"?`))
                      setItens(lista.filter((_, j) => j !== i));
                  }}
                  className="grid size-11 shrink-0 place-items-center rounded-full text-problema-foreground hover:bg-muted"
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </div>
              <textarea
                value={r.texto}
                onChange={(ev) => alterar(i, "texto", ev.target.value)}
                rows={3}
                aria-label="Texto da resposta"
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base"
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao
          variante="neutro"
          onClick={() => setItens([...lista, { id: `novo-${Date.now()}`, atalho: "", texto: "" }])}
        >
          <Plus aria-hidden /> Nova resposta
        </Botao>
        <Botao disabled={!mudou || ocupado} onClick={() => void gravar()}>
          {ocupado ? "Salvando…" : "Salvar"}
        </Botao>
        <Botao variante="contorno" disabled={ocupado} onClick={() => void trazerDoChatwoot()}>
          Importar do Chatwoot (só as que faltam)
        </Botao>
      </div>
    </div>
  );
}
