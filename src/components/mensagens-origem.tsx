import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { CRM_SERVICE_KIND, useCrmCampaigns, useCrmCatalog } from "@/lib/crm";
import { useConfigOptions } from "@/lib/data";

type MensagemOrigem = {
  id: string;
  texto: string;
  sales_origin_id: string;
  campaign_id: string | null;
  servico: string | null;
  descricao: string | null;
  ativo: boolean;
};

const CHAVE = ["mensagens_origem"];
const SELECT_CLASS =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const VAZIO = { texto: "", origem: "", campanha: "", servico: "", descricao: "" };

/**
 * Mensagens prontas dos links de WhatsApp de cada canal (wa.me/...?text=...). Quando a primeira
 * mensagem do cliente contém um desses textos, o lead recebe a origem (e a campanha e o serviço)
 * cadastrados aqui.
 */
export function MensagensOrigem() {
  const qc = useQueryClient();
  const origens = useConfigOptions("sales_origin", true);
  const campanhas = useCrmCampaigns(false);
  const servicos = useCrmCatalog(CRM_SERVICE_KIND, true);
  const lista = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("mensagens_origem")
        .select("id, texto, sales_origin_id, campaign_id, servico, descricao, ativo")
        .order("created_at");
      if (error) throw error;
      return (data ?? []) as MensagemOrigem[];
    },
  });

  const [form, setForm] = useState(VAZIO);
  const [editando, setEditando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [teste, setTeste] = useState("");
  const [resultado, setResultado] = useState<string | null>(null);

  const nomeOrigem = (id: string) => origens.data?.find((o) => o.id === id)?.name ?? "—";
  const nomeCampanha = (id: string | null) =>
    id ? (campanhas.data?.find((c) => c.id === id)?.campaign_name ?? "—") : null;
  const atualizar = () => void qc.invalidateQueries({ queryKey: CHAVE });

  async function salvar() {
    if (form.texto.trim().length < 3) {
      toast.error("Cole o texto da mensagem pronta.");
      return;
    }
    if (!form.origem) {
      toast.error("Escolha a origem.");
      return;
    }
    setOcupado(true);
    const dados = {
      texto: form.texto.trim(),
      sales_origin_id: form.origem,
      campaign_id: form.campanha || null,
      servico: form.servico || null,
      descricao: form.descricao.trim() || null,
    };
    const { error } = editando
      ? await supabase.from("mensagens_origem").update(dados).eq("id", editando)
      : await supabase.from("mensagens_origem").insert(dados as never);
    setOcupado(false);
    if (error) {
      toast.error(
        error.code === "23505"
          ? "Essa mensagem já está cadastrada."
          : "Não foi possível salvar a mensagem.",
      );
      return;
    }
    toast.success(editando ? "Mensagem atualizada." : "Mensagem cadastrada.");
    setForm(VAZIO);
    setEditando(null);
    atualizar();
  }

  async function alternar(m: MensagemOrigem) {
    const { error } = await supabase
      .from("mensagens_origem")
      .update({ ativo: !m.ativo })
      .eq("id", m.id);
    if (error) {
      toast.error("Não foi possível alterar.");
      return;
    }
    atualizar();
  }

  async function excluir(m: MensagemOrigem) {
    if (!window.confirm("Excluir esta mensagem? Os leads já identificados não mudam.")) return;
    const { error } = await supabase.from("mensagens_origem").delete().eq("id", m.id);
    if (error) {
      toast.error("Não foi possível excluir.");
      return;
    }
    toast.success("Mensagem excluída.");
    atualizar();
  }

  async function testar() {
    if (!teste.trim()) return;
    const { data, error } = await supabase.rpc("testar_origem_mensagem", { _texto: teste });
    if (error) {
      toast.error("Não foi possível testar agora.");
      return;
    }
    const r = (data ?? {}) as {
      origem?: string | null;
      campanha?: string | null;
      servico?: string | null;
    };
    setResultado(
      r.origem
        ? [
            `Origem: ${r.origem}`,
            r.campanha ? `campanha: ${r.campanha}` : null,
            r.servico ? `serviço: ${r.servico}` : null,
          ]
            .filter(Boolean)
            .join(" · ")
        : "Nenhuma origem identificada (o lead ficaria “Não identificada”).",
    );
  }

  async function reaplicar() {
    setOcupado(true);
    const { data, error } = await supabase.rpc("reaplicar_origem_leads");
    setOcupado(false);
    if (error) {
      toast.error("Não foi possível aplicar agora.");
      return;
    }
    const n = Number(data ?? 0);
    toast.success(
      n
        ? `${n} lead(s) sem origem foram identificados.`
        : "Nenhum lead sem origem foi identificado.",
    );
    void qc.invalidateQueries({ queryKey: ["crm_leads"] });
  }

  return (
    <section className="card-surface p-5">
      <h2 className="mb-1 text-lg font-semibold">Mensagens prontas dos links de WhatsApp</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Cadastre o texto que cada link de WhatsApp já traz pronto (site, blog, campanha do Google…).
        Quando a primeira mensagem do cliente tiver esse texto, o lead recebe a origem, a campanha e
        o serviço escolhidos aqui. Maiúsculas, acentos e pontuação não importam. Se duas mensagens
        combinarem, vale a mais longa.
      </p>

      <div className="grid gap-3 rounded-lg border border-border p-4 [&>*]:min-w-0">
        <div className="space-y-1">
          <Label htmlFor="mo-texto">Mensagem pronta</Label>
          <Textarea
            id="mo-texto"
            rows={2}
            value={form.texto}
            onChange={(e) => setForm({ ...form, texto: e.target.value })}
            placeholder="Ex.: Olá! Vi o blog e quero um orçamento."
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <div className="space-y-1">
            <Label htmlFor="mo-origem">Origem</Label>
            <select
              id="mo-origem"
              className={SELECT_CLASS}
              value={form.origem}
              onChange={(e) => setForm({ ...form, origem: e.target.value })}
            >
              <option value="">Escolha…</option>
              {(origens.data ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mo-campanha">Campanha (opcional)</Label>
            <select
              id="mo-campanha"
              className={SELECT_CLASS}
              value={form.campanha}
              onChange={(e) => setForm({ ...form, campanha: e.target.value })}
            >
              <option value="">Nenhuma</option>
              {(campanhas.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.campaign_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="mo-servico">Serviço de interesse (opcional)</Label>
            <select
              id="mo-servico"
              className={SELECT_CLASS}
              value={form.servico}
              onChange={(e) => setForm({ ...form, servico: e.target.value })}
            >
              <option value="">Não definir</option>
              {(servicos.data ?? []).map((s) => (
                <option key={s.id} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mo-descricao">Onde está o link (opcional)</Label>
          <Input
            id="mo-descricao"
            value={form.descricao}
            onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder="Ex.: botão do site, cupom BLOG50…"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void salvar()} disabled={ocupado}>
            {editando ? "Salvar alteração" : "Adicionar mensagem"}
          </Button>
          {editando ? (
            <Button
              variant="outline"
              onClick={() => {
                setEditando(null);
                setForm(VAZIO);
              }}
            >
              Cancelar
            </Button>
          ) : null}
          <Link to="/crm/campanhas" className="text-sm text-primary underline">
            Cadastrar campanha
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        {lista.isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : !lista.data?.length ? (
          <p className="text-sm text-muted-foreground">Nenhuma mensagem cadastrada ainda.</p>
        ) : (
          lista.data.map((m) => (
            <div
              key={m.id}
              className={`grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_auto] sm:items-center ${m.ativo ? "" : "opacity-60"}`}
            >
              <div className="min-w-0">
                <p className="break-words text-sm">“{m.texto}”</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    nomeOrigem(m.sales_origin_id),
                    nomeCampanha(m.campaign_id),
                    m.servico,
                    m.descricao,
                    m.ativo ? null : "desativada",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Editar mensagem"
                  onClick={() => {
                    setEditando(m.id);
                    setForm({
                      texto: m.texto,
                      origem: m.sales_origin_id,
                      campanha: m.campaign_id ?? "",
                      servico: m.servico ?? "",
                      descricao: m.descricao ?? "",
                    });
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void alternar(m)}>
                  {m.ativo ? "Desativar" : "Ativar"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Excluir mensagem"
                  onClick={() => void excluir(m)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-6 grid gap-3 border-t border-border pt-4 [&>*]:min-w-0">
        <div className="space-y-1">
          <Label htmlFor="mo-teste">Testar uma mensagem</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              id="mo-teste"
              className="min-w-0 flex-1"
              value={teste}
              onChange={(e) => {
                setTeste(e.target.value);
                setResultado(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") void testar();
              }}
              placeholder="Cole uma mensagem recebida para ver a origem identificada"
            />
            <Button variant="outline" onClick={() => void testar()}>
              Testar
            </Button>
          </div>
          {resultado ? <p className="text-sm">{resultado}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void reaplicar()} disabled={ocupado}>
            Aplicar aos leads sem origem
          </Button>
          <span className="text-xs text-muted-foreground">
            Revê as mensagens recebidas dos leads que estão “Não identificada”. Origem escolhida à
            mão nunca é trocada.
          </span>
        </div>
      </div>
    </section>
  );
}
