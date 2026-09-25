import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Copy, MapPin, Phone, PlusCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { IntegerInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { brl, dateBR, mapsLink, parseNumberBR, timeBR, todayISO, whatsappLink } from "@/lib/format";
import {
  PAYMENT_CHANNELS,
  PAYMENT_STATUSES,
  PAYMENT_TYPES,
  RESCHEDULE_REASONS,
  VISIT_STATUSES,
  findRate,
  useConfigOptions,
  usePaymentRates,
  useTechnicians,
} from "@/lib/data";
import {
  collectionSetupFromWorkOrder,
  completeVisit,
  createRecurrenceOrder,
  fetchCollectionVisits,
  recalcWorkOrder,
  rescheduleVisit,
  type PaymentPart,
  type VisitRow,
} from "@/lib/os";
import { collectionFields, type CollectionVisit } from "@/lib/collection";
import { useSession } from "@/lib/session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invalidateFinanceQueries } from "@/lib/cache";
import { useServerFn } from "@tanstack/react-start";
import { consolidarGastosDoTecnico } from "@/lib/routes.functions";
import {
  registrarConsumo,
  tipoProdutoDoServico,
  useControleInsumos,
  useProdutos,
} from "@/lib/produtos";
import { TECHNICIAN_EXPENSE_CATEGORIES, saveTechnicianExpense } from "@/lib/technician-expenses";
import { finishOsSharing, getOsMediaOptions, uploadOsMedia } from "@/lib/os-media.functions";

type MediaDestination = "Antes" | "Depois" | "Vídeos" | "Controle interno";

export function statusTone(status: string) {
  if (
    ["Concluído", "Concluída", "Pago", "Emitida", "Documento gerado", "Meta atingida"].includes(
      status,
    )
  )
    return "border-success/25 bg-success/12 text-success";
  if (
    [
      "Cancelado",
      "Cancelada",
      "Não pago",
      "Vencido",
      "Erro",
      "Erro no cálculo",
      "Falha na geração",
    ].includes(status)
  )
    return "border-destructive/25 bg-destructive/10 text-destructive";
  if (
    [
      "Reagendado",
      "Reagendada",
      "Reagendado com deslocamento",
      "Pendente",
      "Parcialmente pago",
      "Parcialmente concluída",
      "Aguardando custo por km",
      "Aguardando pagamento",
      "Documento desatualizado",
    ].includes(status)
  )
    return "border-warning/40 bg-warning/18 text-[color:var(--warning-foreground)]";
  if (
    ["Agendado", "Agendada", "Confirmado", "Em execução", "Em andamento", "Calculando"].includes(
      status,
    )
  )
    return "border-primary/25 bg-primary/12 text-primary";
  return "border-border bg-muted text-muted-foreground";
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={statusTone(status)}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {status}
    </Badge>
  );
}

async function copiar(text: string, msg = "Copiado!") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(msg);
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto manualmente.");
  }
}

export { copiar };

