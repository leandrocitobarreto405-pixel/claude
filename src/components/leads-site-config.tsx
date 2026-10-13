import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { dateTimeBR } from "@/lib/format";
import {
  ativarEnvioLeadsSite,
  configLeadsSite,
  conferirPlanilhaLeads,
  salvarConfigLeadsSite,
  salvarPlanilhaLeads,
  type ConfigLeadsSite,
} from "@/lib/leads-site.functions";

const CHAVE = ["leads_site_config"];

const MODELO: Record<ConfigLeadsSite["situacaoModelo"], { texto: string; classe: string }> = {
  aprovado: { texto: "Modelo aprovado", classe: "bg-success text-success-foreground" },
  pendente: { texto: "Modelo pendente na Meta", classe: "bg-atencao text-atencao-foreground" },
  rejeitado: { texto: "Modelo rejeitado", classe: "bg-problema text-problema-foreground" },
  nao_existe: {
    texto: "Modelo não existe na Meta",
    classe: "bg-problema text-problema-foreground",
  },
  "?": { texto: "Não deu para conferir o modelo", classe: "bg-muted text-muted-foreground" },
};

const FORM_VAZIO = { id: "", nome: "", planilha: "", aba: "Leads", ativa: true };

/** Configurações → Leads do site: planilhas das LPs, aviso no app e envio automático. */
export function LeadsSiteConfig() {
  const qc = useQueryClient();
  const lerFn = useServerFn(configLeadsSite);
  const salvarPlanilhaFn = useServerFn(salvarPlanilhaLeads);
  const conferirFn = useServerFn(conferirPlanilhaLeads);
  const salvarFn = useServerFn(salvarConfigLeadsSite);
  const ativarFn = useServerFn(ativarEnvioLeadsSite);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => lerFn() });
  const [ocupado, setOcupado] = useState(false);
  const [planilha, setPlanilha] = useState(FORM_VAZIO);
  const [conferencia, setConferencia] = useState<string | null>(null);
  const [cfg, setCfg] = useState({
    avisoMinutos: "10",
    envioAposMinutos: "15",
    envioHoraInicio: "08:00",
    envioHoraFim: "20:00",
    envioModelo: "tc_lead_site",
  });
  useEffect(() => {
    if (!q.data) return;
    setCfg({
      avisoMinutos: String(q.data.avisoMinutos),
      envioAposMinutos: String(q.data.envioAposMinutos),
      envioHoraInicio: q.data.envioHoraInicio,
      envioHoraFim: q.data.envioHoraFim,
      envioModelo: q.data.envioModelo,
    });
  }, [q.data]);

  async function executar(acao: () => Promise<unknown>, ok: string) {
    setOcupado(true);
    try {
      await acao();
      toast.success(ok);
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  const dadosCfg = () => ({
    avisoMinutos: Number(cfg.avisoMinutos),
    envioAposMinutos: Number(cfg.envioAposMinutos),
    envioHoraInicio: cfg.envioHoraInicio,
    envioHoraFim: cfg.envioHoraFim,
    envioModelo: cfg.envioModelo,
  });

  async function conferir() {
    setOcupado(true);
    setConferencia(null);
    try {
      const r = await conferirFn({ data: { planilha: planilha.planilha, aba: planilha.aba } });
      if ("erro" in r && r.erro)
        setConferencia(`Não deu para ler: ${r.erro}${r.acao ? ` ${r.acao}` : ""}`);
      else if (r.faltam.length) setConferencia(`A aba não tem as colunas: ${r.faltam.join(", ")}.`);
      else
        setConferencia(
          `Tudo certo: ${r.linhas} cadastros na aba, ${r.colunas} colunas reconhecidas.`,
        );
    } catch (e) {
      setConferencia(e instanceof Error ? e.message : "Não deu para conferir.");
    } finally {
      setOcupado(false);
    }
  }

  const d = q.data;
  if (!d) return null;
  const campo = (k: keyof typeof cfg, v: string) => setCfg((c) => ({ ...c, [k]: v }));

  return (
    <div className="grid gap-6">
      <section className="card-surface grid gap-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">Planilhas das landing pages</h2>
          <p className="text-sm text-muted-foreground">
            O app lê só as linhas novas a cada 5 minutos, com a conta Google conectada em
            Configurações → Modelos de ordem de serviço. Nada é escrito na planilha. Colunas
            esperadas: Data e Hora, Nome, WhatsApp, Serviço, utm_source, utm_medium, utm_campaign,
            utm_term, utm_content, gclid, gbraid, wbraid, fbclid e Página.
          </p>
        </div>
        {d.planilhas.length ? (
          <ul className="grid gap-2">
            {d.planilhas.map((p) => (
              <li key={p.id} className="grid gap-2 rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{p.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      Aba “{p.aba}” · {p.ultimaLinha - 1} linhas lidas
                      {p.lidoEm ? ` · última leitura ${dateTimeBR(p.lidoEm)}` : " · ainda não lida"}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      p.ativa
                        ? "bg-success text-success-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {p.ativa ? "Lendo" : "Pausada"}
                  </span>
                </div>
                {p.erro ? (
                  <p className="rounded-md bg-problema px-2 py-1 text-xs text-problema-foreground">
                    {p.erro}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={ocupado}
                    onClick={() => {
                      setPlanilha({
                        id: p.id,
                        nome: p.nome,
                        planilha: p.planilhaId,
                        aba: p.aba,
                        ativa: p.ativa,
                      });
                      setConferencia(null);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    variant="outline"
                    className="min-h-11"
                    disabled={ocupado}
                    onClick={() =>
                      void executar(
                        () =>
                          salvarPlanilhaFn({
                            data: {
                              id: p.id,
                              nome: p.nome,
                              planilha: p.planilhaId,
                              aba: p.aba,
                              ativa: !p.ativa,
                            },
                          }),
                        p.ativa ? "Leitura pausada." : "Leitura retomada.",
                      )
                    }
                  >
                    {p.ativa ? "Pausar leitura" : "Retomar leitura"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Nenhuma planilha cadastrada.</p>
        )}

        <div className="grid gap-3 rounded-lg border border-border p-3">
          <p className="font-medium">{planilha.id ? "Editar planilha" : "Adicionar planilha"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo id="lp-nome" rotulo="Nome da LP">
              <Input
                id="lp-nome"
                value={planilha.nome}
                onChange={(e) => setPlanilha((f) => ({ ...f, nome: e.target.value }))}
              />
            </Campo>
            <Campo id="lp-aba" rotulo="Aba">
              <Input
                id="lp-aba"
                value={planilha.aba}
                onChange={(e) => setPlanilha((f) => ({ ...f, aba: e.target.value }))}
              />
            </Campo>
            <Campo id="lp-planilha" rotulo="Link da planilha do Google" largo>
              <Input
                id="lp-planilha"
                inputMode="url"
                placeholder="https://docs.google.com/spreadsheets/d/…"
                value={planilha.planilha}
                onChange={(e) => setPlanilha((f) => ({ ...f, planilha: e.target.value }))}
              />
            </Campo>
          </div>
          {conferencia ? <p className="text-sm">{conferencia}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={ocupado || !planilha.planilha.trim()}
              onClick={() => void conferir()}
            >
              Conferir planilha
            </Button>
            <Button
              className="min-h-11"
              disabled={ocupado}
              onClick={() =>
                void executar(async () => {
                  await salvarPlanilhaFn({
                    data: {
                      ...(planilha.id ? { id: planilha.id } : {}),
                      nome: planilha.nome,
                      planilha: planilha.planilha,
                      aba: planilha.aba,
                      ativa: planilha.ativa,
                    },
                  });
                  setPlanilha(FORM_VAZIO);
                  setConferencia(null);
                }, "Planilha salva.")
              }
            >
              Salvar planilha
            </Button>
            {planilha.id ? (
              <Button
                variant="ghost"
                className="min-h-11"
                onClick={() => {
                  setPlanilha(FORM_VAZIO);
                  setConferencia(null);
                }}
              >
                Cancelar
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="card-surface grid gap-4 p-5">
        <div>
          <h2 className="text-lg font-semibold">Avisos no app</h2>
          <p className="text-sm text-muted-foreground">
            Só no sino do app, nunca no WhatsApp: lead que não chamou depois do tempo abaixo e o
            resumo de ontem às 8h.
          </p>
        </div>
        <Campo id="lp-aviso" rotulo="Avisar quem não chamou depois de (minutos)">
          <Input
            id="lp-aviso"
            type="number"
            inputMode="numeric"
            min={5}
            max={120}
            className="max-w-32"
            value={cfg.avisoMinutos}
            onChange={(e) => campo("avisoMinutos", e.target.value)}
          />
        </Campo>
        <Button
          variant="outline"
          className="min-h-11 w-fit"
          disabled={ocupado}
          onClick={() => void executar(() => salvarFn({ data: dadosCfg() }), "Salvo.")}
        >
          Salvar
        </Button>
      </section>

      <section className="card-surface grid gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Mensagem automática para quem não chamou</h2>
            <p className="text-sm text-muted-foreground">
              Começa desligada. Ligada, manda o modelo uma vez para quem tem número válido e não
              chamou depois do tempo abaixo, só no horário escolhido e só para cadastros que
              chegarem depois de tocar em “Ativar”. Quando o lead responder, a Alice atende.
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              d.envioLigado
                ? "bg-success text-success-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {d.envioLigado ? "Ativo" : "Desligado"}
          </span>
        </div>
        <span
          className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${MODELO[d.situacaoModelo].classe}`}
        >
          {MODELO[d.situacaoModelo].texto}
        </span>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo id="lp-modelo" rotulo="Modelo (sem botões, só o nome como variável)">
            <Input
              id="lp-modelo"
              value={cfg.envioModelo}
              onChange={(e) => campo("envioModelo", e.target.value)}
            />
          </Campo>
          <Campo id="lp-apos" rotulo="Mandar depois de (minutos)">
            <Input
              id="lp-apos"
              type="number"
              inputMode="numeric"
              min={5}
              max={240}
              value={cfg.envioAposMinutos}
              onChange={(e) => campo("envioAposMinutos", e.target.value)}
            />
          </Campo>
          <Campo id="lp-inicio" rotulo="Das">
            <Input
              id="lp-inicio"
              type="time"
              value={cfg.envioHoraInicio}
              onChange={(e) => campo("envioHoraInicio", e.target.value)}
            />
          </Campo>
          <Campo id="lp-fim" rotulo="Até">
            <Input
              id="lp-fim"
              type="time"
              value={cfg.envioHoraFim}
              onChange={(e) => campo("envioHoraFim", e.target.value)}
            />
          </Campo>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={ocupado}
            onClick={() => void executar(() => salvarFn({ data: dadosCfg() }), "Salvo.")}
          >
            Salvar
          </Button>
          <Button
            className="min-h-11"
            variant={d.envioLigado ? "outline" : "default"}
            disabled={ocupado}
            onClick={() => {
              if (
                !d.envioLigado &&
                !window.confirm(
                  `Ativar a mensagem automática (${cfg.envioModelo}) para quem se cadastrar e não chamar em ${cfg.envioAposMinutos} minutos?`,
                )
              )
                return;
              void executar(
                async () => {
                  await salvarFn({ data: dadosCfg() });
                  await ativarFn({ data: { ligado: !d.envioLigado } });
                },
                d.envioLigado ? "Desativado: nenhuma mensagem automática sai." : "Ativado.",
              );
            }}
          >
            {d.envioLigado ? "Desativar" : "Ativar"}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Campo(props: { id: string; rotulo: string; largo?: boolean; children: React.ReactNode }) {
  return (
    <div className={`grid gap-1 ${props.largo ? "sm:col-span-2" : ""}`}>
      <Label htmlFor={props.id} className="text-xs">
        {props.rotulo}
      </Label>
      {props.children}
    </div>
  );
}
