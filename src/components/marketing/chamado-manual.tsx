/**
 * "Já chamei manualmente": a equipe chamou a pessoa pelo WhatsApp do celular (antes do Chatwoot)
 * e o Nexa não vê. Conta como mensagem de marketing naquele dia (regra dos 30 dias). Um contato
 * por vez (Base de contatos e prévia da campanha) ou vários por planilha de telefones.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FileSpreadsheet, PhoneOutgoing, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SectionCard } from "@/components/app-shell";
import { NativeSelect } from "@/components/crm-ui";
import {
  buscarContatosMktFn,
  marcarChamadoManualFn,
  type ItemChamadoManual,
} from "@/lib/marketing.functions";
import { formatPhoneBR } from "@/lib/crm";
import { dateBR, todayISO } from "@/lib/format";
import { dataPlanilha } from "@/lib/planilha-data";
import { semAcento } from "@/lib/importacao-base";
import { fetchDireto } from "@/lib/enderecos";
// Mesma chave do Marketing (campanha-card), sem importar o cartão (que usa este botão).
const CHAVE_MKT = ["marketing"] as const;

type Resultado = {
  marcados: number;
  naoEncontrados: string[];
  totalNaoEncontrados: number;
  tiradosDeCampanhas: number;
};

function textoResultado(r: Resultado) {
  return [
    r.marcados === 1 ? "1 contato marcado" : `${r.marcados} contatos marcados`,
    r.totalNaoEncontrados ? `${r.totalNaoEncontrados} não estão na base` : null,
    r.tiradosDeCampanhas
      ? `${r.tiradosDeCampanhas} ${r.tiradosDeCampanhas === 1 ? "saiu" : "saíram"} de campanhas ainda não aprovadas`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Botão "Já chamei manualmente" com a data (hoje por padrão, nunca no futuro). */
