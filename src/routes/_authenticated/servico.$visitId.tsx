import { useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Camera,
  ChevronLeft,
  ExternalLink,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Navigation,
  Phone,
  Sparkles,
} from "lucide-react";
import { Botao, Card, Chip } from "@/components/nexa";
import { CompletionDialog, VisitDialog } from "@/components/visit-dialog";
import { supabase } from "@/integrations/supabase/client";
import { chipDoStatus } from "@/lib/agenda";
import { brl, dateBR, mapsLink, telLink, timeBR, wazeLink, whatsappLink } from "@/lib/format";
import { defDoTexto, preencherTexto } from "@/lib/modelos-mensagem";
import { VISIT_SELECT, type VisitRow } from "@/lib/os";
import { getOsMedia, uploadOsMedia } from "@/lib/os-media.functions";
import { extrasDoServicoFn } from "@/lib/servico.functions";
import { useContextoTenant } from "@/lib/tenant";

export const Route = createFileRoute("/_authenticated/servico/$visitId")({
  head: () => ({ meta: [{ title: "Serviço — Nexa OS" }] }),
  component: TelaServico,
});

type Midia = {
  id: string;
  destination: string;
  file_name: string;
  mime_type: string | null;
  google_file_url: string | null;
};

function TelaServico() {
  const { visitId } = Route.useParams();
  const qc = useQueryClient();
  const extrasFn = useServerFn(extrasDoServicoFn);
  const midiaFn = useServerFn(getOsMedia);
  const enviarFn = useServerFn(uploadOsMedia);
  const { data: tenant } = useContextoTenant();
  const [concluir, setConcluir] = useState(false);
  const [opcoes, setOpcoes] = useState(false);
  const [enviando, setEnviando] = useState<string | null>(null);
  const arquivoAntes = useRef<HTMLInputElement>(null);
  const arquivoDepois = useRef<HTMLInputElement>(null);

  const visita = useQuery({
    queryKey: ["servico", visitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visits")
        .select(VISIT_SELECT)
        .eq("id", visitId)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as VisitRow | null;
    },
  });
  const v = visita.data;
  const wo = v?.work_order ?? null;
  const extras = useQuery({
    queryKey: ["servico", visitId, "extras"],
    queryFn: () => extrasFn({ data: { visitId } }),
    enabled: Boolean(v),
  });
  const midia = useQuery({
    queryKey: ["servico", visitId, "midia"],
    queryFn: () => midiaFn({ data: { workOrderId: wo!.id } }) as Promise<Midia[]>,
    enabled: Boolean(wo?.id),
  });
  const textoACaminho = useQuery({
    queryKey: ["textos", "tecnico_a_caminho"],
    queryFn: async () => {
      const { data } = await supabase
        .from("mensagens_textos")
        .select("texto")
        .eq("chave", "tecnico_a_caminho")
        .maybeSingle();
      return data?.texto ?? null;
    },
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ["servico", visitId] });
    void qc.invalidateQueries({ queryKey: ["agenda"] });
  }

  async function enviarFotos(destino: "Antes" | "Depois", arquivos: FileList | null) {
    if (!wo?.id || !arquivos?.length) return;
    setEnviando(destino);
    let ok = 0;
    try {
      for (const f of Array.from(arquivos)) {
        const fd = new FormData();
        fd.append("workOrderId", wo.id);
        fd.append("destination", destino);
        fd.append("file", f);
        await enviarFn({ data: fd });
        ok++;
      }
      toast.success(`${ok} ${ok === 1 ? "foto enviada" : "fotos enviadas"} para a pasta da OS.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a foto.");
    } finally {
      setEnviando(null);
      void midia.refetch();
    }
  }

  if (visita.isLoading)
    return <p className="mx-auto max-w-3xl text-sm text-muted-foreground">Carregando…</p>;
  if (!v)
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Voltar />
        <Card className="text-center text-sm">
          {visita.error instanceof Error ? visita.error.message : "Atendimento não encontrado."}
        </Card>
      </div>
    );

  const cliente = wo?.customer;
  const endereco = cliente?.full_address ?? "";
  const chip = chipDoStatus(v.status);
  const concluido = v.status === "Concluído";
  const primeiroNome = (cliente?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
  const mensagem = preencherTexto(textoACaminho.data || defDoTexto("tecnico_a_caminho")!.padrao!, {
    cliente: primeiroNome,
    tecnico: (v.technician?.name ?? "técnico").split(/\s+/)[0],
    empresa: tenant?.ativa?.empresa.nome ?? "",
    hora: timeBR(v.scheduled_time),
  });
  const whats = whatsappLink(cliente?.phone, mensagem);
  const tel = telLink(cliente?.phone);
  const ex = extras.data;
  const total = Number(v.final_value ?? v.visit_value ?? 0);
  const antes = (midia.data ?? []).filter((m) => m.destination === "Antes");
  const depois = (midia.data ?? []).filter((m) => m.destination === "Depois");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <Voltar />

      {/* Topo: serviço, item, OS, horário, técnico e status. */}
      <header className="flex flex-col gap-1">
        <span className="text-sm text-muted-foreground">
          OS {wo?.os_number} · {dateBR(v.scheduled_date)} às {timeBR(v.scheduled_time)}
        </span>
        <h1 className="font-titulo text-[30px] leading-[1.15]">
          {v.service_type?.name ?? "Serviço"}
        </h1>
        {v.upholstery_description || v.upholstery_type?.name ? (
          <p className="text-[15px]">{v.upholstery_description || v.upholstery_type?.name}</p>
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Chip tom={chip.tom}>{chip.rotulo}</Chip>
          <span className="text-sm text-muted-foreground">
            {v.technician?.name ?? "Sem técnico"}
          </span>
        </div>
      </header>

      {/* Endereço com Maps e Waze. */}
      <Card>
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <MapPin className="size-5 text-marca" aria-hidden /> Endereço
        </h2>
        <p className="text-[15px]">{endereco || "Endereço não informado"}</p>
        {cliente?.reference_point ? (
          <p className="text-sm text-muted-foreground">Referência: {cliente.reference_point}</p>
        ) : null}
        <div className="grid grid-cols-2 gap-2">
          {mapsLink(endereco) ? (
            <Botao asChild variante="contorno">
              <a href={mapsLink(endereco)!} target="_blank" rel="noreferrer">
                <MapPin /> Maps
              </a>
            </Botao>
          ) : null}
          {wazeLink(endereco) ? (
            <Botao asChild variante="contorno">
              <a href={wazeLink(endereco)!} target="_blank" rel="noreferrer">
                <Navigation /> Waze
              </a>
            </Botao>
          ) : null}
        </div>
      </Card>

      {/* Cliente. */}
      <Card>
        <h2 className="text-[15px] font-bold">{cliente?.full_name ?? "Cliente"}</h2>
        {cliente?.phone ? <p className="text-sm text-muted-foreground">{cliente.phone}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {whats ? (
            <Botao asChild>
              <a href={whats} target="_blank" rel="noreferrer">
                <MessageCircle /> Avisar que estou indo
              </a>
            </Botao>
          ) : null}
          {tel ? (
            <Botao asChild variante="contorno">
              <a href={tel}>
                <Phone /> Ligar
              </a>
            </Botao>
          ) : null}
        </div>
      </Card>

      {/* Resumo da Alice. */}
      <Card>
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Sparkles className="size-5 text-marca" aria-hidden /> Resumo da Alice
        </h2>
        {extras.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : ex?.resumoAlice ? (
          <p className="whitespace-pre-line text-[15px] leading-relaxed">{ex.resumoAlice}</p>
        ) : (
          <p className="text-sm text-muted-foreground">Sem resumo da conversa para este cliente.</p>
        )}
        {v.visit_notes || wo?.general_notes ? (
          <div className="border-t border-border pt-3">
            <p className="text-xs font-bold text-muted-foreground">Observações da OS</p>
            <p className="whitespace-pre-line text-sm">
              {[v.visit_notes, wo?.general_notes].filter(Boolean).join("\n")}
            </p>
          </div>
        ) : null}
      </Card>

      {/* Valor. */}
      <Card>
        <h2 className="text-[15px] font-bold">Valor</h2>
        {ex?.itens.length ? (
          <ul className="flex flex-col gap-1.5">
            {ex.itens.map((i, n) => (
              <li key={n} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  {i.quantidade > 1 ? `${i.quantidade}× ` : ""}
                  {i.descricao}
                </span>
                <span className="shrink-0 tabular-nums">{brl(i.subtotal)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {ex?.desconto ? (
          <p className="flex justify-between gap-3 text-sm text-marca">
            <span>Desconto{ex.desconto.motivo ? ` (${ex.desconto.motivo})` : ""}</span>
            <span className="tabular-nums">− {brl(ex.desconto.valor)}</span>
          </p>
        ) : null}
        <p className="flex items-end justify-between gap-3 border-t border-border pt-2">
          <span className="text-sm font-bold">Total</span>
          <span className="font-titulo text-2xl tabular-nums">{brl(total)}</span>
        </p>
        {wo?.negotiated_payment_method ? (
          <p className="text-sm text-muted-foreground">
            Pagamento combinado: {wo.negotiated_payment_method}
            {wo.negotiated_installments && wo.negotiated_installments > 1
              ? ` em ${wo.negotiated_installments}x`
              : ""}
          </p>
        ) : null}
      </Card>

      {/* Fotos de antes e depois (pasta da OS no Google Drive). */}
      <Card>
        <h2 className="flex items-center gap-2 text-[15px] font-bold">
          <Camera className="size-5 text-marca" aria-hidden /> Fotos
        </h2>
        {(
          [
            ["Antes", antes, arquivoAntes],
            ["Depois", depois, arquivoDepois],
          ] as const
        ).map(([destino, lista, ref]) => (
          <div key={destino} className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                {destino} ({lista.length})
              </span>
              <Botao
                variante="contorno"
                disabled={Boolean(enviando) || !wo?.id}
                onClick={() => ref.current?.click()}
              >
                <Camera /> {enviando === destino ? "Enviando…" : `Foto de ${destino.toLowerCase()}`}
              </Botao>
              <input
                ref={ref}
                type="file"
                accept="image/*,video/*"
                capture="environment"
                multiple
                className="hidden"
                aria-label={`Foto de ${destino.toLowerCase()}`}
                onChange={(e) => {
                  void enviarFotos(destino, e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
            {lista.length ? (
              <ul className="flex flex-wrap gap-2">
                {lista.slice(0, 8).map((m) => (
                  <li key={m.id}>
                    <a
                      href={m.google_file_url ?? "#"}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-11 max-w-[11rem] items-center gap-1 truncate rounded-botao border border-border px-3 text-xs"
                    >
                      <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{m.file_name}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        <p className="text-xs text-muted-foreground">
          As fotos vão para a pasta da OS. Na conclusão também dá para enviar.
        </p>
      </Card>

      <Botao variante="neutro" className="self-start" onClick={() => setOpcoes(true)}>
        <MoreHorizontal /> Status, reagendar e mais
      </Botao>

      {/* Botão fixo embaixo: o mesmo fluxo de conclusão de sempre. */}
      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-20 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:mx-0 lg:rounded-card lg:border">
        <Botao tamanho="grande" larguraTotal disabled={concluido} onClick={() => setConcluir(true)}>
          {concluido ? "Serviço concluído" : "Concluir serviço"}
        </Botao>
      </div>

      {concluir ? (
        <CompletionDialog
          visit={v}
          open={concluir}
          onOpenChange={setConcluir}
          onDone={() => {
            setConcluir(false);
            recarregar();
          }}
        />
      ) : null}
      <VisitDialog
        visit={v}
        open={opcoes}
        onOpenChange={setOpcoes}
        onChanged={() => {
          setOpcoes(false);
          recarregar();
        }}
      />
    </div>
  );
}

function Voltar() {
  return (
    <Link
      to="/agenda"
      search={{ modo: "dia", tecnico: undefined, status: undefined, dia: undefined }}
      className="-ml-2 inline-flex min-h-11 w-fit items-center gap-1 rounded-botao px-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
    >
      <ChevronLeft className="size-5" aria-hidden /> Agenda
    </Link>
  );
}
