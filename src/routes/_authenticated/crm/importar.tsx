import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionCard } from "@/components/app-shell";
import { NativeSelect } from "@/components/crm-ui";
import { supabase } from "@/integrations/supabase/client";
import {
  CRM_STATUS_KIND,
  ensureContact,
  normalizePhone,
  useCrmCampaigns,
  useCrmCatalog,
  useCrmInvalidate,
} from "@/lib/crm";
import { todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/crm/importar")({
  head: () => ({
    meta: [
      { title: "Importar histórico do CRM — Turbine Clean" },
      { name: "description", content: "Importe planilhas antigas de leads do WhatsApp com validação e prévia antes de gravar." },
      { property: "og:title", content: "Importar histórico do CRM — Turbine Clean" },
      { property: "og:description", content: "Importe planilhas antigas de leads do WhatsApp com validação e prévia antes de gravar." },
    ],
  }),
  component: ImportarCrm,
});

const CAMPOS = [
  { key: "lead_name", label: "Nome do lead", required: true },
  { key: "phone", label: "Telefone", required: true },
  { key: "first_contact_date", label: "Data do primeiro contato", required: false },
  { key: "upholstery_description", label: "Estofado / descrição", required: false },
  { key: "service_interest", label: "Serviço de interesse", required: false },
  { key: "status", label: "Status", required: false },
  { key: "temperature", label: "Temperatura (Frio/Quente)", required: false },
  { key: "summary", label: "Resumo da conversa", required: false },
  { key: "notes", label: "Observações", required: false },
] as const;

type Row = Record<string, unknown>;

