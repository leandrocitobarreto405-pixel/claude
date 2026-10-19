// Configurações › Empresa › Dados nos documentos: nome, CNPJ, contatos e logo do PDF da OS.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useContextoTenant } from "@/lib/tenant";
import { enviarLogo, useLogoEmpresa } from "@/lib/empresa-logo";
import {
  CHAVE_DADOS_EMPRESA,
  lerDadosEmpresaFn,
  salvarDadosEmpresaFn,
  type DadosEmpresaForm,
} from "@/lib/documentos.functions";

const CAMPOS: Array<{
  chave: Exclude<keyof DadosEmpresaForm, "logoPath">;
  rotulo: string;
  placeholder?: string;
  tipo?: string;
}> = [
  { chave: "nome", rotulo: "Nome da empresa" },
  { chave: "cnpj", rotulo: "CNPJ", placeholder: "00.000.000/0000-00" },
  { chave: "email", rotulo: "E-mail", tipo: "email" },
  { chave: "telefone", rotulo: "Telefone / WhatsApp", tipo: "tel" },
  { chave: "endereco", rotulo: "Endereço", placeholder: "Rua, número - bairro - cidade - UF" },
  { chave: "instagram", rotulo: "Instagram", placeholder: "@suaempresa" },
];

export function DadosEmpresa() {
  const qc = useQueryClient();
  const { data: ctx } = useContextoTenant();
  const empresaId = ctx?.ativa?.empresa.id ?? null;
  const ler = useServerFn(lerDadosEmpresaFn);
  const salvar = useServerFn(salvarDadosEmpresaFn);
  const dados = useQuery({ queryKey: [...CHAVE_DADOS_EMPRESA, empresaId], queryFn: () => ler() });
  const [form, setForm] = useState<DadosEmpresaForm | null>(null);
  const [versao, setVersao] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const logo = useLogoEmpresa(form?.logoPath, versao);

  useEffect(() => {
    if (dados.data) setForm(dados.data);
  }, [dados.data]);

  async function gravar(f: DadosEmpresaForm, aviso: string) {
    await salvar({ data: f });
    await qc.invalidateQueries({ queryKey: [...CHAVE_DADOS_EMPRESA] });
    toast.success(aviso);
  }

  async function trocarLogo(arquivo: File | undefined) {
    if (!arquivo || !form || !empresaId) return;
    setEnviando(true);
    try {
      const caminho = await enviarLogo(empresaId, arquivo);
      const novo = { ...form, logoPath: caminho };
      await gravar(novo, "Logo salva.");
      setForm(novo);
      setVersao((v) => v + 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a logo.");
    } finally {
      setEnviando(false);
    }
  }

  async function tirarLogo() {
    if (!form) return;
    try {
      const novo = { ...form, logoPath: null };
      await gravar(novo, "Logo retirada dos documentos.");
      setForm(novo);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }

  async function salvarDados() {
    if (!form) return;
    setSalvando(true);
    try {
      await gravar(form, "Dados da empresa salvos.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  if (!form) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  return (
    <section className="card-surface space-y-5 p-5">
      <p className="text-sm text-muted-foreground">
        Aparecem no cabeçalho do PDF da OS e do termo de garantia. Campo vazio não aparece. O nome e
        o telefone também são os que a Alice usa.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {logo.data ? (
          <img
            src={logo.data}
            alt="Logo da empresa"
            className="h-16 max-w-40 shrink-0 rounded-md border border-border bg-white object-contain p-1"
          />
        ) : (
          <div className="flex h-16 w-28 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
            sem logo
          </div>
        )}
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-input px-4 text-sm font-medium">
          {enviando ? "Enviando…" : form.logoPath ? "Trocar logo" : "Adicionar logo"}
          <input
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            disabled={enviando || !empresaId}
            onChange={(e) => {
              void trocarLogo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {form.logoPath ? (
          <Button variant="ghost" className="min-h-11" onClick={() => void tirarLogo()}>
            Tirar logo
          </Button>
        ) : null}
        <p className="w-full text-xs text-muted-foreground">PNG ou JPG, até 2 MB.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {CAMPOS.map((c) => (
          <div
            key={c.chave}
            className={c.chave === "endereco" ? "space-y-2 sm:col-span-2" : "space-y-2"}
          >
            <Label htmlFor={`empresa-${c.chave}`}>{c.rotulo}</Label>
            <Input
              id={`empresa-${c.chave}`}
              type={c.tipo ?? "text"}
              className="min-h-11"
              placeholder={c.placeholder}
              value={form[c.chave]}
              onChange={(e) => setForm({ ...form, [c.chave]: e.target.value })}
            />
          </div>
        ))}
      </div>
      <Button
        className="min-h-11 w-full sm:w-auto"
        disabled={salvando}
        onClick={() => void salvarDados()}
      >
        {salvando ? "Salvando…" : "Salvar dados"}
      </Button>
    </section>
  );
}
