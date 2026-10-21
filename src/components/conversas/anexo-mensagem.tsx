// Áudio e foto das mensagens gravadas (do cliente, da Alice ou da equipe), baixados pelo
// servidor (/api/anexo) quando a pessoa toca/abre, nunca com o token do Chatwoot no navegador.
import { useEffect, useState } from "react";
import { PlayerAudio } from "@/components/conversas/player-audio";
import { baixarAnexo } from "@/lib/anexos";

export function AudioMensagem({
  mensagemId,
  transcricao,
}: {
  mensagemId: string;
  /** Texto que o app mostra para a mensagem ("(áudio)" ou a transcrição). */
  transcricao?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <PlayerAudio fonte={() => baixarAnexo(mensagemId)} />
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
