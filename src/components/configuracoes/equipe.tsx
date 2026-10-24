// Seção de Configurações (veio da antiga tela de abas).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useInvalidate, useSalespeople, useTechnicians } from "@/lib/data";
import { parseNumberBR } from "@/lib/format";
import { useContextoTenant } from "@/lib/tenant";
import { enviarFotoTecnico, useFotoTecnico } from "@/lib/equipe-fotos";

export function Equipe() {
  const { data: vendedoras } = useSalespeople(false);
  const { data: tecnicos } = useTechnicians(false);
  const { data: ctx } = useContextoTenant();
  const invalidate = useInvalidate();
  const empresaId = ctx?.ativa?.empresa.id ?? null;
  const membros = useMembrosDaEmpresa(empresaId);

  async function salvarComissao(id: string, valor: string) {
    const pct = parseNumberBR(valor);
    const { error } = await supabase
      .from("salespeople")
      .update({ commission_percentage: pct })
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível atualizar a comissão.");
      return;
    }
    toast.success("Comissão atualizada. Vale para novas OS.");
  }

  async function ativarVendedora(id: string, active: boolean) {
    const { error } = await supabase.from("salespeople").update({ active }).eq("id", id);
    if (error) {
      toast.error("Não foi possível salvar.");
      return;
    }
    invalidate("salespeople");
    toast.success(
      active ? "Vendedora ativada." : "Vendedora desativada. As OS antigas continuam com ela.",
    );
  }

  async function marcarNexa(id: string, atendente_nexa: boolean) {
    const { error } = await supabase
      .from("salespeople")
      .update({ atendente_nexa } as never)
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível salvar.");
      return;
    }
    invalidate("salespeople");
    toast.success(atendente_nexa ? "Marcada como atendente da Nexa." : "Desmarcada.");
  }

  async function ativarTecnico(id: string, active: boolean) {
    const { error } = await supabase.from("technicians").update({ active }).eq("id", id);
    if (error) {
      toast.error("Não foi possível salvar.");
      return;
    }
    invalidate("technicians");
    toast.success(active ? "Técnico ativado." : "Técnico desativado.");
  }

  async function salvarBase(id: string, valor: string) {
    const { error } = await supabase
      .from("technicians")
      .update({ base_address: valor })
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível salvar o endereço base.");
      return;
    }
    toast.success("Endereço base atualizado.");
  }

  async function salvarTelefone(id: string, valor: string) {
    const digitos = valor.replace(/\D/g, "");
    if (digitos && (digitos.length < 10 || digitos.length > 13)) {
      toast.error("Informe o WhatsApp com DDD, ex.: (11) 98888-7777.");
      return;
    }
    const { error } = await supabase
      .from("technicians")
      .update({ telefone: digitos || null })
      .eq("id", id);
    if (error) {
      toast.error(
        error.message.includes("inválido") ? error.message : "Não foi possível salvar o telefone.",
      );
      return;
    }
    invalidate("technicians");
    toast.success("Telefone do técnico atualizado.");
  }

  async function salvarEmail(id: string, valor: string) {
    const email = valor.trim();
    if (email && !email.includes("@")) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    const { error } = await supabase
      .from("technicians")
      .update({ email: email || null })
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível salvar o e-mail.");
      return;
    }
    toast.success("E-mail do técnico atualizado.");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="card-surface p-5">
        <h2 className="mb-1 text-lg font-semibold">Vendedoras e comissões</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Quem aparece em "Vendedora responsável" na ordem de serviço. Cadastrar alguém como usuário
          (atendente) não cria a vendedora: cadastre aqui também. Para as atendentes da Nexa, use o
          percentual do contrato com a Nexa (ex.: 5%): é o que a empresa paga à Nexa e aparece no
          DRE como "Comissão Nexa". Quem paga a atendente é a Nexa.
        </p>
        <div className="space-y-3">
          {(vendedoras ?? []).map((v) => (
            <div key={v.id} className="flex flex-wrap items-center gap-2">
              <p className={v.active ? "min-w-0 flex-1" : "min-w-0 flex-1 text-muted-foreground"}>
                {v.name}
                {v.atendente_nexa ? " · Nexa" : ""}
                {v.active ? "" : " (inativa)"}
              </p>
              <Input
                aria-label={`Comissão de ${v.name} (%)`}
                inputMode="decimal"
                defaultValue={String(v.commission_percentage).replace(".", ",")}
                onBlur={(e) => salvarComissao(v.id, e.target.value)}
                className="w-[88px]"
              />
              <span className="text-sm text-muted-foreground">%</span>
              <Button variant="outline" onClick={() => ativarVendedora(v.id, !v.active)}>
                {v.active ? "Desativar" : "Ativar"}
              </Button>
              {ctx?.souNexa ? (
                <label className="flex min-h-11 w-full items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="size-5"
                    checked={v.atendente_nexa === true}
                    onChange={(e) => marcarNexa(v.id, e.target.checked)}
                  />
                  Atendente da Nexa (a comissão vai para a Nexa)
                </label>
              ) : null}
              <LoginDaEquipe
                tabela="salespeople"
                id={v.id}
                userId={v.user_id ?? null}
                papel="atendente"
                membros={membros.data ?? []}
                ligados={(vendedoras ?? []).map((x) => x.user_id ?? null)}
                aoMudar={() => invalidate("salespeople")}
              />
            </div>
          ))}
          {vendedoras && !vendedoras.length ? (
            <p className="text-sm text-muted-foreground">Nenhuma vendedora cadastrada ainda.</p>
          ) : null}
        </div>
        <NovaVendedora
          ordem={(vendedoras ?? []).length + 1}
          souNexa={ctx?.souNexa ?? false}
          aoSalvar={() => invalidate("salespeople")}
        />
      </section>

      <section className="card-surface p-5">
        <h2 className="mb-4 text-lg font-semibold">Técnicos</h2>
        <div className="space-y-5">
          {(tecnicos ?? []).map((t) => (
            <div key={t.id} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <p
                  className={
                    t.active ? "flex-1 font-medium" : "flex-1 font-medium text-muted-foreground"
                  }
                >
                  {t.name}
                  {t.parceiro ? " · parceiro" : ""}
                  {t.active ? "" : " (inativo)"}
                </p>
                <Button variant="outline" onClick={() => ativarTecnico(t.id, !t.active)}>
                  {t.active ? "Desativar" : "Ativar"}
                </Button>
              </div>
              {t.parceiro ? (
                <p className="text-sm text-muted-foreground">
                  Terceirizado: não tem acesso ao app, e-mail, convite da Agenda nem avisos. Aparece
                  como responsável nas visitas dele, a Alice diz só o nome e fica fora do custo de
                  km.
                </p>
              ) : null}
              {empresaId && !t.parceiro ? (
                <FotoTecnico
                  empresaId={empresaId}
                  tecnicoId={t.id}
                  nome={t.name}
                  caminho={t.foto_path ?? null}
                  aoMudar={() => invalidate("technicians")}
                />
              ) : null}
              {t.parceiro ? null : (
                <>
                  <LoginDaEquipe
                    tabela="technicians"
                    id={t.id}
                    userId={t.user_id ?? null}
                    papel="tecnico"
                    membros={membros.data ?? []}
                    ligados={(tecnicos ?? []).map((x) => x.user_id ?? null)}
                    aoMudar={() => invalidate("technicians")}
                  />
                  <div className="space-y-2">
                    <Label>Endereço base</Label>
                    <Input
                      defaultValue={t.base_address ?? ""}
                      onBlur={(e) => salvarBase(t.id, e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>WhatsApp (recebe a agenda do dia seguinte)</Label>
                    <Input
                      type="tel"
                      inputMode="tel"
                      placeholder="(11) 98888-7777"
                      defaultValue={t.telefone ?? ""}
                      onBlur={(e) => {
                        if (e.target.value.replace(/\D/g, "") !== (t.telefone ?? ""))
                          void salvarTelefone(t.id, e.target.value);
                      }}
                    />
                    {t.telefone ? null : (
                      <p className="rounded-md bg-atencao px-3 py-2 text-sm text-atencao-foreground">
                        Sem telefone — não vai receber a agenda.
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label>E-mail (recebe o convite do Google Agenda)</Label>
                    <Input
                      type="email"
                      placeholder="tecnico@empresa.com.br"
                      defaultValue={t.email ?? ""}
                      onBlur={(e) => salvarEmail(t.id, e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          ))}
          {tecnicos && !tecnicos.length ? (
            <p className="text-sm text-muted-foreground">Nenhum técnico cadastrado ainda.</p>
          ) : null}
        </div>
        <NovoTecnico
          ordem={(tecnicos ?? []).length + 1}
          aoSalvar={() => invalidate("technicians")}
        />
      </section>
    </div>
  );
}

type Membro = { userId: string; papel: string; nome: string; email: string | null };

/** Pessoas com login nesta empresa (para ligar vendedora/técnico ao login). */
function useMembrosDaEmpresa(empresaId: string | null) {
  return useQuery({
    queryKey: ["equipe_empresa", empresaId, "membros"],
    enabled: Boolean(empresaId),
    queryFn: async (): Promise<Membro[]> => {
      const { data, error } = await supabase
        .from("usuarios_empresa")
        .select("user_id, papel")
        .eq("empresa_id", empresaId!);
      if (error) throw error;
      const ids = (data ?? []).map((m) => m.user_id);
      const perfis = ids.length
        ? ((await supabase.from("users_profiles").select("id, full_name, email").in("id", ids))
            .data ?? [])
        : [];
      return (data ?? []).map((m) => {
        const p = perfis.find((x) => x.id === m.user_id);
        return {
          userId: m.user_id,
          papel: String(m.papel),
          nome: p?.full_name || p?.email || "Usuário",
          email: p?.email ?? null,
        };
      });
    },
  });
}

/** Login ligado à vendedora/técnico: mostra quem é e permite ligar/desligar. */
function LoginDaEquipe({
  tabela,
  id,
  userId,
  papel,
  membros,
  ligados,
  aoMudar,
}: {
  tabela: "salespeople" | "technicians";
  id: string;
  userId: string | null;
  papel: "atendente" | "tecnico";
  membros: Membro[];
  ligados: Array<string | null>;
  aoMudar: () => void;
}) {
  const opcoes = membros.filter(
    (m) => m.papel === papel && (m.userId === userId || !ligados.includes(m.userId)),
  );
  async function ligar(novo: string) {
    const membro = membros.find((m) => m.userId === novo);
    const { error } = await supabase
      .from(tabela)
      .update(
        novo
          ? { user_id: novo, ...(membro?.email ? { email: membro.email } : {}) }
          : { user_id: null },
      )
      .eq("id", id);
    if (error) {
      toast.error("Não foi possível ligar ao login.");
      return;
    }
    toast.success(novo ? "Ligado ao login." : "Login desligado.");
    aoMudar();
  }
  if (!userId && !opcoes.length) return null;
  return (
    <label className="flex w-full flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Login:</span>
      <select
        className="min-h-11 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        value={userId ?? ""}
        onChange={(e) => void ligar(e.target.value)}
      >
        <option value="">Sem login</option>
        {opcoes.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.email ?? m.nome}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Foto do técnico (a Alice manda ao cliente com o nome). */
function FotoTecnico({
  empresaId,
  tecnicoId,
  nome,
  caminho,
  aoMudar,
}: {
  empresaId: string;
  tecnicoId: string;
  nome: string;
  caminho: string | null;
  aoMudar: () => void;
}) {
  const [versao, setVersao] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const url = useFotoTecnico(caminho, versao);
  async function enviar(arquivo: File | undefined) {
    if (!arquivo) return;
    setEnviando(true);
    try {
      await enviarFotoTecnico(empresaId, tecnicoId, arquivo);
      setVersao((v) => v + 1);
      toast.success("Foto salva. A Alice manda essa foto ao cliente.");
      aoMudar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar a foto.");
    } finally {
      setEnviando(false);
    }
  }
  return (
    <div className="flex items-center gap-3">
      {url.data ? (
        <img
          src={url.data}
          alt={`Foto de ${nome}`}
          className="size-16 shrink-0 rounded-full border border-border object-cover"
        />
      ) : (
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-xs text-muted-foreground">
          sem foto
        </div>
      )}
      <label className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-input px-4 text-sm font-medium">
        {enviando ? "Enviando…" : caminho ? "Trocar foto" : "Adicionar foto"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={enviando}
          onChange={(e) => void enviar(e.target.files?.[0])}
        />
      </label>
    </div>
  );
}

function NovaVendedora({
  ordem,
  souNexa,
  aoSalvar,
}: {
  ordem: number;
  souNexa: boolean;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [pct, setPct] = useState("3");
  const [nexa, setNexa] = useState(true);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const name = nome.trim();
    if (name.length < 2) {
      toast.error("Informe o nome da vendedora.");
      return;
    }
    const comissao = parseNumberBR(pct);
    if (!Number.isFinite(comissao) || comissao < 0 || comissao > 100) {
      toast.error("A comissão vai de 0% a 100%.");
      return;
    }
    const { data: iguais } = await supabase.from("salespeople").select("name");
    if ((iguais ?? []).some((x) => x.name.trim().toLowerCase() === name.toLowerCase())) {
      toast.error(`Já existe uma vendedora "${name}". Ajuste a que já está na lista.`);
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from("salespeople").insert({
      name,
      commission_percentage: comissao,
      display_order: ordem,
      // Só a Nexa marca quem é atendente dela (base da comissão da Nexa).
      ...(souNexa ? { atendente_nexa: nexa } : {}),
    } as never);
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível cadastrar a vendedora.");
      return;
    }
    toast.success(`${name} cadastrada. Já aparece na ordem de serviço.`);
    setNome("");
    aoSalvar();
  }

  return (
    <div className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-3">
      <p className="font-medium">Adicionar vendedora</p>
      <div className="grid grid-cols-[1fr_96px] gap-2">
        <div className="space-y-1">
          <Label htmlFor="nova-vendedora">Nome</Label>
          <Input
            id="nova-vendedora"
            value={nome}
            maxLength={60}
            placeholder="Ex.: Carol"
            onChange={(e) => setNome(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="nova-vendedora-pct">Comissão %</Label>
          <Input
            id="nova-vendedora-pct"
            inputMode="decimal"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
          />
        </div>
      </div>
      {souNexa ? (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="size-5"
            checked={nexa}
            onChange={(e) => setNexa(e.target.checked)}
          />
          Atendente da Nexa (entra na base da comissão da Nexa)
        </label>
      ) : null}
      <Button disabled={salvando} onClick={salvar}>
        Adicionar vendedora
      </Button>
    </div>
  );
}

function NovoTecnico({ ordem, aoSalvar }: { ordem: number; aoSalvar: () => void }) {
  const [nome, setNome] = useState("");
  const [base, setBase] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [parceiro, setParceiro] = useState(false);
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const name = nome.trim();
    if (name.length < 2) {
      toast.error("Informe o nome do técnico.");
      return;
    }
    const fone = parceiro ? "" : telefone.replace(/\D/g, "");
    if (!parceiro && (fone.length < 10 || fone.length > 13)) {
      toast.error("Informe o WhatsApp do técnico com DDD (é por ele que vai a agenda).");
      return;
    }
    const mail = parceiro ? "" : email.trim();
    if (mail && !mail.includes("@")) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    const { data: iguais } = await supabase.from("technicians").select("name, email");
    const repetido = (iguais ?? []).find(
      (x) =>
        x.name.trim().toLowerCase() === name.toLowerCase() ||
        (mail && (x.email ?? "").trim().toLowerCase() === mail.toLowerCase()),
    );
    if (repetido) {
      toast.error(`Já existe o técnico "${repetido.name}". Ajuste o que já está na lista.`);
      return;
    }
    setSalvando(true);
    const { error } = await supabase.from("technicians").insert({
      name,
      base_address: parceiro ? null : base.trim() || null,
      email: mail || null,
      telefone: fone || null,
      display_order: ordem,
      parceiro,
    } as never);
    setSalvando(false);
    if (error) {
      toast.error("Não foi possível cadastrar o técnico.");
      return;
    }
    toast.success(`${name} cadastrado.`);
    setNome("");
    setBase("");
    setEmail("");
    setTelefone("");
    setParceiro(false);
    aoSalvar();
  }

  return (
    <div className="mt-5 grid gap-3 rounded-lg border border-dashed border-border p-3">
      <p className="font-medium">Adicionar técnico</p>
      <div className="space-y-1">
        <Label htmlFor="novo-tecnico">Nome</Label>
        <Input
          id="novo-tecnico"
          value={nome}
          maxLength={60}
          onChange={(e) => setNome(e.target.value)}
        />
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <Switch
          checked={parceiro}
          onCheckedChange={setParceiro}
          aria-label="Parceiro terceirizado"
        />
        Parceiro terceirizado (não é da empresa: sem acesso, e-mail nem avisos)
      </label>
      {parceiro ? null : (
        <>
          <div className="space-y-1">
            <Label htmlFor="novo-tecnico-base">Endereço base (de onde sai)</Label>
            <Input id="novo-tecnico-base" value={base} onChange={(e) => setBase(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="novo-tecnico-telefone">WhatsApp (obrigatório: recebe a agenda)</Label>
            <Input
              id="novo-tecnico-telefone"
              type="tel"
              inputMode="tel"
              placeholder="(11) 98888-7777"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="novo-tecnico-email">E-mail (opcional)</Label>
            <Input
              id="novo-tecnico-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
        </>
      )}
      <Button disabled={salvando} onClick={salvar}>
        Adicionar técnico
      </Button>
    </div>
  );
}
