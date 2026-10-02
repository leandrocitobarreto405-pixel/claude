import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Check, CircleDashed, Clock, MinusCircle, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Botao, Card, Chip, type TomChip } from "@/components/nexa";
import { ROTULO_RESPONSAVEL, textoProgresso, type Etapa, type Resumo } from "@/lib/implantacao";
import { marcarEtapaFn, salvarDadosEmpresaFn } from "@/lib/implantacao.functions";
import { cn } from "@/lib/utils";

export const CHAVE_IMPLANTACAO = ["implantacao"] as const;

const SITUACAO: Record<Etapa["situacao"], { rotulo: string; tom: TomChip; icone: typeof Check }> = {
  pronta: { rotulo: "Pronta", tom: "sucesso", icone: Check },
  falta: { rotulo: "Falta", tom: "atencao", icone: CircleDashed },
  aguardando: { rotulo: "Aguardando", tom: "neutro", icone: Clock },
  nao_se_aplica: { rotulo: "Não se aplica", tom: "neutro", icone: MinusCircle },
};

/** Barra de progresso das obrigatórias + texto "6 de 9 obrigatórias · 2 de 5 opcionais". */
export function ProgressoImplantacao({
  resumo,
  className,
}: {
  resumo: Resumo;
  className?: string;
}) {
  const { prontas, total } = resumo.obrigatorias;
  const pct = total ? Math.round((prontas / total) * 100) : 0;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={prontas}
        aria-label="Etapas obrigatórias prontas"
      >
        <div className="h-full rounded-full bg-marca transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-muted-foreground">{textoProgresso(resumo)}</p>
    </div>
  );
}

function separar(para: string): { to: string; search: Record<string, string> } {
  const [to, qs] = para.split("?");
  return { to: to ?? "/", search: Object.fromEntries(new URLSearchParams(qs ?? "")) };
}

function DadosDaEmpresa({ etapa }: { etapa: Etapa }) {
  const qc = useQueryClient();
  const salvarFn = useServerFn(salvarDadosEmpresaFn);
  const [aberto, setAberto] = useState(false);
  const [cnpj, setCnpj] = useState("");
  const [telefone, setTelefone] = useState("");
  const [salvando, setSalvando] = useState(false);
  if (!aberto)
    return (
      <Botao variante="contorno" className="self-start" onClick={() => setAberto(true)}>
        Preencher dados
      </Botao>
    );
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSalvando(true);
        salvarFn({ data: { cnpj, telefone } })
          .then(async () => {
            await qc.invalidateQueries({ queryKey: CHAVE_IMPLANTACAO });
            toast.success("Dados salvos.");
            setAberto(false);
          })
          .catch((err: unknown) =>
            toast.error(err instanceof Error ? err.message : "Não foi possível salvar."),
          )
          .finally(() => setSalvando(false));
      }}
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor={`cnpj-${etapa.chave}`}>CNPJ</Label>
        <Input
          id={`cnpj-${etapa.chave}`}
          inputMode="numeric"
          placeholder="00.000.000/0001-00"
          value={cnpj}
          onChange={(e) => setCnpj(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`tel-${etapa.chave}`}>Telefone</Label>
        <Input
          id={`tel-${etapa.chave}`}
          inputMode="tel"
          placeholder="(11) 99999-0000"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Campo vazio fica como está. O nome da empresa a Nexa muda, se precisar.
      </p>
      <div className="flex gap-2">
        <Botao type="submit" disabled={salvando}>
          {salvando ? "Salvando…" : "Salvar"}
        </Botao>
        <Botao type="button" variante="neutro" onClick={() => setAberto(false)}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}

function FormasDoWhatsApp() {
  return (
    <div className="flex flex-col gap-2 rounded-botao bg-background p-3 text-sm">
      <p>
        <b>Pelo Chatwoot (como hoje):</b> a Nexa cria a caixa da empresa no Chatwoot e liga ao
        número. A equipe atende pelo Chatwoot e a Alice responde por lá.
      </p>
      <p>
        <b>Direto pela Meta, com coexistência:</b> o número continua no WhatsApp Business do celular
        e também fica ligado à API da Meta. Essa forma ainda não está disponível no Nexa.
      </p>
    </div>
  );
}

