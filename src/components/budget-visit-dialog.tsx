import { useEffect, useMemo, useState, type SelectHTMLAttributes } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { MapPin, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/visit-dialog";
import { useConfigOptions, useTechnicians } from "@/lib/data";
import { upsertCustomer } from "@/lib/os";
import { useSession } from "@/lib/session";
import { invalidateFinanceQueries } from "@/lib/cache";
import {
  BUDGET_VISIT_RESULTS,
  BUDGET_VISIT_STATUSES,
  completeBudgetVisit,
  createBudgetVisit,
  deleteBudgetVisit,
  searchCustomers,
  setBudgetVisitStatus,
  updateBudgetVisit,
  type BudgetVisitRow,
} from "@/lib/budget-visits";
import {
  brl,
  buildFullAddress,
  dateBR,
  mapsLink,
  onlyDigits,
  parseNumberBR,
  timeBR,
  todayISO,
  whatsappLink,
} from "@/lib/format";

function NativeSelect({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}

type Cliente = { id: string; full_name: string; phone: string; full_address: string | null };

/** Criação e gestão de visitas de orçamento (sem OS). */
export function BudgetVisitDialog({
  open,
  onOpenChange,
  visit,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  visit: BudgetVisitRow | null;
  onChanged: () => void;
}) {
  const { user } = useSession();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: tecnicos } = useTechnicians();
  const { data: origens } = useConfigOptions("sales_origin");
  const isEdit = !!visit;

  const [salvando, setSalvando] = useState(false);
  const [data, setData] = useState(todayISO());
  const [hora, setHora] = useState("09:00");
  const [tecnicoId, setTecnicoId] = useState("");
  const [origemId, setOrigemId] = useState("");
  const [descricao, setDescricao] = useState("");
  const [obs, setObs] = useState("");
  const [taxa, setTaxa] = useState("0,00");

  // seleção / cadastro de cliente
  const [clienteId, setClienteId] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [novoCliente, setNovoCliente] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [cep, setCep] = useState("");
  const [rua, setRua] = useState("");
  const [numero, setNumero] = useState("");
  const [complemento, setComplemento] = useState("");
  const [bairro, setBairro] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");

  // conclusão
  const [concluir, setConcluir] = useState(false);
  const [resultado, setResultado] = useState<string>(BUDGET_VISIT_RESULTS[0]);
  const [resultadoObs, setResultadoObs] = useState("");

  useEffect(() => {
    if (!open) return;
    setConcluir(false);
    setResultado(visit?.result || BUDGET_VISIT_RESULTS[0]);
    setResultadoObs(visit?.result_notes ?? "");
    setNovoCliente(false);
    setBusca("");
    setResultados([]);
    if (visit) {
      setData(visit.scheduled_date);
      setHora(visit.scheduled_time.slice(0, 5));
      setTecnicoId(visit.technician_id ?? "");
      setOrigemId(visit.sales_origin_id ?? "");
      setDescricao(visit.upholstery_description ?? "");
      setObs(visit.notes ?? "");
      setTaxa(
        Number(visit.visit_fee ?? 0)
          .toFixed(2)
          .replace(".", ","),
      );
      setClienteId(visit.customer_id);
      return;
    }
    setData(todayISO());
    setHora("09:00");
    setTecnicoId("");
    setOrigemId("");
    setDescricao("");
    setObs("");
    setTaxa("0,00");
    setClienteId(null);
    setNome("");
    setTelefone("");
    setCep("");
    setRua("");
    setNumero("");
    setComplemento("");
    setBairro("");
    setCidade("");
    setUf("");
  }, [open, visit]);

  const clienteSelecionado = useMemo(
    () => resultados.find((c) => c.id === clienteId) ?? null,
    [resultados, clienteId],
  );

  async function buscarClientes() {
    try {
      const rows = await searchCustomers(busca);
      setResultados(rows);
      if (!rows.length) toast.info("Nenhum cliente encontrado. Você pode cadastrar na hora.");
    } catch {
      toast.error("Não foi possível buscar clientes agora.");
    }
  }

  async function buscarCep() {
    const digits = onlyDigits(cep);
    if (digits.length !== 8) {
      toast.error("Informe um CEP com 8 dígitos.");
      return;
    }
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const json = (await res.json()) as {
        erro?: boolean;
        logradouro?: string;
        bairro?: string;
        localidade?: string;
        uf?: string;
      };
      if (json.erro) {
        toast.error("CEP não encontrado. Preencha o endereço manualmente.");
        return;
      }
      setRua(json.logradouro ?? "");
      setBairro(json.bairro ?? "");
      setCidade(json.localidade ?? "");
      setUf(json.uf ?? "");
    } catch {
      toast.error("Não foi possível consultar o CEP agora.");
    }
  }

  function atualizar() {
    void qc.invalidateQueries({ queryKey: ["agenda"] });
    void qc.invalidateQueries({ queryKey: ["orcamentos"] });
    invalidateFinanceQueries(qc);
    onChanged();
  }

  async function salvar() {
    if (!data || !hora) {
      toast.error("Informe a data e o horário da visita.");
      return;
    }
    setSalvando(true);
    try {
      let customerId = clienteId;
      if (!isEdit && novoCliente) {
        if (nome.trim().length < 3 || onlyDigits(telefone).length < 10) {
          toast.error("Informe nome completo e telefone do cliente.");
          return;
        }
        if (!rua.trim() || !numero.trim() || !cidade.trim() || !uf.trim()) {
          toast.error("Preencha o endereço do cliente para o cálculo do deslocamento.");
          return;
        }
        customerId = await upsertCustomer({
          full_name: nome.trim(),
          phone: onlyDigits(telefone),
          street: rua.trim(),
          street_number: numero.trim(),
          complement: complemento.trim() || null,
          neighborhood: bairro.trim() || null,
          city: cidade.trim(),
          state: uf.trim().toUpperCase(),
          postal_code: onlyDigits(cep) || null,
        });
      }
      if (!customerId) {
        toast.error("Selecione um cliente ou cadastre um novo.");
        return;
      }

      const payload = {
        customer_id: customerId,
        technician_id: tecnicoId || null,
        sales_origin_id: origemId || null,
        scheduled_date: data,
        scheduled_time: hora,
        upholstery_description: descricao.trim() || null,
        notes: obs.trim() || null,
        visit_fee: parseNumberBR(taxa),
      };

      if (isEdit && visit) {
        await updateBudgetVisit(visit.id, payload);
        toast.success("Visita de orçamento atualizada.");
      } else {
        await createBudgetVisit(payload, user?.id ?? null);
        toast.success("Visita de orçamento agendada.");
      }
      atualizar();
      onOpenChange(false);
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Não foi possível salvar a visita de orçamento.",
      );
    } finally {
      setSalvando(false);
    }
  }

  async function mudarStatus(status: string) {
    if (!visit) return;
    try {
      await setBudgetVisitStatus(visit.id, status);
      toast.success(`Status atualizado para “${status}”.`);
      atualizar();
    } catch {
      toast.error("Não foi possível atualizar o status.");
    }
  }

  async function confirmarConclusao() {
    if (!visit) return;
    setSalvando(true);
    try {
      await completeBudgetVisit({
        id: visit.id,
        result: resultado,
        resultNotes: resultadoObs.trim() || null,
      });
      toast.success("Visita de orçamento concluída.");
      setConcluir(false);
      atualizar();
    } catch {
      toast.error("Não foi possível concluir a visita.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!visit) return;
    if (!confirm("Excluir esta visita de orçamento? A rota do dia poderá ser recalculada.")) return;
    try {
      await deleteBudgetVisit(visit.id);
      toast.success("Visita de orçamento excluída.");
      atualizar();
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível excluir a visita.");
    }
  }

  function gerarOS() {
    if (!visit) return;
    onOpenChange(false);
    void navigate({ to: "/nova-os", search: { orcamento: visit.id } });
  }

  const cliente = visit?.customer;
  const endereco = cliente?.full_address ?? "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? `Visita de orçamento — ${cliente?.full_name ?? ""}`
              : "Nova visita de orçamento"}
          </DialogTitle>
          <DialogDescription>
            Visita técnica para orçamento, sem abrir OS. O deslocamento entra na rota do técnico.
          </DialogDescription>
        </DialogHeader>

        {isEdit && visit ? (
          <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {dateBR(visit.scheduled_date)} às {timeBR(visit.scheduled_time)}
              </span>
              <StatusBadge status={visit.status} />
            </div>
            <p className="text-muted-foreground">{endereco || "Endereço não informado"}</p>
            <div className="flex flex-wrap gap-2">
              {whatsappLink(cliente?.phone) ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={whatsappLink(cliente?.phone)!} target="_blank" rel="noreferrer">
                    <Phone className="size-4" /> WhatsApp
                  </a>
                </Button>
              ) : null}
              {mapsLink(endereco) ? (
                <Button variant="outline" size="sm" asChild>
                  <a href={mapsLink(endereco)!} target="_blank" rel="noreferrer">
                    <MapPin className="size-4" /> Mapa
                  </a>
                </Button>
              ) : null}
            </div>
            {visit.result ? (
              <p className="text-muted-foreground">
                Resultado: <span className="font-medium text-foreground">{visit.result}</span>
                {visit.result_notes ? ` — ${visit.result_notes}` : ""}
              </p>
            ) : null}
            {Number(visit.mileage_cost_allocated ?? 0) > 0 ? (
              <p className="text-muted-foreground">
                Deslocamento rateado: {brl(visit.mileage_cost_allocated)}
              </p>
            ) : null}
            {visit.generated_work_order ? (
              <p className="text-muted-foreground">
                OS gerada:{" "}
                <span className="font-medium text-foreground">
                  {visit.generated_work_order.os_number}
                </span>
              </p>
            ) : null}
          </div>
        ) : null}

        {!isEdit ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <Label>Cliente</Label>
              <Button variant="ghost" size="sm" onClick={() => setNovoCliente((v) => !v)}>
                {novoCliente ? "Buscar cliente cadastrado" : "Cadastrar novo cliente"}
              </Button>
            </div>

            {novoCliente ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <Label>Nome completo</Label>
                  <Input value={nome} onChange={(e) => setNome(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Telefone</Label>
                  <Input
                    value={telefone}
                    onChange={(e) => setTelefone(e.target.value)}
                    inputMode="tel"
                  />
                </div>
                <div className="space-y-1">
                  <Label>CEP</Label>
                  <div className="flex gap-2">
                    <Input
                      value={cep}
                      onChange={(e) => setCep(e.target.value)}
                      inputMode="numeric"
                    />
                    <Button type="button" variant="outline" onClick={() => void buscarCep()}>
                      Buscar
                    </Button>
                  </div>
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Rua</Label>
                  <Input value={rua} onChange={(e) => setRua(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Número</Label>
                  <Input value={numero} onChange={(e) => setNumero(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Complemento</Label>
                  <Input value={complemento} onChange={(e) => setComplemento(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Bairro</Label>
                  <Input value={bairro} onChange={(e) => setBairro(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>Cidade</Label>
                  <Input value={cidade} onChange={(e) => setCidade(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label>UF</Label>
                  <Input value={uf} onChange={(e) => setUf(e.target.value)} maxLength={2} />
                </div>
                {rua && numero && cidade ? (
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    {buildFullAddress({
                      street: rua,
                      street_number: numero,
                      complement: complemento,
                      neighborhood: bairro,
                      city: cidade,
                      state: uf,
                      postal_code: cep,
                    })}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder="Nome ou telefone do cliente"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void buscarClientes();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={() => void buscarClientes()}>
                    <Search className="size-4" /> Buscar
                  </Button>
                </div>
                {resultados.length ? (
                  <NativeSelect
                    value={clienteId ?? ""}
                    onChange={(e) => setClienteId(e.target.value || null)}
                  >
                    <option value="">Selecione o cliente</option>
                    {resultados.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name} · {c.phone}
                      </option>
                    ))}
                  </NativeSelect>
                ) : null}
                {clienteSelecionado ? (
                  <p className="text-xs text-muted-foreground">{clienteSelecionado.full_address}</p>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>Data</Label>
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Horário</Label>
            <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Técnico</Label>
            <NativeSelect value={tecnicoId} onChange={(e) => setTecnicoId(e.target.value)}>
              <option value="">Sem técnico</option>
              {(tecnicos ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label>Origem do contato</Label>
            <NativeSelect value={origemId} onChange={(e) => setOrigemId(e.target.value)}>
              <option value="">Não informado</option>
              {(origens ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Estofado a orçar</Label>
            <Input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: sofá 3 lugares e 2 poltronas"
            />
          </div>
          <div className="space-y-1">
            <Label>Taxa da visita (R$)</Label>
            <Input value={taxa} onChange={(e) => setTaxa(e.target.value)} inputMode="decimal" />
            <p className="text-xs text-muted-foreground">
              Deixe 0,00 quando a visita for gratuita.
            </p>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Observações</Label>
            <Textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={3} />
          </div>
        </div>

        {isEdit && visit ? (
          <div className="space-y-3 rounded-lg border border-border p-3">
            <Label>Status</Label>
            <div className="flex flex-wrap gap-2">
              {BUDGET_VISIT_STATUSES.filter((s) => s !== "Realizado").map((s) => (
                <Button
                  key={s}
                  variant={visit.status === s ? "default" : "outline"}
                  size="sm"
                  onClick={() => void mudarStatus(s)}
                >
                  {s}
                </Button>
              ))}
              <Button size="sm" onClick={() => setConcluir((v) => !v)}>
                Concluir visita
              </Button>
            </div>

            {concluir ? (
              <div className="space-y-3 rounded-lg bg-muted/40 p-3">
                <div className="space-y-1">
                  <Label>Resultado do orçamento</Label>
                  <NativeSelect value={resultado} onChange={(e) => setResultado(e.target.value)}>
                    {BUDGET_VISIT_RESULTS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="space-y-1">
                  <Label>Observações do resultado</Label>
                  <Textarea
                    value={resultadoObs}
                    onChange={(e) => setResultadoObs(e.target.value)}
                    rows={3}
                  />
                </div>
                <Button disabled={salvando} onClick={() => void confirmarConclusao()}>
                  Confirmar conclusão
                </Button>
              </div>
            ) : null}

            {visit.result === "Orçamento aprovado" && !visit.generated_work_order_id ? (
              <Button variant="secondary" onClick={gerarOS}>
                Gerar OS deste orçamento
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-between gap-2 pt-2">
          {isEdit ? (
            <Button variant="ghost" className="text-destructive" onClick={() => void excluir()}>
              Excluir visita
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
            <Button disabled={salvando} onClick={() => void salvar()}>
              {isEdit ? "Salvar alterações" : "Agendar visita"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