function excelDate(value: unknown): string | null {
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return `${parsed.y}-${String(parsed.m).padStart(2, "0")}-${String(parsed.d).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const year = br[3]!.length === 2 ? `20${br[3]}` : br[3]!;
    return `${year}-${br[2]!.padStart(2, "0")}-${br[1]!.padStart(2, "0")}`;
  }
  const iso = text.match(/^\d{4}-\d{2}-\d{2}/);
  return iso ? iso[0] : null;
}

function ImportarCrm() {
  const [colunas, setColunas] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<Row[]>([]);
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [campanhaId, setCampanhaId] = useState("");
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{ criados: number; atualizados: number; erros: string[] } | null>(
    null,
  );
  const { data: statuses } = useCrmCatalog(CRM_STATUS_KIND, false);
  const { data: campanhas } = useCrmCampaigns();
  const invalidate = useCrmInvalidate();

  async function lerArquivo(file: File) {
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new Error("Planilha vazia");
      const sheet = wb.Sheets[sheetName]!;
      const json = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "" });
      if (json.length === 0) throw new Error("Nenhuma linha encontrada");
      const cols = Object.keys(json[0] as Row);
      setColunas(cols);
      setLinhas(json);
      setResultado(null);
      // Sugere o mapeamento por semelhança de nome.
      const auto: Record<string, string> = {};
      for (const campo of CAMPOS) {
        const alvo = cols.find((c) =>
          c
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .includes(campo.label.split(" ")[0]!.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
        );
        if (alvo) auto[campo.key] = alvo;
      }
      setMapa(auto);
      toast.success(`${json.length} linha(s) carregada(s). Confira o mapeamento.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível ler a planilha.");
    }
  }

  const previa = useMemo(() => linhas.slice(0, 5), [linhas]);
  const faltando = CAMPOS.filter((c) => c.required && !mapa[c.key]).map((c) => c.label);

  async function importar() {
    if (faltando.length > 0) {
      toast.error(`Mapeie os campos obrigatórios: ${faltando.join(", ")}.`);
      return;
    }
    setImportando(true);
    const erros: string[] = [];
    let criados = 0;
    let atualizados = 0;

    try {
      for (const [index, row] of linhas.entries()) {
        const get = (key: string) => {
          const col = mapa[key];
          return col ? String(row[col] ?? "").trim() : "";
        };
        const nome = get("lead_name").slice(0, 120);
        const telefone = normalizePhone(get("phone"));
        if (!telefone || telefone.length < 12) {
          erros.push(`Linha ${index + 2}: telefone inválido.`);
          continue;
        }

        const statusNome = get("status");
        const status = (statuses ?? []).find(
          (s) => s.name.toLowerCase() === statusNome.toLowerCase(),
        );
        const temperaturaTexto = get("temperature").toUpperCase();
        const temperatura = temperaturaTexto.startsWith("Q") ? "QUENTE" : "FRIO";
        const dataContato =
          (mapa["first_contact_date"] ? excelDate(row[mapa["first_contact_date"]!]) : null) ?? todayISO();

        try {
          const contatoId = await ensureContact({ phone: telefone, name: nome || null });
          const { data: existente } = await supabase
            .from("crm_leads")
            .select("id")
            .eq("normalized_phone", telefone)
            .eq("is_open", true)
            .maybeSingle();

          const payload = {
            whatsapp_contact_id: contatoId,
            lead_name: nome || "Sem nome",
            phone: telefone,
            normalized_phone: telefone,
            first_contact_date: dataContato,
            upholstery_description: get("upholstery_description").slice(0, 300) || null,
            service_interest: get("service_interest").slice(0, 80) || null,
            summary: get("summary").slice(0, 1500) || null,
            summary_source: "Importação",
            notes: get("notes").slice(0, 1000) || null,
            temperature: temperatura,
            temperature_confirmed: Boolean(temperaturaTexto),
            status_id: status?.id ?? null,
            campaign_id: campanhaId || null,
            source_type: "Importação de planilha",
            last_interaction_at: `${dataContato}T12:00:00.000Z`,
          };

          if (existente) {
            const { error } = await supabase
              .from("crm_leads")
              .update(payload as never)
              .eq("id", existente.id);
            if (error) throw error;
            atualizados += 1;
          } else {
            const { error } = await supabase.from("crm_leads").insert(payload as never);
            if (error) throw error;
            criados += 1;
          }
        } catch (error) {
          erros.push(`Linha ${index + 2}: ${error instanceof Error ? error.message : "falha ao gravar"}.`);
        }
      }

      setResultado({ criados, atualizados, erros });
      invalidate();
      toast.success(`Importação concluída: ${criados} novo(s), ${atualizados} atualizado(s).`);
    } finally {
      setImportando(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Importar histórico"
        description="Traga suas planilhas antigas de leads. Nada é sobrescrito sem correspondência de telefone."
      />

      <div className="grid gap-4">
        <SectionCard
          step={1}
          title="Enviar planilha"
          description="Aceita arquivos .xlsx, .xls e .csv. A primeira linha deve conter os títulos das colunas."
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="arquivo">Arquivo</Label>
              <Input
                id="arquivo"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void lerArquivo(file);
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="camp">Campanha (opcional)</Label>
              <NativeSelect
                id="camp"
                value={campanhaId}
                onChange={setCampanhaId}
                options={(campanhas ?? []).map((c) => ({ value: c.id, label: c.campaign_name }))}
              />
            </div>
          </div>
        </SectionCard>

        {colunas.length > 0 ? (
          <SectionCard
            step={2}
            title="Mapear colunas"
            description="Indique qual coluna da planilha corresponde a cada campo do CRM."
          >
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CAMPOS.map((campo) => (
                <div key={campo.key} className="grid gap-1.5">
                  <Label htmlFor={`m-${campo.key}`}>
                    {campo.label}
                    {campo.required ? " *" : ""}
                  </Label>
                  <NativeSelect
                    id={`m-${campo.key}`}
                    value={mapa[campo.key] ?? ""}
                    onChange={(v) => setMapa((prev) => ({ ...prev, [campo.key]: v }))}
                    options={colunas.map((c) => ({ value: c, label: c }))}
                  />
                </div>
              ))}
            </div>
            {faltando.length > 0 ? (
              <p className="mt-3 text-sm text-destructive">
                Campos obrigatórios sem mapeamento: {faltando.join(", ")}.
              </p>
            ) : null}
          </SectionCard>
        ) : null}

        {previa.length > 0 ? (
          <SectionCard
            step={3}
            title={`Prévia (${linhas.length} linha(s))`}
            description="Confira as primeiras linhas antes de importar."
            accent="navy"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left uppercase tracking-wide text-muted-foreground">
                    {CAMPOS.filter((c) => mapa[c.key]).map((c) => (
                      <th key={c.key} className="py-2 pr-3">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previa.map((row, i) => (
                    <tr key={i} className="border-b border-border/60 last:border-0">
                      {CAMPOS.filter((c) => mapa[c.key]).map((c) => (
                        <td key={c.key} className="py-2 pr-3">
                          {String(row[mapa[c.key]!] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button className="mt-4 gap-2" onClick={() => void importar()} disabled={importando}>
              <Upload className="size-4" />
              {importando ? "Importando..." : `Importar ${linhas.length} linha(s)`}
            </Button>
          </SectionCard>
        ) : null}

        {resultado ? (
          <SectionCard
            icon={FileSpreadsheet}
            title="Resultado da importação"
            accent={resultado.erros.length > 0 ? "warning" : "success"}
          >
            <p className="text-sm">
              {resultado.criados} lead(s) criado(s) · {resultado.atualizados} atualizado(s) ·{" "}
              {resultado.erros.length} com erro.
            </p>
            {resultado.erros.length > 0 ? (
              <ul className="mt-2 grid max-h-56 gap-1 overflow-y-auto text-xs text-destructive">
                {resultado.erros.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            ) : null}
          </SectionCard>
        ) : null}
      </div>
    </>
  );
}
