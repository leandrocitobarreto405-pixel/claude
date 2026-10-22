// Lista de respostas prontas da barra de resposta: abre com "/" no começo do campo (filtra pelo
// que vem depois) ou pelo botão ao lado do campo (com busca). Tocar coloca o texto no campo.
import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { filtrarRespostas, type RespostaPronta } from "@/lib/respostas-prontas";

export function PainelRespostas({
  itens,
  carregando,
  filtro,
  comBusca,
  aoMudarBusca,
  aoEscolher,
  aoFechar,
  podeEditar,
}: {
  itens: RespostaPronta[];
  carregando: boolean;
  filtro: string;
  comBusca: boolean;
  aoMudarBusca: (v: string) => void;
  aoEscolher: (r: RespostaPronta) => void;
  aoFechar: () => void;
  podeEditar: boolean;
}) {
  const buscaRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (comBusca) buscaRef.current?.focus();
  }, [comBusca]);
  const lista = filtrarRespostas(itens, filtro);
  return (
    <div
      role="dialog"
      aria-label="Respostas prontas"
      className="absolute inset-x-2 bottom-full z-20 mb-2 flex max-h-72 flex-col overflow-hidden rounded-card border border-border bg-card shadow-lg lg:inset-x-6"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        {comBusca ? (
          <input
            ref={buscaRef}
            value={filtro}
            onChange={(ev) => aoMudarBusca(ev.target.value)}
            placeholder="Buscar resposta pronta"
            aria-label="Buscar resposta pronta"
            className="min-h-11 min-w-0 flex-1 bg-transparent text-base outline-none"
          />
        ) : (
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">
            Respostas prontas{filtro ? `: "${filtro}"` : ""}
          </p>
        )}
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar respostas prontas"
          className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-muted"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {carregando ? (
          <li className="px-3 py-3 text-sm text-muted-foreground">Carregando…</li>
        ) : lista.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted-foreground">
            {itens.length === 0
              ? "Nenhuma resposta pronta cadastrada."
              : "Nenhuma resposta com esse atalho."}
            {podeEditar ? (
              <>
                {" "}
                <Link to="/configuracoes/mensagens" className="font-semibold text-marca underline">
                  Cadastrar em Configurações
                </Link>
              </>
            ) : null}
          </li>
        ) : (
          lista.map((r) => (
            <li key={r.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                // Não tira o foco do campo (o teclado do celular continua aberto).
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => aoEscolher(r)}
                className="flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-muted"
              >
                <span className="text-sm font-bold text-marca">/{r.atalho}</span>
                <span className="line-clamp-2 text-sm text-muted-foreground">{r.texto}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
