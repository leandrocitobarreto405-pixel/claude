// Áudio e foto das mensagens gravadas (do cliente, da Alice ou da equipe), baixados pelo
// servidor (/api/anexo), nunca com o token do Chatwoot no navegador. O áudio começa a baixar
// quando o balão aparece na tela (e o decodificador do Safari já é carregado), para tocar
// logo no primeiro toque.
import { useEffect, useRef, useState } from "react";
import { PlayerAudio } from "@/components/conversas/player-audio";
import { preCarregarDecodificador } from "@/lib/audio-reproducao";
import { baixarAnexo, esquecerAnexo } from "@/lib/anexos";

export function AudioMensagem({
  mensagemId,
  transcricao,
}: {
  mensagemId: string;
  /** Texto que o app mostra para a mensagem ("(áudio)" ou a transcrição). */
  transcricao?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    preCarregarDecodificador();
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (itens) => {
        if (itens.some((i) => i.isIntersecting)) {
          obs.disconnect();
          void baixarAnexo(mensagemId).catch(() => undefined);
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [mensagemId]);
  return (
    <div ref={ref} className="flex w-[min(280px,calc(100vw-8.5rem))] flex-col gap-1">
      <PlayerAudio
        fonte={() => baixarAnexo(mensagemId)}
        aoTentarDeNovo={() => esquecerAnexo(mensagemId)}
      />
      {transcricao && transcricao !== "(áudio)" ? (
        <p className="text-[13px] text-muted-foreground break-words whitespace-pre-wrap">
          {transcricao}
        </p>
      ) : null}
    </div>
  );
}

export function ImagemMensagem({ mensagemId, legenda }: { mensagemId: string; legenda?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let ativo = true;
    let criada: string | null = null;
    baixarAnexo(mensagemId)
      .then((blob) => {
        if (!ativo) return;
        criada = URL.createObjectURL(blob);
        setUrl(criada);
      })
      .catch(() => ativo && setFalhou(true));
    return () => {
      ativo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [mensagemId]);
  return (
    <div className="flex flex-col gap-1">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="Foto" className="max-h-64 max-w-full rounded-botao object-contain" />
        </a>
      ) : (
        <div className="flex h-24 w-40 items-center justify-center rounded-botao bg-muted text-[12px] text-muted-foreground">
          {falhou ? "Foto indisponível" : "Carregando foto…"}
        </div>
      )}
      {legenda && legenda !== "(foto)" ? (
        <p className="break-words whitespace-pre-wrap">{legenda}</p>
      ) : null}
    </div>
  );
}
