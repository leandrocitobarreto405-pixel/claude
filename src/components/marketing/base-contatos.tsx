import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { RefreshCw, Upload, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/app-shell";
import { NativeSelect } from "@/components/crm-ui";
import {
  GRUPOS,
  importarContatosFn,
  NOMES_GRUPOS,
  recalcularGruposFn,
  type LinhaImportacao,
} from "@/lib/marketing.functions";
import { CHAVE_MKT, type Situacao } from "./campanha-card";
import { fetchDireto } from "@/lib/enderecos";
import { simOuNao } from "@/lib/marketing-tela";
import { CAMPOS, mapearColunas } from "@/lib/importacao-base";
import { ModelosDePlanilha } from "./modelos-planilha";

type Row = Record<string, unknown>;

function dataPlanilha(v: unknown): string | null {
  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}` : null;
  }
  const t = String(v ?? "").trim();
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const ano = br[3]!.length === 2 ? `20${br[3]}` : br[3]!;
    return `${ano}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}`;
  }
  return t.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

export function BaseContatos({ dados }: { dados: Situacao }) {
  const qc = useQueryClient();
  const importarFn = useServerFn(importarContatosFn);
  const recalcularFn = useServerFn(recalcularGruposFn);
  const [linhas, setLinhas] = useState<Row[]>([]);
  const [colunas, setColunas] = useState<string[]>([]);
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [arquivo, setArquivo] = useState("");
  const [tipo, setTipo] = useState<"comprador" | "nao_comprador">("comprador");
  const [ocupado, setOcupado] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);

  async function ler(file: File) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const aba = wb.SheetNames[0];
      if (!aba) throw new Error("Planilha vazia");
      const json = XLSX.utils.sheet_to_json<Row>(wb.Sheets[aba]!, { defval: "" });
      if (!json.length) throw new Error("Nenhuma linha encontrada");
      const cols = Object.keys(json[0]!);
      const auto: Record<string, string> = { ...mapearColunas(cols) };
      setColunas(cols);
      setLinhas(json);
      setMapa(auto);
      setArquivo(file.name);
      setResultado(null);
      toast.success(`${json.length} linha(s) lida(s). Confira as colunas.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ler a planilha.");
    }
  }

  async function importar() {
    if (!mapa["telefone"]) {
      toast.error("Escolha a coluna do telefone.");
      return;
    }
    setOcupado(true);
    const total = { lidas: 0, novos: 0, atualizados: 0, invalidas: 0, comOrcamento: 0 };
    try {
      const pega = (r: Row, k: string) => (mapa[k] ? r[mapa[k]!] : undefined);
      const convertidas: LinhaImportacao[] = linhas.map((r) => ({
        telefone: String(pega(r, "telefone") ?? ""),
        nome: String(pega(r, "nome") ?? "").trim() || null,
        tipo,
        servico_em: dataPlanilha(pega(r, "servico_em")),
        servico_tipo: String(pega(r, "servico_tipo") ?? "").trim() || null,
        entrada_em: dataPlanilha(pega(r, "entrada_em")),
        interesse: String(pega(r, "interesse") ?? "").trim() || null,
        pediu_orcamento: tipo === "nao_comprador" && simOuNao(pega(r, "pediu_orcamento")),
      }));
      for (let i = 0; i < convertidas.length; i += 500) {
        const r = await importarFn({
          fetch: fetchDireto,
          data: { linhas: convertidas.slice(i, i + 500), origem: `planilha ${arquivo}` },
        });
        total.lidas += r.lidas;
        total.novos += r.novos;
        total.atualizados += r.atualizados;
        total.invalidas += r.invalidas;
        total.comOrcamento += r.com_orcamento ?? 0;
      }
      const texto = `${total.lidas} lidas: ${total.novos} novos, ${total.atualizados} atualizados, ${total.invalidas} telefones inválidos${
        total.comOrcamento ? `, ${total.comOrcamento} com orçamento pedido` : ""
      }.`;
      setResultado(texto);
      toast.success(
        `Importação concluída. ${texto} Toque em "Recalcular agora" para ver os grupos.`,
      );
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha na importação.");
    } finally {
      setOcupado(false);
    }
  }

  async function recalcular() {
    setOcupado(true);
    try {
      await recalcularFn();
      toast.success("Base sincronizada com o CRM e as OSs, grupos recalculados.");
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao recalcular.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid gap-4">
      <SectionCard
        icon={Users}
        title="Base de marketing"
        description="Compradores (C) e não compradores (N), por grupo. Quem pediu para sair, está sem pós-venda, em negociação ou recebeu marketing nos últimos 30 dias fica fora dos grupos."
        actions={
          dados.admin ? (
            <Button size="sm" variant="outline" disabled={ocupado} onClick={recalcular}>
              <RefreshCw className="mr-1 h-4 w-4" /> Recalcular agora
            </Button>
          ) : undefined
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {GRUPOS.map((g) => (
            <div key={g} className="rounded-lg border p-2">
              <p className="text-xs text-muted-foreground">{NOMES_GRUPOS[g]}</p>
              <p className="text-lg font-semibold">{dados.base.grupos[g] ?? 0}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {dados.base.total} contatos na base · {dados.base.optouts} pediram para não receber
          ofertas.
        </p>
      </SectionCard>

      {dados.admin && (
        <SectionCard
          icon={Upload}
          title="Importar planilha"
          description="CSV ou Excel, com o título das colunas na primeira linha. Mesmo telefone (com ou sem o 9) vira um contato só; comprador prevalece sobre não comprador. Clientes com OS paga e concluída e leads novos do CRM entram sozinhos."
        >
          <div className="grid gap-3">
            <ModelosDePlanilha />
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="mkt-arquivo">Arquivo</Label>
                <Input
                  id="mkt-arquivo"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => e.target.files?.[0] && ler(e.target.files[0])}
                />
              </div>
              <div className="grid gap-1">
                <Label>Quem está nesta planilha</Label>
                <NativeSelect
                  value={tipo}
                  onChange={(v) => setTipo(v as typeof tipo)}
                  options={[
                    { value: "comprador", label: "Compradores (já fizeram serviço)" },
                    {
                      value: "nao_comprador",
                      label: "Não compradores (conversaram ou pediram orçamento)",
                    },
                  ]}
                />
              </div>
            </div>
            {colunas.length > 0 && (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  {CAMPOS.map((c) => (
                    <div key={c.chave} className="grid gap-1">
                      <Label>{c.label}</Label>
                      <NativeSelect
                        value={mapa[c.chave] ?? ""}
                        onChange={(v) => setMapa({ ...mapa, [c.chave]: v })}
                        placeholder="(não tem)"
                        options={colunas.map((col) => ({ value: col, label: col }))}
                      />
                    </div>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  {linhas.length} linha(s) em {arquivo}.
                </p>
                <div>
                  <Button disabled={ocupado} onClick={importar}>
                    <Upload className="mr-1 h-4 w-4" /> Importar {linhas.length} contato(s)
                  </Button>
                </div>
              </>
            )}
            {resultado && <p className="text-sm">{resultado}</p>}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
