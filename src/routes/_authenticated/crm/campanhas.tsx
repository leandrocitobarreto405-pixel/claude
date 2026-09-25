import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Megaphone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader, SectionCard } from "@/components/app-shell";
import { NativeSelect } from "@/components/crm-ui";
import { supabase } from "@/integrations/supabase/client";
import { CRM_SERVICE_KIND, useCrmCampaigns, useCrmCatalog, useCrmInvalidate } from "@/lib/crm";
import { brl, dateBR, parseNumberBR, todayISO } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/crm/campanhas")({
  head: () => ({
    meta: [
      { title: "Campanhas do CRM — Nexa OS" },
      {
        name: "description",
        content:
          "Campanhas de anúncios, vínculo com anúncios do WhatsApp e investimento por período.",
      },
      { property: "og:title", content: "Campanhas do CRM — Nexa OS" },
      {
        property: "og:description",
        content:
          "Campanhas de anúncios, vínculo com anúncios do WhatsApp e investimento por período.",
      },
    ],
  }),
  component: Campanhas,
});

const PLATAFORMAS = ["Meta Ads", "Google Ads", "Instagram", "Facebook", "TikTok", "Outro"];

function Campanhas() {
  const { data: campanhas, refetch } = useCrmCampaigns();
  const { data: servicos } = useCrmCatalog(CRM_SERVICE_KIND);
  const invalidate = useCrmInvalidate();
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);

  const investimentos = useQuery({
    queryKey: ["crm_investments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("campaign_investments")
        .select("id, campaign_id, reference_date, period_end_date, amount, notes")
        .order("reference_date", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const anunciosSemCampanha = useQuery({
    queryKey: ["crm_ads_sem_campanha"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("ad_id, referral_data")
        .is("campaign_id", null)
        .not("ad_id", "is", null)
        .limit(500);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data ?? []) {
        const id = String(row.ad_id);
        map.set(id, (map.get(id) ?? 0) + 1);
      }
      return [...map.entries()].map(([adId, leads]) => ({ adId, leads }));
    },
  });

  const [form, setForm] = useState({
    platform: "Meta Ads",
    campaign_name: "",
    campaign_external_id: "",
    ad_set_name: "",
    ad_name: "",
    ad_external_id: "",
    advertised_service: "",
  });

  function abrirNova(adId?: string) {
    setEditando(null);
    setForm({
      platform: "Meta Ads",
      campaign_name: "",
      campaign_external_id: "",
      ad_set_name: "",
      ad_name: "",
      ad_external_id: adId ?? "",
      advertised_service: "",
    });
    setAberto(true);
  }

  async function salvar() {
    if (!form.campaign_name.trim()) {
      toast.error("Informe o nome da campanha.");
      return;
    }
    const payload = {
      platform: form.platform || "Meta Ads",
      campaign_name: form.campaign_name.trim().slice(0, 160),
      campaign_external_id: form.campaign_external_id.trim().slice(0, 80) || null,
      ad_set_name: form.ad_set_name.trim().slice(0, 160) || null,
      ad_name: form.ad_name.trim().slice(0, 160) || null,
      ad_external_id: form.ad_external_id.trim().slice(0, 80) || null,
      advertised_service: form.advertised_service || null,
    };
    try {
      if (editando) {
        const { error } = await supabase
          .from("crm_campaigns")
          .update(payload as never)
          .eq("id", editando);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase
          .from("crm_campaigns")
          .insert(payload as never)
          .select("id")
          .single();
        if (error) throw error;
        // Vincula leads que chegaram por este anúncio e ficaram sem campanha.
        if (payload.ad_external_id) {
          await supabase
            .from("crm_leads")
            .update({ campaign_id: created.id } as never)
            .eq("ad_id", payload.ad_external_id)
            .is("campaign_id", null);
        }
      }
      toast.success("Campanha salva.");
      setAberto(false);
      invalidate();
      void refetch();
      void anunciosSemCampanha.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a campanha.");
    }
  }

  const totalPorCampanha = (id: string) =>
    (investimentos.data ?? [])
      .filter((i) => i.campaign_id === id)
      .reduce((s, i) => s + Number(i.amount ?? 0), 0);

  return (
    <>
      <PageHeader
        title="Campanhas"
        description="Cadastre as campanhas e o investimento para medir custo por lead e por venda."
        actions={
          <Button className="gap-2" onClick={() => abrirNova()}>
            <Plus className="size-4" /> Nova campanha
          </Button>
        }
      />

      {(anunciosSemCampanha.data ?? []).length > 0 ? (
        <div className="mb-4">
          <SectionCard
            title="Campanha não identificada"
            description="Anúncios que trouxeram leads e ainda não têm campanha cadastrada."
            accent="warning"
          >
            <div className="grid gap-2">
              {(anunciosSemCampanha.data ?? []).map((a) => (
                <div
                  key={a.adId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                >
                  <span className="font-mono text-xs">{a.adId}</span>
                  <span className="text-xs text-muted-foreground">{a.leads} lead(s)</span>
                  <Button size="sm" variant="outline" onClick={() => abrirNova(a.adId)}>
                    Criar campanha a partir deste anúncio
                  </Button>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      ) : null}

      {(campanhas ?? []).length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Nenhuma campanha cadastrada"
          description="Cadastre suas campanhas de anúncios para acompanhar investimento e retorno."
          action={<Button onClick={() => abrirNova()}>Nova campanha</Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {(campanhas ?? []).map((c) => (
            <SectionCard
              key={c.id}
              title={c.campaign_name}
              description={`${c.platform}${c.advertised_service ? ` · ${c.advertised_service}` : ""}`}
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditando(c.id);
                    setForm({
                      platform: c.platform,
                      campaign_name: c.campaign_name,
                      campaign_external_id: c.campaign_external_id ?? "",
                      ad_set_name: c.ad_set_name ?? "",
                      ad_name: c.ad_name ?? "",
                      ad_external_id: c.ad_external_id ?? "",
                      advertised_service: c.advertised_service ?? "",
                    });
                    setAberto(true);
                  }}
                >
                  Editar
                </Button>
              }
            >
              <p className="text-sm">
                Investimento total:{" "}
                <span className="font-semibold text-navy">{brl(totalPorCampanha(c.id))}</span>
              </p>
              {c.ad_external_id ? (
                <p className="text-xs text-muted-foreground">
                  Anúncio vinculado: {c.ad_external_id}
                </p>
              ) : (
                <p className="text-xs text-amber-700">
                  Sem id de anúncio: os leads precisarão ser vinculados manualmente.
                </p>
              )}
              <InvestimentoForm campaignId={c.id} onSaved={() => void investimentos.refetch()} />
              <ul className="mt-3 grid gap-1 text-xs text-muted-foreground">
                {(investimentos.data ?? [])
                  .filter((i) => i.campaign_id === c.id)
                  .slice(0, 6)
                  .map((i) => (
                    <li key={i.id}>
                      {dateBR(i.reference_date)}
                      {i.period_end_date ? ` a ${dateBR(i.period_end_date)}` : ""} · {brl(i.amount)}
                    </li>
                  ))}
              </ul>
            </SectionCard>
          ))}
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar campanha" : "Nova campanha"}</DialogTitle>
            <DialogDescription>
              O id do anúncio permite identificar automaticamente os leads que vêm dele.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="c-plat">Plataforma</Label>
              <NativeSelect
                id="c-plat"
                placeholder="Meta Ads"
                value={form.platform}
                onChange={(v) => setForm((p) => ({ ...p, platform: v }))}
                options={PLATAFORMAS.map((p) => ({ value: p, label: p }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-nome">Nome da campanha</Label>
              <Input
                id="c-nome"
                value={form.campaign_name}
                maxLength={160}
                onChange={(e) => setForm((p) => ({ ...p, campaign_name: e.target.value }))}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="c-conj">Conjunto de anúncios</Label>
                <Input
                  id="c-conj"
                  value={form.ad_set_name}
                  maxLength={160}
                  onChange={(e) => setForm((p) => ({ ...p, ad_set_name: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-anuncio">Anúncio</Label>
                <Input
                  id="c-anuncio"
                  value={form.ad_name}
                  maxLength={160}
                  onChange={(e) => setForm((p) => ({ ...p, ad_name: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-adid">ID do anúncio (source_id)</Label>
                <Input
                  id="c-adid"
                  value={form.ad_external_id}
                  maxLength={80}
                  onChange={(e) => setForm((p) => ({ ...p, ad_external_id: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-campid">ID da campanha</Label>
                <Input
                  id="c-campid"
                  value={form.campaign_external_id}
                  maxLength={80}
                  onChange={(e) => setForm((p) => ({ ...p, campaign_external_id: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-serv">Serviço anunciado</Label>
              <NativeSelect
                id="c-serv"
                value={form.advertised_service}
                onChange={(v) => setForm((p) => ({ ...p, advertised_service: v }))}
                options={(servicos ?? []).map((s) => ({ value: s.name, label: s.name }))}
              />
            </div>
            <Button onClick={salvar}>Salvar campanha</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InvestimentoForm({ campaignId, onSaved }: { campaignId: string; onSaved: () => void }) {
  const [inicio, setInicio] = useState(todayISO());
  const [fim, setFim] = useState("");
  const [valor, setValor] = useState("0,00");
  const [obs, setObs] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const amount = parseNumberBR(valor);
    if (amount <= 0) {
      toast.error("Informe um valor de investimento maior que zero.");
      return;
    }
    setSalvando(true);
    try {
      const { error } = await supabase.from("campaign_investments").insert({
        campaign_id: campaignId,
        reference_date: inicio,
        period_end_date: fim || null,
        amount,
        notes: obs.trim().slice(0, 300) || null,
      } as never);
      if (error) throw error;
      toast.success("Investimento registrado.");
      setValor("0,00");
      setObs("");
      onSaved();
    } catch {
      toast.error("Não foi possível registrar o investimento.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Registrar investimento
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label className="text-xs">Início</Label>
          <Input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Fim (opcional)</Label>
          <Input type="date" value={fim} onChange={(e) => setFim(e.target.value)} />
        </div>
        <div className="grid gap-1">
          <Label className="text-xs">Valor (R$)</Label>
          <Input value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" />
        </div>
      </div>
      <Textarea
        rows={2}
        maxLength={300}
        placeholder="Observações (opcional)"
        value={obs}
        onChange={(e) => setObs(e.target.value)}
      />
      <Button size="sm" onClick={salvar} disabled={salvando}>
        {salvando ? "Salvando..." : "Adicionar investimento"}
      </Button>
    </div>
  );
}
