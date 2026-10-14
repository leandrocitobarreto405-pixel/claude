// Seção de Configurações (veio da antiga tela de abas).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useServerFn } from "@tanstack/react-start";
import { getOsDocSettings, saveOsDocSettings, testOsDocIntegration } from "@/lib/os-docs.functions";
import { CAMPOS_MODELO_GARANTIA, CAMPOS_MODELO_OS } from "@/lib/os-docs-campos";

function CamposDoModelo({ campos }: { campos: readonly string[] }) {
  return (
    <div className="rounded-lg border border-border/70 p-3 text-xs text-muted-foreground">
      <p className="mb-1 font-medium text-foreground">Campos usados no modelo</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1">
        {campos.map((c) => (
          <li key={c}>
            <code>{c}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModelosOS() {
  const ler = useServerFn(getOsDocSettings);
  const salvarFn = useServerFn(saveOsDocSettings);
  const testarFn = useServerFn(testOsDocIntegration);

  const query = useQuery({ queryKey: ["os_doc_settings"], queryFn: () => ler({}) });
  const [ativa, setAtiva] = useState(false);
  const [auto, setAuto] = useState(true);
  const [nome, setNome] = useState("OS {{NUMERO_OS}} - {{NOME_CLIENTE}}");
  const [hig, setHig] = useState("");
  const [imp, setImp] = useState("");
  const [comb, setComb] = useState("");
  const [garantia, setGarantia] = useState("");
  const [pasta, setPasta] = useState("");
  const [status, setStatus] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    setAtiva(query.data.enabled);
    setAuto(query.data.autoGenerate);
    setNome(query.data.nameTemplate);
    setStatus(query.data.configured ? "Configurada" : "Não configurada");
  }, [query.data]);

  async function salvar() {
    setOcupado(true);
    setStatus("Validando dados");
    try {
      await salvarFn({
        data: {
          enabled: ativa,
          autoGenerate: auto,
          nameTemplate: nome,
          higienizacao: hig,
          impermeabilizacao: imp,
          combinado: comb,
          garantia,
          pasta,
        },
      });
      toast.success("Configurações da integração salvas.");
      setHig("");
      setImp("");
      setComb("");
      setGarantia("");
      setPasta("");
      await query.refetch();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Não foi possível salvar.";
      setStatus("Erro na conexão");
      toast.error(msg);
    } finally {
      setOcupado(false);
    }
  }

  async function testar() {
    setOcupado(true);
    setStatus("Testando conexão");
    try {
      await testarFn({});
      setStatus("Conexão validada");
      toast.success("Integração validada: modelos, cópia, edição e gravação na pasta funcionando.");
    } catch (e) {
      setStatus("Erro na conexão");
      toast.error(e instanceof Error ? e.message : "Falha ao testar a integração.");
    } finally {
      setOcupado(false);
    }
  }

  const d = query.data;

  return (
    <section className="card-surface max-w-3xl p-5">
      <h2 className="mb-1 text-lg font-semibold">Modelos de ordem de serviço (Google Docs)</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Cole o link (ou o ID) de cada modelo e da pasta de destino no Google Drive. Deixe em branco
        para manter o que já está salvo. Situação atual:{" "}
        <strong>{status || "Não configurada"}</strong>.
      </p>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tpl-hig">
            Modelo Higienização {d?.hasHigienizacao ? "(salvo)" : "(pendente)"}
          </Label>
          <Input
            id="tpl-hig"
            value={hig}
            onChange={(e) => setHig(e.target.value)}
            placeholder="Link do Google Docs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-imp">
            Modelo Impermeabilização {d?.hasImpermeabilizacao ? "(salvo)" : "(pendente)"}
          </Label>
          <Input
            id="tpl-imp"
            value={imp}
            onChange={(e) => setImp(e.target.value)}
            placeholder="Link do Google Docs"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-comb">
            Modelo Higienização e Impermeabilização {d?.hasCombinado ? "(salvo)" : "(pendente)"}
          </Label>
          <Input
            id="tpl-comb"
            value={comb}
            onChange={(e) => setComb(e.target.value)}
            placeholder="Link do Google Docs"
          />
        </div>
        <CamposDoModelo campos={CAMPOS_MODELO_OS} />
        <div className="space-y-2">
          <Label htmlFor="tpl-garantia">
            Modelo Termo de garantia {d?.hasGarantia ? "(salvo)" : "(pendente)"}
          </Label>
          <Input
            id="tpl-garantia"
            value={garantia}
            onChange={(e) => setGarantia(e.target.value)}
            placeholder="Link do Google Docs"
          />
          <p className="text-xs text-muted-foreground">
            Gerado para OS com impermeabilização. Sem este modelo, o termo não é gerado e aparece o
            aviso “Configure o modelo do termo de garantia”.
          </p>
          <CamposDoModelo campos={CAMPOS_MODELO_GARANTIA} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-pasta">
            Pasta principal no Drive {d?.hasFolder ? "(salva)" : "(pendente)"}
          </Label>
          <Input
            id="tpl-pasta"
            value={pasta}
            onChange={(e) => setPasta(e.target.value)}
            placeholder="Link da pasta do Google Drive"
          />
          <p className="text-xs text-muted-foreground">
            Não é a pasta de um cliente: é onde o sistema cria, para cada OS,{" "}
            <strong>Materiais dos clientes › ano › mês › OS nº - Cliente - Empresa</strong>. O
            documento da OS e as pastas Antes, Depois e Vídeos ficam dentro da pasta do cliente.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tpl-nome">Padrão do nome do documento</Label>
          <Input id="tpl-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>

        <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" checked={ativa} onChange={(e) => setAtiva(e.target.checked)} />
          Integração ativa
        </label>
        <label className="flex items-center gap-3 rounded-lg border border-border p-3 text-sm">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Gerar documento automaticamente ao salvar a OS
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={salvar} disabled={ocupado}>
          {ocupado ? "Aguarde..." : "Salvar integração"}
        </Button>
        <Button variant="outline" onClick={testar} disabled={ocupado}>
          Testar integração
        </Button>
      </div>
    </section>
  );
}