export function BotaoChamadoManual({
  contatoId,
  nome,
  marcadoEm,
  aoMarcar,
}: {
  contatoId: string;
  nome: string | null;
  marcadoEm?: string | null;
  aoMarcar?: () => void;
}) {
  const qc = useQueryClient();
  const marcar = useServerFn(marcarChamadoManualFn);
  const [aberto, setAberto] = useState(false);
  const [data, setData] = useState(todayISO());
  const [ocupado, setOcupado] = useState(false);

  async function confirmar() {
    if (!data || data > todayISO()) {
      toast.error("Escolha uma data de hoje ou de antes.");
      return;
    }
    setOcupado(true);
    try {
      const r = await marcar({
        fetch: fetchDireto,
        data: { itens: [{ contato_id: contatoId, data }] },
      });
      toast.success(
        `${nome ?? "Contato"}: chamado manualmente em ${dateBR(data)}. ${textoResultado(r)}.`,
      );
      setAberto(false);
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
      aoMarcar?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível marcar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="min-h-11"
        onClick={() => {
          setData(todayISO());
          setAberto(true);
        }}
      >
        <PhoneOutgoing className="mr-1 h-4 w-4" />
        {marcadoEm ? `Chamado em ${dateBR(marcadoEm)}` : "Já chamei manualmente"}
      </Button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Já chamei manualmente</DialogTitle>
            <DialogDescription>
              {nome ?? "Este contato"} foi chamado pelo WhatsApp do celular. Conta como mensagem de
              marketing nesse dia: fica fora das campanhas pelos próximos 30 dias e sai das
              campanhas ainda não aprovadas.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor={`chamado-${contatoId}`}>Quando chamou</Label>
            <Input
              id={`chamado-${contatoId}`}
              type="date"
              value={data}
              max={todayISO()}
              onChange={(e) => setData(e.target.value)}
            />
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setAberto(false)}>
              Voltar
            </Button>
            <Button disabled={ocupado} onClick={confirmar}>
              Marcar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Linha = Record<string, unknown>;

const NOMES_TELEFONE = ["telefone", "celular", "whatsapp", "fone", "phone", "numero"];
const NOMES_DATA = ["data", "dia", "quando", "chamado", "contato em", "date"];

function adivinhar(colunas: string[], nomes: string[]) {
  return colunas.find((c) => nomes.some((n) => semAcento(c).includes(n))) ?? "";
}

/** Base de contatos: busca para marcar um contato e planilha para marcar vários. */
export function ChamadosManuais({ admin }: { admin: boolean }) {
  const qc = useQueryClient();
  const buscar = useServerFn(buscarContatosMktFn);
  const marcar = useServerFn(marcarChamadoManualFn);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const q = useQuery({
    queryKey: [...CHAVE_MKT, "busca-contatos", termo],
    queryFn: () => buscar({ data: { busca: termo } }),
    enabled: termo.length >= 2,
  });

  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [colunas, setColunas] = useState<string[]>([]);
  const [colFone, setColFone] = useState("");
  const [colData, setColData] = useState("");
  const [dataPadrao, setDataPadrao] = useState(todayISO());
  const [arquivo, setArquivo] = useState("");
  const [previa, setPrevia] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function ler(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const aba = wb.SheetNames[0];
      if (!aba) throw new Error("Planilha vazia");
      const json = XLSX.utils.sheet_to_json<Linha>(wb.Sheets[aba]!, { defval: "" });
      if (!json.length) throw new Error("Nenhuma linha encontrada");
      if (json.length > 5000) throw new Error("Até 5000 telefones por planilha.");
      const cols = Object.keys(json[0]!);
      setColunas(cols);
      setLinhas(json);
      setColFone(adivinhar(cols, NOMES_TELEFONE));
      setColData(adivinhar(cols, NOMES_DATA));
      setArquivo(file.name);
      setPrevia(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
    }
  }

  function itens(): ItemChamadoManual[] {
    return linhas
      .map((l) => {
        const telefone = String(l[colFone] ?? "").trim();
        const dia = (colData && dataPlanilha(l[colData])) || dataPadrao;
        return { telefone, data: dia > todayISO() ? todayISO() : dia };
      })
      .filter((i) => i.telefone.replace(/\D/g, "").length >= 8);
  }

  async function enviar(simular: boolean) {
    if (!colFone) {
      toast.error("Escolha a coluna do telefone.");
      return;
    }
    const lista = itens();
    if (!lista.length) {
      toast.error("Nenhum telefone válido na planilha.");
      return;
    }
    setOcupado(true);
    try {
      const r = await marcar({ fetch: fetchDireto, data: { itens: lista, simular } });
      if (simular) setPrevia(r);
      else {
        toast.success(`Planilha marcada. ${textoResultado(r)}.`);
        setLinhas([]);
        setColunas([]);
        setPrevia(null);
        await qc.invalidateQueries({ queryKey: CHAVE_MKT });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível marcar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <SectionCard
      icon={PhoneOutgoing}
      title="Já chamei manualmente"
      description="Quem a equipe chamou pelo WhatsApp do celular (antes do Chatwoot) e o Nexa não vê. Conta como mensagem de marketing no dia: a pessoa fica fora das campanhas por 30 dias e depois volta normalmente."
    >
      <div className="grid gap-4">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setTermo(busca.trim());
          }}
        >
          <Input
            aria-label="Buscar contato por nome ou telefone"
            placeholder="Nome ou telefone"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          <Button type="submit" variant="outline" className="min-h-11 shrink-0">
            <Search className="mr-1 h-4 w-4" /> Buscar
          </Button>
        </form>
        {termo.length >= 2 && (
          <ul className="grid gap-2">
            {q.isLoading && <li className="text-sm text-muted-foreground">Buscando…</li>}
            {q.data?.length === 0 && (
              <li className="text-sm text-muted-foreground">Ninguém com esse nome ou telefone.</li>
            )}
            {q.data?.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.nome ?? "Sem nome"}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatPhoneBR(c.telefone)} ·{" "}
                    {c.tipo === "comprador" ? "cliente" : "não comprador"}
                  </p>
                </div>
                {admin ? (
                  <BotaoChamadoManual
                    contatoId={c.id}
                    nome={c.nome}
                    marcadoEm={c.chamadoManualEm}
                    aoMarcar={() => q.refetch()}
                  />
                ) : c.chamadoManualEm ? (
                  <span className="text-sm text-muted-foreground">
                    Chamado em {dateBR(c.chamadoManualEm)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {admin && (
          <div className="grid gap-2 border-t pt-4">
            <p className="flex items-center gap-1 text-sm font-medium">
              <FileSpreadsheet className="h-4 w-4" /> Vários de uma vez (planilha)
            </p>
            <p className="text-sm text-muted-foreground">
              CSV ou Excel com uma coluna de telefone e, se quiser, uma coluna com a data em que
              chamou. Sem data, vale a data abaixo.
            </p>
            <Input
              aria-label="Planilha de telefones"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => e.target.files?.[0] && ler(e.target.files[0])}
            />
            {colunas.length > 0 && (
              <div className="grid gap-2">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="grid gap-1">
                    <Label>Coluna do telefone</Label>
                    <NativeSelect
                      value={colFone}
                      onChange={(v) => {
                        setColFone(v);
                        setPrevia(null);
                      }}
                      options={colunas.map((c) => ({ value: c, label: c }))}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label>Coluna da data</Label>
                    <NativeSelect
                      value={colData}
                      onChange={(v) => {
                        setColData(v);
                        setPrevia(null);
                      }}
                      placeholder="(não tem)"
                      options={colunas.map((c) => ({ value: c, label: c }))}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor="chamado-data-padrao">Data (sem coluna)</Label>
                    <Input
                      id="chamado-data-padrao"
                      type="date"
                      max={todayISO()}
                      value={dataPadrao}
                      onChange={(e) => {
                        setDataPadrao(e.target.value);
                        setPrevia(null);
                      }}
                    />
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {linhas.length} linha(s) em {arquivo}.
                </p>
                {previa ? (
                  <div className="grid gap-2 rounded-lg border p-3 text-sm">
                    <p>
                      <span className="font-semibold">{previa.marcados}</span> encontrados na base
                      {previa.totalNaoEncontrados
                        ? ` · ${previa.totalNaoEncontrados} não estão na base (ficam de fora)`
                        : ""}
                      .
                    </p>
                    {previa.naoEncontrados.length > 0 && (
                      <p className="text-muted-foreground">
                        Não encontrados: {previa.naoEncontrados.slice(0, 10).join(", ")}
                        {previa.totalNaoEncontrados > 10 ? "…" : ""}
                      </p>
                    )}
                    <div>
                      <Button
                        className="min-h-11"
                        disabled={ocupado || !previa.marcados}
                        onClick={() => enviar(false)}
                      >
                        Marcar {previa.marcados} contato(s)
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button
                      variant="outline"
                      className="min-h-11"
                      disabled={ocupado}
                      onClick={() => enviar(true)}
                    >
                      Conferir telefones
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
