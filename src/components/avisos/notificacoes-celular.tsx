import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BellRing, Send, Share, Smartphone } from "lucide-react";
import { Botao, Card, Chip, LinhaSwitch } from "@/components/nexa";
import {
  inscreverPushFn,
  removerPushFn,
  salvarPreferenciasPushFn,
  situacaoPushFn,
  testarPushFn,
} from "@/lib/push.functions";
import { TIPOS_PUSH, type PreferenciasPush } from "@/lib/push/notificacoes";
import {
  ativarNesteCelular,
  desativarNesteCelular,
  ehAndroid,
  ehIOS,
  inscricaoAtual,
  instalada,
  nomeDoAparelho,
  permissao,
  suportaPush,
} from "@/lib/push-cliente";
import { cn } from "@/lib/utils";

const CHAVE = ["push", "situacao"] as const;

type Aparelho = {
  suporta: boolean;
  ios: boolean;
  android: boolean;
  instalada: boolean;
  permissao: NotificationPermission | "indisponivel";
  endpoint: string | null;
};

/** Notificações no celular (Web Push da própria Nexa): ativar, escolher o que receber e testar. */
export function NotificacoesCelular() {
  const qc = useQueryClient();
  const lerFn = useServerFn(situacaoPushFn);
  const inscreverFn = useServerFn(inscreverPushFn);
  const removerFn = useServerFn(removerPushFn);
  const salvarFn = useServerFn(salvarPreferenciasPushFn);
  const testarFn = useServerFn(testarPushFn);
  const q = useQuery({ queryKey: CHAVE, queryFn: () => lerFn() });
  const s = q.data;
  const [ap, setAp] = useState<Aparelho | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pref, setPref] = useState<PreferenciasPush | null>(null);
  const [teste, setTeste] = useState<
    | { fase: "enviando" }
    | { fase: "esperando"; status: number | null }
    | { fase: "chegou" }
    | { fase: "nao_chegou"; status: number | null }
    | { fase: "falhou"; status: number | null }
    | null
  >(null);
  useEffect(() => setPref(s?.preferencias ?? null), [s?.preferencias]);

  const lerAparelho = useCallback(async () => {
    const sub = await inscricaoAtual().catch(() => null);
    setAp({
      suporta: suportaPush(),
      ios: ehIOS(),
      android: ehAndroid(),
      instalada: instalada(),
      permissao: permissao(),
      endpoint: sub?.endpoint ?? null,
    });
  }, []);
  useEffect(() => {
    void lerAparelho();
  }, [lerAparelho]);

  if (q.error)
    return (
      <Card className="text-sm">
        Não foi possível carregar as notificações:{" "}
        {q.error instanceof Error ? q.error.message : "erro desconhecido"}.
      </Card>
    );
  if (!s || !ap) return null;
  const ativoAqui = Boolean(
    ap.endpoint &&
    s.celulares.some((c) => c.endpoint === ap.endpoint) &&
    ap.permissao === "granted",
  );

  async function ativar() {
    if (!s) return;
    setOcupado(true);
    try {
      const sub = await ativarNesteCelular(s.chavePublica);
      await inscreverFn({ data: { ...sub, aparelho: nomeDoAparelho() } });
      await Promise.all([qc.invalidateQueries({ queryKey: CHAVE }), lerAparelho()]);
      toast.success("Notificações ativadas neste celular.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível ativar.");
      await lerAparelho();
    } finally {
      setOcupado(false);
    }
  }

  async function desativar() {
    setOcupado(true);
    try {
      const endpoint = await desativarNesteCelular();
      if (endpoint) await removerFn({ data: { endpoint } });
      await Promise.all([qc.invalidateQueries({ queryKey: CHAVE }), lerAparelho()]);
      toast.success("Notificações desativadas neste celular.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível desativar.");
    } finally {
      setOcupado(false);
    }
  }

  /** Teste só para este aparelho; espera o recibo (o aparelho confirma que recebeu) por 20 s. */
  async function testar() {
    if (!ap?.endpoint) return;
    setOcupado(true);
    setTeste({ fase: "enviando" });
    const inicio = Date.now();
    try {
      const r = await testarFn({ data: { endpoint: ap.endpoint } });
      if (r.semCelular) {
        setTeste(null);
        toast.error("Este celular não está ativado. Toque em Ativar.");
        return;
      }
      if (!r.enviados) {
        setTeste({ fase: "falhou", status: r.status });
        return;
      }
      setTeste({ fase: "esperando", status: r.status });
      for (let i = 0; i < 10; i++) {
        await new Promise((ok) => setTimeout(ok, 2000));
        const atual = await lerFn();
        const aqui = atual.celulares.find((c) => c.endpoint === ap.endpoint);
        if (aqui?.confirmadoEm && Date.parse(aqui.confirmadoEm) >= inicio - 5000) {
          setTeste({ fase: "chegou" });
          await qc.invalidateQueries({ queryKey: CHAVE });
          return;
        }
      }
      setTeste({ fase: "nao_chegou", status: r.status });
    } catch (e) {
      setTeste(null);
      toast.error(e instanceof Error ? e.message : "Não foi possível enviar o teste.");
    } finally {
      setOcupado(false);
    }
  }

  async function mudar(p: PreferenciasPush) {
    setPref(p);
    try {
      await salvarFn({ data: p });
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível salvar.");
    }
  }

  const precisaInstalar = ap.ios && !ap.instalada;
  const tipos = TIPOS_PUSH.filter((t) => s.tipos.includes(t.tipo));

  return (
    <Card>
      <div className="flex items-center gap-2">
        <BellRing className="size-5 text-marca" aria-hidden />
        <h2 className="flex-1 text-[15px] font-bold">Notificações no celular</h2>
        <Chip tom={ativoAqui ? "sucesso" : "neutro"}>
          {ativoAqui ? "Ativas aqui" : "Desligadas aqui"}
        </Chip>
      </div>
      <p className="text-sm text-muted-foreground">
        A Nexa avisa no seu celular, sem WhatsApp e sem custo. Cada pessoa ativa no próprio aparelho
        e escolhe o que quer receber.
      </p>

      {precisaInstalar ? (
        <div className="flex flex-col gap-2 rounded-botao bg-atencao p-3 text-sm text-atencao-foreground">
          <p className="font-bold">No iPhone, instale a Nexa primeiro:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Abra a Nexa no Safari.</li>
            <li>
              Toque em Compartilhar <Share className="inline size-4" aria-label="(ícone)" /> e
              depois em <b>Adicionar à Tela de Início</b>.
            </li>
            <li>Abra a Nexa pelo ícone novo e volte aqui em Avisos.</li>
          </ol>
          <p>Precisa do iOS 16.4 ou mais novo.</p>
        </div>
      ) : !ap.suporta ? (
        <p className="rounded-botao bg-atencao px-3 py-2 text-sm text-atencao-foreground">
          {ap.ios
            ? "Este iPhone não recebe notificações de app instalado. Atualize para o iOS 16.4 ou mais novo."
            : "Este navegador não recebe notificações. No Android, use o Chrome."}
        </p>
      ) : ap.permissao === "denied" ? (
        <div className="rounded-botao bg-problema p-3 text-sm text-problema-foreground">
          <p className="font-bold">As notificações estão bloqueadas neste celular.</p>
          {ap.ios ? (
            <p>Libere em Ajustes → Notificações → Nexa → Permitir Notificações.</p>
          ) : (
            <p>
              No Chrome: toque nos três pontos → Configurações → Configurações do site →
              Notificações e permita a Nexa. Depois volte aqui.
            </p>
          )}
        </div>
      ) : ativoAqui ? (
        <div className="flex flex-wrap gap-2">
          <Botao onClick={() => void testar()} disabled={ocupado}>
            <Send /> Enviar notificação de teste
          </Botao>
          <Botao variante="neutro" onClick={() => void desativar()} disabled={ocupado}>
            Desativar neste celular
          </Botao>
          {teste ? (
            <p
              role="status"
              className={cn(
                "w-full rounded-botao px-3 py-2 text-sm",
                teste.fase === "chegou"
                  ? "bg-success/12 text-success"
                  : teste.fase === "nao_chegou" || teste.fase === "falhou"
                    ? "bg-problema text-problema-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {teste.fase === "enviando"
                ? "Enviando o teste…"
                : teste.fase === "esperando"
                  ? `Enviado (o serviço de notificações respondeu ${teste.status ?? "?"}). Esperando o celular confirmar…`
                  : teste.fase === "chegou"
                    ? "Chegou neste celular ✔"
                    : teste.fase === "falhou"
                      ? `O serviço de notificações recusou (status ${teste.status ?? "?"}). Desative e ative de novo neste celular.`
                      : `O serviço aceitou (status ${teste.status ?? "?"}), mas este celular não confirmou em 20 s. Feche o app, abra de novo pelo ícone e teste outra vez; se continuar, desative e ative de novo.`}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Botao tamanho="grande" onClick={() => void ativar()} disabled={ocupado}>
            <Smartphone /> {ocupado ? "Ativando…" : "Ativar notificações neste celular"}
          </Botao>
          <p className="text-xs text-muted-foreground">
            {ap.ios
              ? "Toque em Permitir quando o iPhone perguntar."
              : ap.android
                ? "Toque em Permitir quando o Chrome perguntar. Para abrir como app, use a opção Instalar app do Chrome."
                : "Permita as notificações quando o navegador perguntar."}
          </p>
        </div>
      )}

      {s.celulares.length ? (
        <p className="text-xs text-muted-foreground">
          Ativas em: {s.celulares.map((c) => c.aparelho || "aparelho").join(", ")}.
        </p>
      ) : null}

      {pref && tipos.length ? (
        <fieldset className="flex flex-col gap-1 border-t border-border pt-3">
          <legend className="mb-1 text-sm font-bold">O que você quer receber</legend>
          {s.papel === "tecnico" ? (
            <p className="mb-1 text-xs text-muted-foreground">
              Como técnico, você recebe só os avisos da operação.
            </p>
          ) : null}
          {tipos.map((t) => (
            <div key={t.tipo} className="flex flex-col gap-2">
              <LinhaSwitch
                id={`push-${t.tipo}`}
                titulo={t.rotulo}
                descricao={t.descricao}
                checked={Boolean(pref[t.tipo])}
                onCheckedChange={(v) => void mudar({ ...pref, [t.tipo]: v })}
              />
              {t.tipo === "cliente_esperando" && pref.cliente_esperando ? (
                <p className="mb-2 pl-1 text-xs text-muted-foreground">
                  Um aviso só com todos os clientes esperando (os seus e os sem dono): aos 5 min,
                  com lembrete aos 10 min, no máximo a cada 15 min.
                </p>
              ) : null}
            </div>
          ))}
        </fieldset>
      ) : null}
    </Card>
  );
}
