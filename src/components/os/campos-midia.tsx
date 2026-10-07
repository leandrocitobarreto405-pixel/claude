import { useRef } from "react";
import { Camera, Check, Lock, RotateCcw, X } from "lucide-react";
import { Botao } from "@/components/nexa";
import { type DestinoMidia, type Envio, textoDoEnvio } from "@/lib/envio-midia";
import { filaDeEnvios, useAoTerminarEnvio, useEnvios } from "@/lib/fila-envios";
import { ACEITA_MIDIA, validarMidia } from "@/lib/midia-os";

const ROTULO: Record<DestinoMidia, { titulo: string; botao: string; ajuda?: string }> = {
  Antes: { titulo: "Antes", botao: "Foto/vídeo de antes" },
  Depois: { titulo: "Depois", botao: "Foto/vídeo de depois" },
  Vídeos: { titulo: "Vídeos", botao: "Vídeo" },
  "Controle interno": {
    titulo: "Controle interno",
    botao: "Foto/vídeo interno",
    ajuda: "Só a equipe vê. Não vai para a pasta do cliente.",
  },
};

/**
 * Campos de fotos e vídeos da OS ("Antes", "Depois", "Controle interno" e, com
 * impermeabilização, "Vídeos"). Cada botão abre a galeria ou a câmera do celular; o envio começa
 * na hora, direto para o Google Drive, e continua mesmo se a tela fechar (com o app aberto).
 */
export function CamposMidia({
  workOrderId,
  destinos,
  quantidades,
  aoTerminar,
}: {
  workOrderId: string;
  destinos: DestinoMidia[];
  /** Arquivos já enviados por campo (opcional). */
  quantidades?: Partial<Record<DestinoMidia, number>>;
  aoTerminar?: () => void;
}) {
  useAoTerminarEnvio(workOrderId, () => aoTerminar?.());
  return (
    <div className="flex flex-col gap-3">
      {destinos.map((d) => (
        <Campo key={d} workOrderId={workOrderId} destino={d} quantidade={quantidades?.[d]} />
      ))}
      <ListaDeEnvios workOrderId={workOrderId} />
    </div>
  );
}

function Campo({
  workOrderId,
  destino,
  quantidade,
}: {
  workOrderId: string;
  destino: DestinoMidia;
  quantidade?: number | undefined;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const r = ROTULO[destino];
  const interno = destino === "Controle interno";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          {interno ? <Lock className="size-4 text-muted-foreground" aria-hidden /> : null}
          {r.titulo}
          {quantidade !== undefined ? ` (${quantidade})` : ""}
        </span>
        <Botao variante="contorno" onClick={() => ref.current?.click()}>
          <Camera /> {r.botao}
        </Botao>
        <input
          ref={ref}
          type="file"
          accept={ACEITA_MIDIA}
          multiple
          className="hidden"
          aria-label={r.botao}
          onChange={(e) => {
            const arquivos = Array.from(e.target.files ?? []);
            if (arquivos.length) filaDeEnvios().adicionar(workOrderId, destino, arquivos);
            e.target.value = "";
          }}
        />
      </div>
      {r.ajuda ? <p className="text-xs text-muted-foreground">{r.ajuda}</p> : null}
    </div>
  );
}

/** Envios desta OS: progresso, motivo do erro e "Tentar de novo". */
export function ListaDeEnvios({ workOrderId }: { workOrderId?: string }) {
  const envios = useEnvios(workOrderId);
  if (!envios.length) return null;
  const prontos = envios.filter((e) => e.estado === "pronto").length;
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <ul className="flex flex-col gap-2">
        {envios.map((e) => (
          <LinhaDeEnvio key={e.id} envio={e} />
        ))}
      </ul>
      {prontos ? (
        <Botao
          variante="neutro"
          className="self-start"
          onClick={() => filaDeEnvios().limparProntos(workOrderId)}
        >
          Limpar enviados
        </Botao>
      ) : null}
    </div>
  );
}

function LinhaDeEnvio({ envio: e }: { envio: Envio }) {
  const pct = e.tamanho ? Math.floor((e.enviados / e.tamanho) * 100) : 0;
  const erro = e.estado === "erro";
  const pronto = e.estado === "pronto";
  return (
    <li className="flex flex-col gap-1.5 rounded-botao border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{e.nome}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{e.destino}</span>
      </div>
      {!erro ? (
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pronto ? 100 : pct}
          aria-label={`Envio de ${e.nome}`}
        >
          <div
            className={`h-full rounded-full transition-[width] ${pronto ? "bg-success" : "bg-primary"}`}
            style={{ width: `${pronto ? 100 : pct}%` }}
          />
        </div>
      ) : null}
      <p
        className={`flex items-center gap-1 text-xs ${erro ? "text-destructive" : "text-muted-foreground"}`}
      >
        {pronto ? <Check className="size-3.5 text-success" aria-hidden /> : null}
        {textoDoEnvio(e)}
      </p>
      {erro ? (
        <div className="flex flex-wrap gap-2">
          {validarMidia(e.nome, e.tipo, e.tamanho).ok ? (
            <Botao variante="contorno" onClick={() => filaDeEnvios().tentarDeNovo(e.id)}>
              <RotateCcw /> Tentar de novo
            </Botao>
          ) : null}
          <Botao variante="neutro" onClick={() => filaDeEnvios().remover(e.id)}>
            <X /> Tirar da lista
          </Botao>
        </div>
      ) : null}
    </li>
  );
}
