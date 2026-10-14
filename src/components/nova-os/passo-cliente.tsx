import { Botao, Recolhido } from "@/components/nexa";
import { Campo, CampoTexto, Secao } from "./campos";
import { Input } from "@/components/ui/input";
import type { NovaOs } from "@/lib/nova-os/useNovaOs";

export function PassoCliente({ n }: { n: NovaOs }) {
  const { estado: e, mudar } = n;
  return (
    <div className="flex flex-col gap-3">
      <Secao titulo="Quem é o cliente">
        <Campo id="nos-telefone" rotulo="Telefone com DDD">
          <div className="flex gap-2">
            <Input
              id="nos-telefone"
              inputMode="tel"
              value={e.telefone}
              onChange={(ev) => mudar({ telefone: ev.target.value })}
              placeholder="(11) 99999-9999"
            />
            <Botao variante="contorno" onClick={() => void n.buscarCliente()}>
              Buscar
            </Botao>
          </div>
        </Campo>
        {e.clienteExistente ? (
          <p className="text-xs text-muted-foreground">
            Cliente já cadastrado: os dados abaixo vêm do cadastro.
          </p>
        ) : null}
        <CampoTexto
          id="nos-nome"
          rotulo="Nome completo"
          valor={e.nome}
          aoMudar={(v) => mudar({ nome: v })}
        />
        <Recolhido titulo="E-mail e CPF/CNPJ (opcional)">
          <div className="flex flex-col gap-3 p-4">
            <CampoTexto
              id="nos-email"
              rotulo="E-mail"
              type="email"
              valor={e.email}
              aoMudar={(v) => mudar({ email: v })}
            />
            <CampoTexto
              id="nos-documento"
              rotulo="CPF ou CNPJ"
              valor={e.documento}
              aoMudar={(v) => mudar({ documento: v })}
            />
          </div>
        </Recolhido>
      </Secao>

      <Secao titulo="Endereço do serviço">
        <Campo id="nos-cep" rotulo="CEP">
          <div className="flex gap-2">
            <Input
              id="nos-cep"
              inputMode="numeric"
              value={e.cep}
              onChange={(ev) => mudar({ cep: ev.target.value })}
            />
            <Botao variante="contorno" onClick={() => void n.buscarCep()}>
              Buscar
            </Botao>
          </div>
        </Campo>
        <CampoTexto id="nos-rua" rotulo="Rua" valor={e.rua} aoMudar={(v) => mudar({ rua: v })} />
        <div className="grid grid-cols-2 gap-3">
          <CampoTexto
            id="nos-numero"
            rotulo="Número"
            valor={e.numero}
            aoMudar={(v) => mudar({ numero: v })}
          />
          <CampoTexto
            id="nos-complemento"
            rotulo="Complemento"
            valor={e.complemento}
            aoMudar={(v) => mudar({ complemento: v })}
          />
        </div>
        <CampoTexto
          id="nos-bairro"
          rotulo="Bairro"
          valor={e.bairro}
          aoMudar={(v) => mudar({ bairro: v })}
        />
        <div className="grid grid-cols-[1fr_5rem] gap-3">
          <CampoTexto
            id="nos-cidade"
            rotulo="Cidade"
            valor={e.cidade}
            aoMudar={(v) => mudar({ cidade: v })}
          />
          <CampoTexto
            id="nos-uf"
            rotulo="UF"
            maxLength={2}
            valor={e.uf}
            aoMudar={(v) => mudar({ uf: v })}
          />
        </div>
        <CampoTexto
          id="nos-referencia"
          rotulo="Ponto de referência"
          valor={e.referencia}
          aoMudar={(v) => mudar({ referencia: v })}
        />
        {n.derivados.enderecoCompleto ? (
          <p className="text-xs text-muted-foreground">
            Endereço completo: {n.derivados.enderecoCompleto}
          </p>
        ) : null}
      </Secao>
    </div>
  );
}