export function VisitDialog({
  visit,
  open,
  onOpenChange,
  onChanged,
}: {
  visit: VisitRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onChanged: () => void;
}) {
  const { user } = useSession();
  const { data: tecnicos } = useTechnicians();
  const { data: motivosReincidencia } = useConfigOptions("recurrence_reason");
  const [completar, setCompletar] = useState(false);
  const [reagendarAberto, setReagendarAberto] = useState(false);
  const [tipoReagendamento, setTipoReagendamento] = useState<
    "no_travel" | "with_travel" | "recurrence"
  >("no_travel");
  const [motivoReincidencia, setMotivoReincidencia] = useState("");
  const [motivoReagendamento, setMotivoReagendamento] = useState("");
  const [obsReagendamento, setObsReagendamento] = useState("");
  const [tecnicoReagendamento, setTecnicoReagendamento] = useState("");
  const [novaData, setNovaData] = useState("");
  const [novoHorario, setNovoHorario] = useState("");
  const [salvandoReagendamento, setSalvandoReagendamento] = useState(false);

  if (!visit) return null;
  const wo = visit.work_order;
  const cliente = wo?.customer;
  const endereco = cliente?.full_address ?? "";

  async function mudarStatus(status: string) {
    const { error } = await supabase.from("visits").update({ status }).eq("id", visit!.id);
    if (error) {
      toast.error("Não foi possível atualizar o status.");
      return;
    }
    if (wo) await recalcWorkOrder(wo.id, user?.id ?? null);
    toast.success(`Status atualizado para “${status}”.`);
    onChanged();
  }

  async function reagendar() {
    const v = visit!;
    if (!novaData || !novoHorario) {
      toast.error("Informe a nova data e o novo horário.");
      return;
    }
    if (tipoReagendamento === "with_travel" && !motivoReagendamento) {
      toast.error("Informe o motivo pelo qual o serviço não foi realizado.");
      return;
    }
    if (tipoReagendamento === "recurrence" && !motivoReincidencia) {
      toast.error("Informe o motivo da reincidência.");
      return;
    }
    if (!wo?.id) {
      toast.error("Não foi possível identificar a OS deste atendimento.");
      return;
    }
    setSalvandoReagendamento(true);
    try {
      if (tipoReagendamento === "recurrence") {
        const nova = await createRecurrenceOrder({
          visitId: v.id,
          workOrderId: wo.id,
          newDate: novaData,
          newTime: novoHorario,
          technicianId: tecnicoReagendamento || v.technician?.id || v.technician_id || null,
          reason: motivoReincidencia,
          notes: obsReagendamento.trim() || null,
          userId: user?.id ?? null,
        });
        toast.success(
          `Reincidência criada na OS ${nova.osNumber}, sem valor. Ajuste o valor na OS caso a causa seja do cliente.`,
        );
        setReagendarAberto(false);
        setMotivoReincidencia("");
        setObsReagendamento("");
        onChanged();
        return;
      }
      const result = await rescheduleVisit({
        visitId: v.id,
        workOrderId: wo.id,
        type: tipoReagendamento as "no_travel" | "with_travel",
        originalDate: v.scheduled_date,
        originalTechnicianId: v.technician?.id ?? v.technician_id ?? null,
        serviceTypeId: v.service_type?.id ?? v.service_type_id ?? null,
        newDate: novaData,
        newTime: novoHorario,
        technicianId: tecnicoReagendamento || v.technician?.id || v.technician_id || null,
        reason: motivoReagendamento || null,
        notes: obsReagendamento.trim() || null,
        userId: user?.id ?? null,
      });
      toast.success(
        result.newVisitId
          ? "Novo atendimento criado. O deslocamento do dia original foi preservado na rota."
          : "Visita reagendada. A agenda e a mensagem foram atualizadas.",
      );
      setReagendarAberto(false);
      setMotivoReagendamento("");
      setObsReagendamento("");
      onChanged();
    } catch {
      toast.error("Não foi possível reagendar este atendimento.");
    } finally {
      setSalvandoReagendamento(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              OS {wo?.os_number} — {cliente?.full_name}
            </DialogTitle>
            <DialogDescription>
              {dateBR(visit.scheduled_date)} às {timeBR(visit.scheduled_time)} ·{" "}
              {visit.service_type?.name ?? "Serviço"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={visit.status} />
              <Badge variant="outline">OS: {wo?.status}</Badge>
              <Badge variant="outline">
                Valor da visita: {brl(visit.final_value ?? visit.visit_value)}
              </Badge>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Info
                label="Estofado"
                value={visit.upholstery_description || visit.upholstery_type?.name}
              />
              <Info label="Técnico" value={visit.technician?.name} />
              <Info label="Vendedora" value={wo?.salesperson?.name} />
              <Info label="Origem da venda" value={wo?.sales_origin?.name} />
              <Info label="Telefone" value={cliente?.phone} />
              <Info label="CPF / CNPJ" value={cliente?.document_number} />
              <Info label="Valor total da OS" value={brl(wo?.total_gross_value)} />
              <Info label="Pagamento combinado" value={wo?.negotiated_payment_method} />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground">Endereço completo</p>
              <p>{endereco || "Endereço não informado"}</p>
              {cliente?.reference_point ? (
                <p className="text-muted-foreground">Referência: {cliente.reference_point}</p>
              ) : null}
            </div>

            {visit.visit_notes || wo?.general_notes ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground">Observações</p>
                <p className="whitespace-pre-line">
                  {[visit.visit_notes, wo?.general_notes].filter(Boolean).join("\n")}
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => copiar(endereco, "Endereço copiado!")}
              >
                <Copy className="mr-2 size-4" /> Copiar endereço
              </Button>
              {mapsLink(endereco) ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={mapsLink(endereco)!} target="_blank" rel="noreferrer">
                    <MapPin className="mr-2 size-4" /> Abrir rota
                  </a>
                </Button>
              ) : null}
              {cliente?.phone ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={`tel:${cliente.phone}`}>
                    <Phone className="mr-2 size-4" /> Ligar para o cliente
                  </a>
                </Button>
              ) : null}
              {whatsappLink(cliente?.phone) ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={whatsappLink(cliente?.phone)!} target="_blank" rel="noreferrer">
                    WhatsApp
                  </a>
                </Button>
              ) : null}
              {wo?.os_number ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={`/os/${encodeURIComponent(wo.os_number)}`}>Abrir OS e enviar fotos</a>
                </Button>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-4">
              <Select value={visit.status} onValueChange={mudarStatus}>
                <SelectTrigger className="w-[190px]">
                  <SelectValue placeholder="Status da visita" />
                </SelectTrigger>
                <SelectContent>
                  {VISIT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="secondary" onClick={() => mudarStatus("Em execução")}>
                Iniciar serviço
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setNovaData(visit.scheduled_date);
                  setNovoHorario(timeBR(visit.scheduled_time));
                  setReagendarAberto(true);
                }}
              >
                Reagendar
              </Button>
              <Button onClick={() => setCompletar(true)} disabled={visit.status === "Concluído"}>
                Concluir serviço
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={reagendarAberto} onOpenChange={setReagendarAberto}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Como este atendimento deve ser reagendado?</DialogTitle>
            <DialogDescription>
              Escolha a opção correta para que a rota e o custo de quilometragem fiquem certos.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            {[
              {
                value: "no_travel" as const,
                titulo: "Reagendar sem deslocamento",
                descricao: "O técnico ainda não se deslocou até o cliente.",
              },
              {
                value: "with_travel" as const,
                titulo: "Reagendar mantendo o deslocamento",
                descricao:
                  "O técnico foi até o endereço, mas o serviço precisará ser realizado em outro dia.",
              },
              {
                value: "recurrence" as const,
                titulo: "Reincidência (retorno ao cliente)",
                descricao:
                  "O serviço foi feito, mas o cliente precisa de um retorno. Cria uma nova OS vinculada, sem valor.",
              },
            ].map((op) => (
              <button
                key={op.value}
                type="button"
                onClick={() => setTipoReagendamento(op.value)}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${
                  tipoReagendamento === op.value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-accent"
                }`}
              >
                <p className="font-medium">{op.titulo}</p>
                <p className="text-sm text-muted-foreground">{op.descricao}</p>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="nova-data">Nova data</Label>
              <Input
                id="nova-data"
                type="date"
                value={novaData}
                onChange={(e) => setNovaData(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="novo-horario">Novo horário</Label>
              <Input
                id="novo-horario"
                type="time"
                value={novoHorario}
                onChange={(e) => setNovoHorario(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="tecnico-reagendamento">Técnico do novo atendimento</Label>
              <select
                id="tecnico-reagendamento"
                value={tecnicoReagendamento}
                onChange={(e) => setTecnicoReagendamento(e.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">Manter {visit.technician?.name ?? "sem técnico"}</option>
                {(tecnicos ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {tipoReagendamento === "with_travel" ? (
            <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
              <p className="text-sm">
                O atendimento de {dateBR(visit.scheduled_date)} continuará na rota do dia, com o
                custo de quilometragem preservado, e um novo atendimento será criado para a nova
                data.
              </p>
              <div className="space-y-2">
                <Label htmlFor="motivo-reagendamento">Motivo</Label>
                <select
                  id="motivo-reagendamento"
                  value={motivoReagendamento}
                  onChange={(e) => setMotivoReagendamento(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione o motivo</option>
                  {RESCHEDULE_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="obs-reagendamento">Observações operacionais</Label>
                <Textarea
                  id="obs-reagendamento"
                  value={obsReagendamento}
                  onChange={(e) => setObsReagendamento(e.target.value)}
                  placeholder="Ex.: cliente não estava no endereço, portaria não liberou o acesso"
                />
              </div>
            </div>
          ) : null}

          {tipoReagendamento === "recurrence" ? (
            <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm">
                Será criada uma nova OS de reincidência vinculada à OS {wo?.os_number}, com valor R$
                0,00 e os mesmos itens. Se o técnico constatar que a causa foi do cliente, o valor
                pode ser alterado na nova OS. O atendimento original continua concluído.
              </p>
              <div className="space-y-2">
                <Label htmlFor="motivo-reincidencia">Motivo da reincidência</Label>
                <select
                  id="motivo-reincidencia"
                  value={motivoReincidencia}
                  onChange={(e) => setMotivoReincidencia(e.target.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">Selecione o motivo</option>
                  {(motivosReincidencia ?? []).map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="obs-reincidencia">Explique o motivo da reincidência</Label>
                <Textarea
                  id="obs-reincidencia"
                  value={obsReagendamento}
                  onChange={(e) => setObsReagendamento(e.target.value)}
                  placeholder="Ex.: mancha voltou a aparecer no assento após a secagem"
                />
              </div>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReagendarAberto(false)}>
              Cancelar
            </Button>
            <Button onClick={reagendar} disabled={salvandoReagendamento}>
              {salvandoReagendamento ? "Salvando..." : "Salvar novo agendamento"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CompletionDialog
        visit={visit}
        open={completar}
        onOpenChange={setCompletar}
        onDone={() => {
          setCompletar(false);
          onOpenChange(false);
          onChanged();
        }}
      />
    </>
  );
}

function Info({ label, value }: { label: string; value?: string | null | undefined }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p>{value || "—"}</p>
    </div>
  );
}

type ParteState = {
  payment_channel: string;
  payment_type: string;
  installments: number;
  gross_amount: string;
  payment_date: string;
};

export function CompletionDialog({
  visit,
  open,
  onOpenChange,
  onDone,
}: {
  visit: VisitRow;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const { data: rates } = usePaymentRates();
  const valorPrevisto = Number(visit.final_value ?? visit.visit_value ?? 0);
  const consolidar = useServerFn(consolidarGastosDoTecnico);
  const enviarMidia = useServerFn(uploadOsMedia);
  const encerrarPasta = useServerFn(finishOsSharing);
  const buscarOpcoesMidia = useServerFn(getOsMediaOptions);

  /** Etapa 2: fotos e vídeos enviados direto pelo técnico. */
  const [destinoMidia, setDestinoMidia] = useState<MediaDestination>("Antes");
  const [arquivosMidia, setArquivosMidia] = useState<File[]>([]);
  const [avisosVideo, setAvisosVideo] = useState<string[]>([]);

  const { ativo: controleInsumos } = useControleInsumos();
  const tipoProduto = tipoProdutoDoServico(visit.service_type?.name);
  const { data: produtos } = useProdutos(tipoProduto, true);
  const usaProdutos = controleInsumos && Boolean(tipoProduto);

  const [etapa, setEtapa] = useState(1);
  /** Etapa 1: quantidade informada por produto (ml para higienização, litros para impermeabilização). */
  const [quantidades, setQuantidades] = useState<Record<string, string>>({});
  /** Etapa 2: gastos do técnico neste atendimento. */
  const [gastos, setGastos] = useState<Record<string, string>>({});

  const [integral, setIntegral] = useState(true);
  const [valorFinal, setValorFinal] = useState(String(valorPrevisto).replace(".", ","));
  const [motivo, setMotivo] = useState("");
  const [clientePagou, setClientePagou] = useState(true);
  const [statusPagamento, setStatusPagamento] = useState<string>("Pago");
  const [dataConclusao, setDataConclusao] = useState(todayISO());
  const [horaConclusao, setHoraConclusao] = useState(timeBR(visit.scheduled_time));
  const [precisaNota, setPrecisaNota] = useState(false);
  const [notaEmitida, setNotaEmitida] = useState(false);
  const [numeroNota, setNumeroNota] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [partes, setPartes] = useState<ParteState[]>([
    {
      payment_channel: "Pix direto",
      payment_type: "Pix",
      installments: 1,
      gross_amount: String(valorPrevisto).replace(".", ","),
      payment_date: todayISO(),
    },
  ]);

  const workOrderId = visit.work_order?.id ?? visit.work_order_id ?? "";

  /** Destinos de mídia válidos para esta OS (Antes/Depois só com higienização, Vídeos com impermeabilização). */
  const midiaOpcoesQuery = useQuery({
    queryKey: ["os_midia_opcoes", workOrderId],
    enabled: open && Boolean(workOrderId),
    queryFn: () => buscarOpcoesMidia({ data: { workOrderId } }),
  });
  const destinos: MediaDestination[] = (midiaOpcoesQuery.data?.destinations ?? [
    "Antes",
    "Depois",
    "Vídeos",
    "Controle interno",
  ]) as MediaDestination[];
  const emailCliente = midiaOpcoesQuery.data?.customerEmail ?? null;

  useEffect(() => {
    if (destinos.length && !destinos.includes(destinoMidia)) setDestinoMidia(destinos[0]!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [midiaOpcoesQuery.data]);

  async function selecionarMidias(files: FileList | null) {
    const selected = Array.from(files ?? []);
    setArquivosMidia(selected);
    const longos: string[] = [];
    await Promise.all(
      selected
        .filter((file) => file.type.startsWith("video/"))
        .map(
          (file) =>
            new Promise<void>((resolve) => {
              const video = document.createElement("video");
              const url = URL.createObjectURL(file);
              video.preload = "metadata";
              video.onloadedmetadata = () => {
                if (video.duration > 60) longos.push(file.name);
                URL.revokeObjectURL(url);
                resolve();
              };
              video.onerror = () => {
                URL.revokeObjectURL(url);
                resolve();
              };
              video.src = url;
            }),
        ),
    );
    setAvisosVideo(longos);
  }

  const etapas = usaProdutos
    ? ["Produtos utilizados", "Gastos e fotos", "Pagamento"]
    : ["Gastos e fotos", "Pagamento"];
  const primeiraEtapa = usaProdutos ? 1 : 2;
  const indiceEtapa = usaProdutos ? etapa : etapa - 1;

  useEffect(() => {
    if (open) setEtapa(usaProdutos ? 1 : 2);
  }, [open, usaProdutos]);

  /** Consumo informado, já convertido para ml. */
  const consumos = Object.entries(quantidades)
    .map(([produtoId, valor]) => {
      const informado = parseNumberBR(valor);
      const fator = tipoProduto === "impermeabilizacao" ? 1000 : 1;
      const produto = (produtos ?? []).find((p) => p.id === produtoId);
      const ml = informado * fator;
      return {
        produtoId,
        ml,
        custo: ml * Number(produto?.custo_por_ml ?? 0),
        nome: produto?.nome ?? "",
      };
    })
    .filter((c) => c.ml > 0);
  const custoProdutos = consumos.reduce((s, c) => s + c.custo, 0);

  const gastosSelecionados = TECHNICIAN_EXPENSE_CATEGORIES.filter((c) => c in gastos);
  const totalGastos = gastosSelecionados.reduce((s, c) => s + parseNumberBR(gastos[c] ?? "0"), 0);

  /** Visitas irmãs da OS: definem se a cobrança acontece neste atendimento. */
  const irmasQuery = useQuery({
    queryKey: ["cobranca_os", workOrderId],
    enabled: open && Boolean(workOrderId),
    queryFn: async () => (await fetchCollectionVisits([workOrderId])).get(workOrderId) ?? [],
  });

  const setupCobranca = collectionSetupFromWorkOrder(visit.work_order);
  const irmas: CollectionVisit[] = irmasQuery.data?.length
    ? irmasQuery.data
    : [
        {
          id: visit.id,
          scheduled_date: visit.scheduled_date,
          scheduled_time: visit.scheduled_time,
          status: visit.status,
          service_name: visit.service_type?.name ?? null,
          amount: valorPrevisto,
        },
      ];
  const cobranca = collectionFields(visit.id, irmas, setupCobranca);
  const totalOs = Number(setupCobranca.negotiatedTotal ?? 0);
  const maisDeUmaVisita = irmas.filter((v) => v.status !== "Cancelado").length > 1;
  /** Última visita da OS combinada: recebe o valor total, não só o valor deste serviço. */
  const cobrarTotal =
    cobranca.isCollectionVisit && maisDeUmaVisita && totalOs > valorPrevisto + 0.01;
  /** Visita sem cobrança prevista (ex.: higienização de uma OS que cobra na impermeabilização). */
  const semCobranca = !cobranca.valorACobrar && maisDeUmaVisita;

  useEffect(() => {
    if (!open || !irmasQuery.data) return;
    if (semCobranca) {
      setClientePagou(false);
      setStatusPagamento("Não pago");
      return;
    }
    if (cobrarTotal) {
      setPartes((prev) =>
        prev.length === 1
          ? [{ ...prev[0]!, gross_amount: String(totalOs).replace(".", ",") }]
          : prev,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, irmasQuery.data, semCobranca, cobrarTotal, totalOs]);

  const valorFinalNum = parseNumberBR(valorFinal);
  const alterou = Math.abs(valorFinalNum - valorPrevisto) > 0.001;
  /** Limite do que pode ser recebido neste atendimento. */
  const limiteRecebimento = cobranca.isCollectionVisit
    ? Math.max(valorFinalNum, totalOs)
    : valorFinalNum;

  const partesCalculadas = useMemo(
    () =>
      partes.map((p) => {
        const bruto = parseNumberBR(p.gross_amount);
        const taxa = findRate(rates, p.payment_channel, p.payment_type, p.installments);
        const fee = Math.round(((bruto * taxa) / 100) * 100) / 100;
        return { ...p, bruto, taxa, fee, liquido: Math.round((bruto - fee) * 100) / 100 };
      }),
    [partes, rates],
  );

  const somaPartes = partesCalculadas.reduce((s, p) => s + p.bruto, 0);
  const somaTaxas = partesCalculadas.reduce((s, p) => s + p.fee, 0);
  const somaLiquida = partesCalculadas.reduce((s, p) => s + p.liquido, 0);

  function atualizarParte(i: number, patch: Partial<ParteState>) {
    setPartes((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  async function salvar() {
    if (valorFinalNum < 0) {
      toast.error("O valor final não pode ser negativo.");
      return;
    }
    if (alterou && motivo.trim().length < 3) {
      toast.error("Informe o motivo da alteração do valor.");
      return;
    }
    if (!statusPagamento) {
      toast.error("Informe o status do pagamento.");
      return;
    }
    if (clientePagou && somaPartes <= 0) {
      toast.error("Informe pelo menos um valor recebido.");
      return;
    }
    if (clientePagou && somaPartes - limiteRecebimento > 0.01) {
      toast.error(
        cobranca.isCollectionVisit
          ? `A soma dos pagamentos ultrapassa o valor total da OS (${brl(limiteRecebimento)}).`
          : "A soma dos pagamentos ultrapassa o valor final do serviço. Ajuste os valores ou o valor final.",
      );
      return;
    }
    for (const p of partesCalculadas) {
      if (p.payment_type === "Crédito" && (!p.installments || p.installments < 1)) {
        toast.error("Informe o número de parcelas para pagamentos no crédito.");
        return;
      }
    }
    if (precisaNota && notaEmitida && !numeroNota.trim()) {
      toast.error("Informe o número da nota fiscal emitida.");
      return;
    }

    const payments: PaymentPart[] = clientePagou
      ? partesCalculadas
          .filter((p) => p.bruto > 0)
          .map((p) => ({
            payment_channel: p.payment_channel,
            payment_type: p.payment_type,
            installments: p.installments,
            gross_amount: p.bruto,
            applied_rate: p.taxa,
            payment_date: p.payment_date,
          }))
      : [];

    setSalvando(true);
    try {
      await completeVisit({
        visitId: visit.id,
        workOrderId: visit.work_order!.id,
        finalValue: valorFinalNum,
        changeReason: alterou ? motivo.trim() : null,
        completionDate: dataConclusao,
        completionTime: horaConclusao,
        finalNotes: observacoes.trim() || null,
        paymentStatus: statusPagamento,
        payments,
        invoiceNeeded: precisaNota,
        invoiceIssued: notaEmitida,
        invoiceNumber: numeroNota.trim() || null,
        userId: user?.id ?? null,
      });

      /** Consumo de produtos: custo congelado e baixa de estoque. */
      if (usaProdutos && consumos.length) {
        try {
          for (const c of consumos) {
            await registrarConsumo({
              workOrderId,
              visitId: visit.id,
              produtoId: c.produtoId,
              quantidadeMl: c.ml,
            });
          }
        } catch {
          toast.error("O serviço foi concluído, mas não foi possível gravar os produtos usados.");
        }
      }

      /** Gastos do técnico: um lançamento por atendimento, somado no acumulado do mês. */
      const tecnicoId = visit.technician?.id ?? visit.technician_id ?? null;
      if (totalGastos > 0 && tecnicoId) {
        try {
          await saveTechnicianExpense({
            technicianId: tecnicoId,
            date: dataConclusao,
            categories: [...gastosSelecionados],
            amount: totalGastos,
            workOrderId,
            notes: `Lançado na conclusão da OS ${visit.work_order?.os_number ?? ""}`.trim(),
          });
          await consolidar({
            data: { month: dataConclusao.slice(0, 7), technicianId: tecnicoId },
          });
        } catch {
          toast.error("O serviço foi concluído, mas não foi possível gravar os gastos do técnico.");
        }
      } else if (totalGastos > 0) {
        toast.error("Informe o técnico do atendimento para lançar os gastos.");
      }

      /** Fotos e vídeos deste atendimento: um arquivo com erro não impede os demais. */
      let enviados = 0;
      const falhas: string[] = [];
      for (const file of arquivosMidia) {
        try {
          const form = new FormData();
          form.set("workOrderId", workOrderId);
          form.set("destination", destinoMidia);
          form.set("file", file);
          await enviarMidia({ data: form });
          enviados += 1;
        } catch {
          falhas.push(file.name);
        }
      }
      if (enviados) toast.success(`${enviados} arquivo(s) enviado(s) para ${destinoMidia}.`);
      if (falhas.length) toast.error(`Não foi possível enviar: ${falhas.join(", ")}.`);
      setArquivosMidia([]);
      setAvisosVideo([]);

      /** Documentos automáticos e compartilhamento da pasta com o e-mail do cliente. */
      try {
        const fim = await encerrarPasta({ data: { workOrderId } });
        if (fim.share.shared && !("alreadyShared" in fim.share && fim.share.alreadyShared)) {
          toast.success(`Pasta compartilhada com ${fim.share.email}.`);
        } else if (!fim.share.shared && fim.share.reason === "sem_email") {
          toast.message("Cadastre o e-mail do cliente para compartilhar a pasta automaticamente.");
        }
      } catch {
        toast.error("Serviço concluído, mas a pasta do cliente não pôde ser preparada.");
      }

      invalidateFinanceQueries(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["os_produtos_utilizados"] });
      void queryClient.invalidateQueries({ queryKey: ["technician_expenses"] });
      void queryClient.invalidateQueries({ queryKey: ["os_midias"] });
      void queryClient.invalidateQueries({ queryKey: ["os_documento"] });
      void queryClient.invalidateQueries({ queryKey: ["os_termo_garantia"] });
      toast.success("Serviço concluído! Pagamentos, taxas e comissão foram calculados.");
      onDone();
    } catch {
      toast.error("Não foi possível concluir o serviço. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Concluir serviço — OS {visit.work_order?.os_number}</DialogTitle>
          <DialogDescription>
            Etapa {indiceEtapa} de {etapas.length} — {etapas[indiceEtapa - 1]}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1.5">
          {etapas.map((nome, i) => (
            <span
              key={nome}
              className={`h-1.5 flex-1 rounded-full ${i < indiceEtapa ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        {etapa === 1 && usaProdutos ? (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              {tipoProduto === "impermeabilizacao"
                ? "Informe quantos litros de impermeabilizante foram usados."
                : "Marque os produtos usados e informe a quantidade em ml de cada um."}
            </p>
            {(produtos ?? []).length === 0 ? (
              <p className="rounded-lg border border-warning/40 bg-warning/10 p-3">
                Nenhum produto ativo cadastrado para este tipo de serviço. Cadastre em Configurações
                &gt; Produtos ou siga para a próxima etapa.
              </p>
            ) : null}
            {(produtos ?? []).map((p) => (
              <div
                key={p.id}
                className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_150px] sm:items-end"
              >
                <div>
                  <p className="font-medium">{p.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    Custo por litro: {brl(Number(p.custo_por_ml ?? 0) * 1000)}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`qtd-${p.id}`}>
                    {tipoProduto === "impermeabilizacao" ? "Litros usados" : "Quantidade (ml)"}
                  </Label>
                  <Input
                    id={`qtd-${p.id}`}
                    inputMode="decimal"
                    value={quantidades[p.id] ?? ""}
                    onChange={(e) =>
                      setQuantidades((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    placeholder="0"
                  />
                </div>
              </div>
            ))}
            {custoProdutos > 0 ? (
              <p className="rounded-lg bg-secondary p-3">
                Custo dos produtos deste serviço: <strong>{brl(custoProdutos)}</strong>
              </p>
            ) : null}
          </div>
        ) : null}

        {etapa === 2 ? (
          <div className="space-y-4 text-sm">
            <p className="font-medium">Você teve algum gasto neste serviço?</p>
            <p className="text-muted-foreground">
              Marque o que teve. Estes valores entram no seu reembolso do fim do mês.
            </p>
            {TECHNICIAN_EXPENSE_CATEGORIES.map((cat) => {
              const marcado = cat in gastos;
              return (
                <div key={cat} className="space-y-2 rounded-lg border border-border p-3">
                  <label className="flex items-center gap-3 font-medium">
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={marcado}
                      onChange={(e) =>
                        setGastos((prev) => {
                          const next = { ...prev };
                          if (e.target.checked) next[cat] = "";
                          else delete next[cat];
                          return next;
                        })
                      }
                    />
                    {cat}
                  </label>
                  {marcado ? (
                    <div className="space-y-2">
                      <Label htmlFor={`gasto-${cat}`}>Valor (R$)</Label>
                      <Input
                        id={`gasto-${cat}`}
                        inputMode="decimal"
                        value={gastos[cat] ?? ""}
                        onChange={(e) => setGastos((prev) => ({ ...prev, [cat]: e.target.value }))}
                        placeholder="0,00"
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {totalGastos > 0 ? (
              <p className="rounded-lg bg-secondary p-3">
                Total de gastos deste serviço: <strong>{brl(totalGastos)}</strong>
              </p>
            ) : null}

            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="font-medium">Fotos e vídeos do serviço</p>
              <p className="text-muted-foreground">
                Envie agora as fotos e vídeos. Eles vão para a pasta do cliente e são compartilhados
                assim que o serviço for concluído.
              </p>

              <div className="space-y-2">
                <Label htmlFor="destino-midia-conclusao">Onde salvar</Label>
                <select
                  id="destino-midia-conclusao"
                  value={destinoMidia}
                  onChange={(e) => setDestinoMidia(e.target.value as MediaDestination)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {destinos.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                {destinoMidia === "Controle interno" ? (
                  <p className="text-warning">Não vai aparecer para o cliente.</p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="arquivos-midia-conclusao">Selecionar arquivos</Label>
                <Input
                  id="arquivos-midia-conclusao"
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => void selecionarMidias(e.target.files)}
                />
                {arquivosMidia.length ? (
                  <p className="text-muted-foreground">
                    {arquivosMidia.length} arquivo(s) selecionado(s). O envio acontece ao concluir o
                    serviço.
                  </p>
                ) : null}
                {avisosVideo.length ? (
                  <p className="text-warning">
                    {avisosVideo.length} vídeo(s) têm mais de 60 segundos. O envio continua
                    permitido.
                  </p>
                ) : null}
                {emailCliente ? (
                  <p className="text-muted-foreground">
                    A pasta será compartilhada com {emailCliente}.
                  </p>
                ) : (
                  <p className="text-warning">
                    Sem e-mail no cadastro do cliente: use o link da pasta na tela da OS.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <div className={`space-y-5 text-sm ${etapa === 3 ? "" : "hidden"}`}>
          {semCobranca ? (
            <p className="rounded-lg border border-border bg-muted/40 p-3">
              Sem cobrança neste atendimento.{" "}
              {cobranca.dataVisitaCobranca
                ? `O pagamento está previsto para ${cobranca.dataVisitaCobranca}${
                    cobranca.servicoVisitaCobranca ? ` (${cobranca.servicoVisitaCobranca})` : ""
                  }.`
                : "A cobrança acontece em outro atendimento desta OS."}
            </p>
          ) : null}
          {cobrarTotal ? (
            <p className="rounded-lg border border-primary/25 bg-primary/10 p-3 text-primary">
              Atendimento de cobrança: receber o valor total da OS ({brl(totalOs)}).
            </p>
          ) : null}

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="font-medium">Serviço realizado integralmente?</p>
              <p className="text-xs text-muted-foreground">
                Desmarque se apenas parte do serviço foi executada.
              </p>
            </div>
            <Switch checked={integral} onCheckedChange={setIntegral} />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="valor-final">Valor final do serviço</Label>
              <Input
                id="valor-final"
                inputMode="decimal"
                value={valorFinal}
                onChange={(e) => setValorFinal(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="data-conclusao">Data da conclusão</Label>
              <Input
                id="data-conclusao"
                type="date"
                value={dataConclusao}
                onChange={(e) => setDataConclusao(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hora-conclusao">Horário da conclusão</Label>
              <Input
                id="hora-conclusao"
                type="time"
                value={horaConclusao}
                onChange={(e) => setHoraConclusao(e.target.value)}
              />
            </div>
          </div>

          {alterou ? (
            <div className="space-y-2">
              <Label htmlFor="motivo">Motivo da alteração do valor</Label>
              <Input
                id="motivo"
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Ex.: cliente incluiu uma poltrona"
              />
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <p className="font-medium">Cliente pagou?</p>
              <Switch
                checked={clientePagou}
                onCheckedChange={(v) => {
                  setClientePagou(v);
                  setStatusPagamento(v ? "Pago" : "Não pago");
                }}
              />
            </div>
            <div className="space-y-2">
              <Label>Status do pagamento</Label>
              <Select value={statusPagamento} onValueChange={setStatusPagamento}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {clientePagou ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-medium">Pagamentos recebidos</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setPartes((prev) => [
                      ...prev,
                      {
                        payment_channel: "Maquininha",
                        payment_type: "Crédito",
                        installments: 1,
                        gross_amount: "0,00",
                        payment_date: todayISO(),
                      },
                    ])
                  }
                >
                  <PlusCircle className="mr-2 size-4" /> Adicionar pagamento
                </Button>
              </div>

              {partesCalculadas.map((p, i) => (
                <div key={i} className="space-y-3 rounded-lg border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Canal de pagamento</Label>
                      <Select
                        value={p.payment_channel}
                        onValueChange={(v) => atualizarParte(i, { payment_channel: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_CHANNELS.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Forma de pagamento real</Label>
                      <Select
                        value={p.payment_type}
                        onValueChange={(v) => atualizarParte(i, { payment_type: v })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_TYPES.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Número de parcelas</Label>
                      <IntegerInput
                        min={1}
                        max={12}
                        value={p.installments}
                        onValueChange={(v) => atualizarParte(i, { installments: Math.max(1, v) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Valor recebido</Label>
                      <Input
                        inputMode="decimal"
                        value={p.gross_amount}
                        onChange={(e) => atualizarParte(i, { gross_amount: e.target.value })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Data do pagamento</Label>
                      <Input
                        type="date"
                        value={p.payment_date}
                        onChange={(e) => atualizarParte(i, { payment_date: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1 self-end text-xs text-muted-foreground">
                      <p>
                        Taxa aplicada: <strong>{p.taxa.toFixed(2).replace(".", ",")}%</strong>
                      </p>
                      <p>
                        Taxa: {brl(p.fee)} · Líquido: {brl(p.liquido)}
                      </p>
                    </div>
                  </div>
                  {partes.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setPartes((prev) => prev.filter((_, idx) => idx !== i))}
                    >
                      <Trash2 className="mr-2 size-4" /> Remover pagamento
                    </Button>
                  ) : null}
                </div>
              ))}

              <div className="rounded-lg bg-secondary p-3 text-sm">
                <p>
                  Total recebido: <strong>{brl(somaPartes)}</strong> · Taxas: {brl(somaTaxas)} ·
                  Líquido: <strong>{brl(somaLiquida)}</strong>
                </p>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <p className="font-medium">Precisa emitir nota fiscal?</p>
              <Switch checked={precisaNota} onCheckedChange={setPrecisaNota} />
            </div>
            {precisaNota ? (
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <p className="font-medium">Nota já foi emitida?</p>
                <Switch checked={notaEmitida} onCheckedChange={setNotaEmitida} />
              </div>
            ) : null}
          </div>

          {precisaNota && notaEmitida ? (
            <div className="space-y-2">
              <Label htmlFor="numero-nota">Número da nota fiscal</Label>
              <Input
                id="numero-nota"
                value={numeroNota}
                onChange={(e) => setNumeroNota(e.target.value)}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="obs-finais">Observações finais</Label>
            <Textarea
              id="obs-finais"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder={integral ? "" : "Descreva o que ficou pendente"}
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {etapa > primeiraEtapa ? (
            <Button variant="outline" onClick={() => setEtapa((e) => e - 1)}>
              Voltar
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          )}
          {etapa < 3 ? (
            <Button onClick={() => setEtapa((e) => e + 1)}>Continuar</Button>
          ) : (
            <Button onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Concluir serviço"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
