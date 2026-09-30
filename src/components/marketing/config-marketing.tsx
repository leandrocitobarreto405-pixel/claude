import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SectionCard } from "@/components/app-shell";
import { salvarConfigMktFn, type ConfigMktEditavel } from "@/lib/marketing.functions";
import { CHAVE_MKT, type Situacao } from "./campanha-card";

const FLAGS: Array<{ chave: keyof ConfigMktEditavel; titulo: string; texto: string }> = [
  {
    chave: "disparo_ligado",
    titulo: "Disparo das campanhas",
    texto:
      "Campanhas aprovadas saem sozinhas nas datas (terça a quinta, 10h). Desligado: nada sai, mesmo aprovado.",
  },
  {
    chave: "gatilho_c1_ligado",
    titulo: "Gatilho C1 — pós-venda",
    texto: "Dia seguinte ao serviço concluído e pago, das 9h às 19h.",
  },
  {
    chave: "gatilho_c2_ligado",
    titulo: "Gatilho C2 — 6 meses da higienização",
    texto: "Uma vez, entre 5 e 7 meses depois da higienização.",
  },
  {
    chave: "gatilho_c3_ligado",
    titulo: "Gatilho C3 — 13º mês da impermeabilização",
    texto: "Entre 1 ano e 15 dias e 1 ano e 1 mês; lembrete uma vez se não responder em 24 h.",
  },
  {
    chave: "preparo_automatico",
    titulo: "Preparo automático",
    texto:
      "10 dias antes da campanha, o Nexa monta lotes, confere os modelos e pede sua aprovação. Não envia nada.",
  },
  {
    chave: "aviso_whatsapp_ligado",
    titulo: "Avisos no meu WhatsApp",
    texto: "Campanha para aprovar, pausa, bloqueio e resumo semanal também no seu WhatsApp.",
  },
];

export function ConfigMarketing({ dados }: { dados: Situacao }) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(salvarConfigMktFn);
  const c = dados.config;
  const [form, setForm] = useState<ConfigMktEditavel>({
    disparo_ligado: c?.disparo_ligado ?? false,
    gatilho_c1_ligado: c?.gatilho_c1_ligado ?? false,
    gatilho_c2_ligado: c?.gatilho_c2_ligado ?? false,
    gatilho_c3_ligado: c?.gatilho_c3_ligado ?? false,
    preparo_automatico: c?.preparo_automatico ?? true,
    aviso_whatsapp_ligado: c?.aviso_whatsapp_ligado ?? false,
    aviso_telefone: c?.aviso_telefone ?? "",
    aviso_template_nome: c?.aviso_template_nome ?? "",
    link_avaliacao_google: c?.link_avaliacao_google ?? "",
  });
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const ligando = FLAGS.filter(
      (f) =>
        f.chave !== "preparo_automatico" &&
        form[f.chave] === true &&
        !(c?.[f.chave as keyof typeof c] as boolean | undefined),
    );
    if (
      ligando.length &&
      !window.confirm(
        `Você vai ligar: ${ligando.map((f) => f.titulo).join(", ")}. A partir daí o Nexa envia mensagens de verdade para clientes. Confirma?`,
      )
    )
      return;
    setSalvando(true);
    try {
      await salvarFn({ data: form });
      toast.success("Configuração salva.");
      await qc.invalidateQueries({ queryKey: CHAVE_MKT });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <SectionCard
      icon={Settings}
      title="Configuração"
      description="Tudo que envia mensagem começa desligado. Ligue depois do teste com os celulares da equipe."
    >
      <div className="grid gap-4">
        {FLAGS.map((f) => (
          <label key={f.chave} className="flex items-start justify-between gap-4">
            <span>
              <span className="block font-medium">{f.titulo}</span>
              <span className="block text-sm text-muted-foreground">{f.texto}</span>
            </span>
            <Switch
              checked={Boolean(form[f.chave])}
              disabled={!dados.admin}
              onCheckedChange={(v) => setForm({ ...form, [f.chave]: v })}
            />
          </label>
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="aviso-fone">Meu WhatsApp (avisos)</Label>
            <Input
              id="aviso-fone"
              value={form.aviso_telefone ?? ""}
              placeholder="(11) 99999-9999"
              disabled={!dados.admin}
              onChange={(e) => setForm({ ...form, aviso_telefone: e.target.value })}
            />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="aviso-modelo">Modelo do aviso (aprovado na Meta, com {"{{1}}"})</Label>
            <Input
              id="aviso-modelo"
              value={form.aviso_template_nome ?? ""}
              placeholder="nexa_aviso"
              disabled={!dados.admin}
              onChange={(e) => setForm({ ...form, aviso_template_nome: e.target.value })}
            />
          </div>
          <div className="grid gap-1 sm:col-span-2">
            <Label htmlFor="link-google">
              Link da avaliação no Google (a Alice usa no "Ficou ótimo")
            </Label>
            <Input
              id="link-google"
              value={form.link_avaliacao_google ?? ""}
              placeholder="https://g.page/r/..."
              disabled={!dados.admin}
              onChange={(e) => setForm({ ...form, link_avaliacao_google: e.target.value })}
            />
          </div>
        </div>
        {dados.admin && (
          <div>
            <Button disabled={salvando} onClick={salvar}>
              Salvar
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