function CartaoEtapa({ etapa, editavel }: { etapa: Etapa; editavel: boolean }) {
  const qc = useQueryClient();
  const marcarFn = useServerFn(marcarEtapaFn);
  const [marcando, setMarcando] = useState(false);
  const s = SITUACAO[etapa.situacao];
  const Icone = s.icone;

  async function marcar(situacao: "revisado" | "nao_se_aplica" | "pendente") {
    setMarcando(true);
    try {
      await marcarFn({ data: { etapa: etapa.chave, situacao } });
      await qc.invalidateQueries({ queryKey: CHAVE_IMPLANTACAO });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível marcar.");
    } finally {
      setMarcando(false);
    }
  }

  const link =
    etapa.resolver && (etapa.situacao === "falta" || etapa.situacao === "aguardando")
      ? separar(etapa.resolver.para)
      : null;
  return (
    <li>
      <Card className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "mt-0.5 grid size-8 shrink-0 place-items-center rounded-full",
              etapa.situacao === "pronta"
                ? "bg-marca text-marca-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Icone className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="font-bold leading-tight">{etapa.titulo}</h3>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{etapa.detalhe}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip tom={s.tom}>{s.rotulo}</Chip>
              <Chip>Responsável: {ROTULO_RESPONSAVEL[etapa.responsavel]}</Chip>
            </div>
          </div>
        </div>
        {etapa.chave === "whatsapp" && etapa.situacao !== "pronta" ? <FormasDoWhatsApp /> : null}
        {editavel && etapa.chave === "dados" && etapa.situacao !== "pronta" ? (
          <DadosDaEmpresa etapa={etapa} />
        ) : null}
        {editavel && (link || etapa.podeRevisar || etapa.podeNaoSeAplica) ? (
          <div className="flex flex-wrap gap-2">
            {link ? (
              <Botao asChild>
                <Link to={link.to as never} search={link.search as never}>
                  {etapa.resolver?.rotulo ?? "Resolver"} <ArrowRight />
                </Link>
              </Botao>
            ) : null}
            {etapa.podeRevisar && etapa.situacao !== "pronta" ? (
              <Botao
                variante="contorno"
                disabled={marcando}
                onClick={() => void marcar("revisado")}
              >
                Revisei
              </Botao>
            ) : null}
            {etapa.podeRevisar && etapa.marcada === "revisado" ? (
              <Botao variante="neutro" disabled={marcando} onClick={() => void marcar("pendente")}>
                Desfazer "Revisei"
              </Botao>
            ) : null}
            {etapa.podeNaoSeAplica && etapa.situacao === "falta" ? (
              <Botao
                variante="neutro"
                disabled={marcando}
                onClick={() => void marcar("nao_se_aplica")}
              >
                Não se aplica
              </Botao>
            ) : null}
            {etapa.situacao === "nao_se_aplica" ? (
              <Botao variante="neutro" disabled={marcando} onClick={() => void marcar("pendente")}>
                Voltar a valer
              </Botao>
            ) : null}
          </div>
        ) : null}
      </Card>
    </li>
  );
}

/** As duas listas (obrigatórias e opcionais). `editavel` = admin da empresa ativa. */
export function ListaEtapas({ etapas, editavel }: { etapas: Etapa[]; editavel: boolean }) {
  const grupos = [
    {
      titulo: "Obrigatórias",
      descricao: "Sem elas a Alice e os envios ficam desligados.",
      lista: etapas.filter((e) => e.obrigatoria),
    },
    {
      titulo: "Opcionais",
      descricao: "Ajudam no dia a dia, mas não travam nada.",
      lista: etapas.filter((e) => !e.obrigatoria),
    },
  ];
  return (
    <>
      {grupos.map((g) => (
        <section key={g.titulo} className="flex flex-col gap-3" aria-label={g.titulo}>
          <div>
            <h2 className="text-lg font-bold">{g.titulo}</h2>
            <p className="text-sm text-muted-foreground">{g.descricao}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {g.lista.map((e) => (
              <CartaoEtapa key={e.chave} etapa={e} editavel={editavel} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
