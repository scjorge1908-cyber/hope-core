import { requireFinanceAccess } from '@/lib/financeiro/server'
import { agruparPorArea, type TabelaCatalogo } from '@/lib/sistema/banco'
import { Titulo } from '../../financeiro/titulo'
import s from '../../financeiro/financeiro.module.css'
import { ListaTabelas } from './lista'

export const metadata = { title: 'Banco de dados — HOPE CORE' }
export const dynamic = 'force-dynamic'

export default async function BancoPage() {
  const { supabase } = await requireFinanceAccess()
  const { data, error } = await supabase.rpc('db_catalogo')
  const tabelas = (data ?? []) as unknown as TabelaCatalogo[]
  const grupos = agruparPorArea(tabelas)
  const totalLinhas = tabelas.filter((t) => t.tipo !== 'visão').reduce((a, t) => a + (t.linhas ?? 0), 0)
  const semDescricao = tabelas.filter((t) => !t.area).length

  return (
    <>
      <Titulo titulo="Banco de dados">
        <p>
          Estas são as tabelas <strong>reais</strong> do Supabase do HOPE CORE — não é uma cópia. O que você muda aqui muda
          direto no banco, e cada mudança fica registrada (quem, quando, antes e depois) no fim da tela da tabela.
        </p>
        <p>
          Tabela nova criada no banco aparece aqui sozinha, no grupo “Sem descrição”, até alguém preencher para que ela
          serve. Visões (cálculos), históricos, usuários e configuração do sync abrem só para leitura. CPF, PIX, senhas e
          campos criptografados nunca aparecem.
        </p>
      </Titulo>
      <p className={s.muted} style={{ margin: '-4px 0 18px', fontSize: 14 }}>
        {tabelas.length} tabelas e visões · {totalLinhas.toLocaleString('pt-BR')} linhas nas tabelas
        {semDescricao > 0 && ` · ${semDescricao} sem descrição`}. Clique numa tabela para abrir.
      </p>
      {error && <div className={s.alertBad}>Não foi possível ler o banco: {error.message}</div>}
      <ListaTabelas grupos={grupos} />
    </>
  )
}
