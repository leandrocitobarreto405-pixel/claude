// Configurações › Vendas › Cupons: código, desconto em reais ou %, serviço, origem do lead,
// validade e ativo, por empresa. A Alice e o orçamento manual usam estes mesmos cupons. Não se
// apaga cupom: o que não vale mais fica inativo.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Botao, Chip, LinhaSwitch } from "@/components/nexa";
import { listarCuponsFn, salvarCupomFn } from "@/lib/cupons.functions";
import { CHAVE_CUPONS, limparCodigo, SERVICOS_CUPOM, type CupomTela } from "@/lib/cupons";
import { cupomNoPrazo, rotuloCupom } from "@/lib/alice/cupons";
import { parseNumberBR } from "@/lib/format";
import { mensagemDeErro } from "@/lib/erros";
import { usePapel } from "@/lib/tenant";

const NOVO: CupomTela = {
  id: null,
  codigo: "",
  tipo: "valor",
  quantia: 0,
  servico: "higienizacao",
  origemId: null,
  validoAte: null,
  ativo: true,
};

const campo = "min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base";

function hojeSP() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function dataBR(d: string) {
  return d.split("-").reverse().join("/");
}

export function CuponsConfig() {
  const listar = useServerFn(listarCuponsFn);
  const q = useQuery({ queryKey: CHAVE_CUPONS, queryFn: () => listar() });
  const { papel } = usePapel();
  const [editando, setEditando] = useState<CupomTela | null>(null);
  const admin = papel === "admin";

  if (q.isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (q.isError)
    return <p className="text-sm text-problema-foreground">Não foi possível carregar os cupons.</p>;
  const { cupons, origens } = q.data!;
  const nomeOrigem = (id: string | null) => origens.find((o) => o.id === id)?.nome ?? null;
  const hoje = hojeSP();

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        A Alice aplica o cupom que o cliente citar, e no orçamento manual basta digitar o código.
        Cada cupom vale para um serviço; com outro desconto (campanha, indicação), vale o maior.
      </p>
      {cupons.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum cupom ainda.</p>
      ) : (
        <ul className="grid gap-2">
          {cupons.map((c) => {
            const vencido = !cupomNoPrazo(c.validoAte, hoje);
            const origem = nomeOrigem(c.origemId);
            return editando?.id === c.id ? (
              <li key={c.id}>
                <FormCupom
                  inicial={editando}
                  origens={origens}
                  aoFechar={() => setEditando(null)}
                />
              </li>
            ) : (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-card border border-border bg-card p-3"
              >
                <div className="grid min-w-0 flex-1 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[15px] font-bold">{c.codigo}</span>
                    <span className="text-sm font-semibold">
                      {rotuloCupom(
                        c.tipo === "percentual"
                          ? { valor: null, percentual: c.quantia }
                          : { valor: c.quantia },
                      )}
                    </span>
                    {!c.ativo ? (
                      <Chip>Inativo</Chip>
                    ) : vencido ? (
                      <Chip tom="atencao">Vencido</Chip>
                    ) : (
                      <Chip tom="sucesso">Ativo</Chip>
                    )}
                  </div>
                  <p className="text-[13px] text-muted-foreground">
                    {SERVICOS_CUPOM.find((s) => s.valor === c.servico)?.rotulo}
                    {origem ? ` · ${origem}` : ""}
                    {c.validoAte ? ` · até ${dataBR(c.validoAte)}` : " · sem prazo"}
                  </p>
                </div>
                {admin ? (
                  <Botao
                    variante="neutro"
                    tamanho="icone"
                    aria-label={`Editar ${c.codigo}`}
                    onClick={() => setEditando(c)}
                  >
                    <Pencil aria-hidden />
                  </Botao>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {editando && editando.id === null ? (
        <FormCupom inicial={editando} origens={origens} aoFechar={() => setEditando(null)} />
      ) : admin ? (
        <div>
          <Botao variante="neutro" onClick={() => setEditando(NOVO)}>
            <Plus aria-hidden /> Novo cupom
          </Botao>
        </div>
      ) : null}
    </div>
  );
}

function FormCupom({
  inicial,
  origens,
  aoFechar,
}: {
  inicial: CupomTela;
  origens: { id: string; nome: string }[];
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const salvar = useServerFn(salvarCupomFn);
  const [c, setC] = useState(inicial);
  const [quantia, setQuantia] = useState(
    inicial.quantia ? String(inicial.quantia).replace(".", ",") : "",
  );
  const [ocupado, setOcupado] = useState(false);
  const id = inicial.id ?? "novo";

  async function gravar() {
    setOcupado(true);
    try {
      await salvar({ data: { ...c, quantia: parseNumberBR(quantia) } });
      toast.success(`Cupom ${limparCodigo(c.codigo)} salvo.`);
      await qc.invalidateQueries({ queryKey: CHAVE_CUPONS });
      aoFechar();
    } catch (e) {
      toast.error(mensagemDeErro(e, "Não foi possível salvar o cupom."));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-card border-[1.5px] border-marca bg-card p-3">
      <label className="grid gap-1 text-sm font-semibold">
        Código
        <input
          value={c.codigo}
          onChange={(e) => setC({ ...c, codigo: limparCodigo(e.target.value) })}
          placeholder="Ex.: SITE50"
          maxLength={30}
          autoCapitalize="characters"
          className={`${campo} font-mono uppercase`}
        />
      </label>
      <div className="grid gap-1">
        <span className="text-sm font-semibold">Desconto</span>
        <div className="flex gap-2">
          <div className="flex shrink-0 rounded-md border border-input p-0.5" role="group">
            {(["valor", "percentual"] as const).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={c.tipo === t}
                onClick={() => setC({ ...c, tipo: t })}
                className={`min-h-10 min-w-12 rounded px-3 text-sm font-bold ${
                  c.tipo === t ? "bg-marca text-marca-foreground" : "text-muted-foreground"
                }`}
              >
                {t === "valor" ? "R$" : "%"}
              </button>
            ))}
          </div>
          <input
            value={quantia}
            onChange={(e) => setQuantia(e.target.value)}
            inputMode="decimal"
            placeholder={c.tipo === "valor" ? "50,00" : "10"}
            aria-label={c.tipo === "valor" ? "Desconto em reais" : "Desconto em percentual"}
            className={campo}
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">
          Serviço
          <select
            value={c.servico}
            onChange={(e) => setC({ ...c, servico: e.target.value as CupomTela["servico"] })}
            className={campo}
          >
            {SERVICOS_CUPOM.map((s) => (
              <option key={s.valor} value={s.valor}>
                {s.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold">
          Origem do lead
          <select
            value={c.origemId ?? ""}
            onChange={(e) => setC({ ...c, origemId: e.target.value || null })}
            className={campo}
          >
            <option value="">Nenhuma</option>
            {origens.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold">
        Válido até (vazio = sem prazo)
        <input
          type="date"
          value={c.validoAte ?? ""}
          onChange={(e) => setC({ ...c, validoAte: e.target.value || null })}
          className={campo}
        />
      </label>
      <LinhaSwitch
        id={`cupom-ativo-${id}`}
        titulo="Ativo"
        descricao="Inativo: a Alice e o orçamento não aceitam mais."
        checked={c.ativo}
        onCheckedChange={(v) => setC({ ...c, ativo: v })}
      />
      <div className="flex flex-wrap gap-2">
        <Botao disabled={ocupado} onClick={() => void gravar()}>
          {ocupado ? "Salvando…" : "Salvar cupom"}
        </Botao>
        <Botao variante="neutro" disabled={ocupado} onClick={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </div>
  );
}
