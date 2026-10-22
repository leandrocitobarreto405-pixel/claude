import { Link } from "@tanstack/react-router";
import { LinhaSwitch, Recolhido } from "@/components/nexa";
import { Input } from "@/components/ui/input";
import { IntegerInput } from "@/components/ui/numeric-input";
import { Textarea } from "@/components/ui/textarea";
import { PAYMENT_TYPES } from "@/lib/data";
import { COLLECTION_RULES, collectionRuleLabel } from "@/lib/collection";
import { brl, dateBR } from "@/lib/format";
import type { NovaOs } from "@/lib/nova-os/useNovaOs";
import { CampoOrigem } from "@/components/origem/campo-origem";
import { Campo, CampoTexto, Secao, Seletor } from "./campos";

export function PassoVenda({ n, ehAdmin }: { n: NovaOs; ehAdmin: boolean }) {
  const { estado: e, mudar, listas, derivados: d } = n;
  const regra = e.regraCobranca || d.regraAutomatica;
  return (
    <div className="flex flex-col gap-3">
      <Secao titulo="Dados da venda">
        <div className="grid grid-cols-2 gap-3">
          <Campo
            id="nos-os"
            rotulo="Número da OS"
            dica={
              n.osDuplicada ? (
                <span className="text-problema-foreground">Este número já está em uso.</span>
              ) : undefined
            }
          >
            <Input
              id="nos-os"
              value={e.osNumber}
              onChange={(ev) => {
                mudar({ osNumber: ev.target.value });
                n.setOsDuplicada(false);
              }}
              onBlur={() => void n.verificarOs()}
            />
          </Campo>
          <Campo id="nos-data-venda" rotulo="Data da venda">
            <Input
              id="nos-data-venda"
              type="date"
              value={e.saleDate}
              onChange={(ev) => mudar({ saleDate: ev.target.value })}
            />
          </Campo>
        </div>
        <CampoOrigem
          id="nos-origem"
          opcoes={listas.origens}
          valor={e}
          detectadaId={e.origemDetectadaId || null}
          detectadaComo={e.origemDetectadaComo || null}
          buscando={n.buscandoOrigem}
          onMudar={mudar}
        />
        <Campo
          id="nos-vendedora"
          rotulo="Vendedora responsável"
          dica={
            listas.vendedoras.length === 0 ? (
              <>
                Nenhuma vendedora cadastrada nesta empresa.{" "}
                {ehAdmin ? (
                  <Link
                    to="/configuracoes/equipe"
                    className="font-semibold text-marca underline underline-offset-2"
                  >
                    Cadastrar em Configurações → Equipe
                  </Link>
                ) : (
                  "Peça ao administrador para cadastrar em Configurações → Equipe."
                )}
              </>
            ) : undefined
          }
        >
          <Seletor
            id="nos-vendedora"
            value={e.vendedoraId}
            onChange={(ev) => mudar({ vendedoraId: ev.target.value })}
          >
            <option value="">Selecione</option>
            {listas.vendedoras.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({Number(v.commission_percentage).toFixed(0)}%)
              </option>
            ))}
          </Seletor>
        </Campo>
      </Secao>

      <Secao titulo="Valores">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-bold">Soma dos itens</span>
            <span className="flex h-11 items-center text-[15px] font-bold">{brl(d.soma)}</span>
          </div>
          <Campo
            id="nos-negociado"
            rotulo="Valor negociado"
            dica={Math.abs(d.diferenca) >= 0.01 ? `Diferença: ${brl(d.diferenca)}` : undefined}
          >
            <Input
              id="nos-negociado"
              inputMode="decimal"
              value={e.valorNegociado}
              onChange={(ev) => mudar({ negociadoEditado: true, valorNegociado: ev.target.value })}
            />
          </Campo>
        </div>
        {Math.abs(d.diferenca) >= 0.01 ? (
          <Campo id="nos-motivo" rotulo="Motivo do ajuste comercial">
            <Seletor
              id="nos-motivo"
              value={
                listas.motivosAjuste.some((m) => m.name === e.motivoAjuste) ? e.motivoAjuste : ""
              }
              onChange={(ev) => mudar({ motivoAjuste: ev.target.value })}
            >
              <option value="">Selecione ou escreva abaixo</option>
              {listas.motivosAjuste.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name}
                </option>
              ))}
            </Seletor>
            <Input
              value={e.motivoAjuste}
              onChange={(ev) => mudar({ motivoAjuste: ev.target.value })}
              placeholder="Ex.: desconto de pacote"
              aria-label="Motivo do ajuste (texto)"
            />
          </Campo>
        ) : null}
        <div className="grid grid-cols-2 gap-3">
          <Campo id="nos-forma" rotulo="Forma de pagamento">
            <Seletor
              id="nos-forma"
              value={e.formaPagamento}
              onChange={(ev) => mudar({ formaPagamento: ev.target.value })}
            >
              {PAYMENT_TYPES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Seletor>
          </Campo>
          <Campo id="nos-parcelas" rotulo="Parcelas">
            <IntegerInput
              id="nos-parcelas"
              min={1}
              max={12}
              value={e.parcelas}
              onValueChange={(v) => mudar({ parcelas: Math.max(1, v) })}
            />
          </Campo>
        </div>
        <Campo
          id="nos-cobranca"
          rotulo="Momento da cobrança"
          dica="Define a instrução de pagamento enviada ao técnico no WhatsApp."
        >
          <Seletor
            id="nos-cobranca"
            value={e.regraCobranca}
            onChange={(ev) => mudar({ regraCobranca: ev.target.value })}
          >
            <option value="">Automático — {collectionRuleLabel(d.regraAutomatica)}</option>
            {COLLECTION_RULES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Seletor>
        </Campo>
        {regra === "specific_visit" ? (
          <Campo id="nos-visita-cobranca" rotulo="Atendimento em que o técnico deve cobrar">
            <Seletor
              id="nos-visita-cobranca"
              value={String(e.visitaCobranca)}
              onChange={(ev) => mudar({ visitaCobranca: Number(ev.target.value) })}
            >
              <option value="-1">Selecione o atendimento</option>
              {d.visitasCobranca.map((v, idx) => (
                <option key={idx} value={idx}>
                  {v.service_name || `Atendimento ${idx + 1}`} — {dateBR(v.scheduled_date)}
                </option>
              ))}
            </Seletor>
          </Campo>
        ) : null}
      </Secao>

      <Recolhido titulo="Observações e documento">
        <div className="flex flex-col gap-3 p-4">
          <CampoTexto
            id="nos-valor-texto"
            rotulo="Resumo do valor para o documento"
            placeholder="Ex.: R$ 1.200,00 em 3x no cartão"
            valor={e.valorTexto}
            aoMudar={(v) => mudar({ valorTexto: v })}
          />
          <CampoTexto
            id="nos-obs-pag"
            rotulo="Observações do pagamento"
            valor={e.obsPagamento}
            aoMudar={(v) => mudar({ obsPagamento: v })}
          />
          <CampoTexto
            id="nos-instrucao"
            rotulo="Instrução de pagamento personalizada"
            placeholder="Deixe em branco para gerar automaticamente"
            valor={e.instrucaoManual}
            aoMudar={(v) => mudar({ instrucaoManual: v })}
          />
          <Campo id="nos-obs-gerais" rotulo="Observações gerais da OS">
            <Textarea
              id="nos-obs-gerais"
              value={e.obsGerais}
              onChange={(ev) => mudar({ obsGerais: ev.target.value })}
            />
          </Campo>
        </div>
      </Recolhido>

      <LinhaSwitch
        id="nos-teste"
        titulo="OS de teste"
        descricao="Não conta nos números, não vai para o Google Ads nem para a Google Agenda."
        checked={e.ehTeste}
        onCheckedChange={(v) => mudar({ ehTeste: v })}
        className="rounded-card border border-border bg-card px-4"
      />
    </div>
  );
}
