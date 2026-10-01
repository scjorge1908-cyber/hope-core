'use server'

import { revalidatePath } from 'next/cache'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import type { Json } from '@/lib/financeiro/db-types'

export type Resultado = { ok: true } | { ok: false; erro: string }

function caminho(esquema: string, tabela: string) {
  revalidatePath('/sistema/banco')
  revalidatePath(`/sistema/banco/${esquema}/${tabela}`)
}

/** Mensagens do banco em português simples. */
function traduzir(msg: string): string {
  if (/Could not find the function public\.db_excluir/i.test(msg) || /function public\.db_excluir.*does not exist/i.test(msg))
    return 'A exclusão de linhas ainda não foi ativada no banco. Criar e editar já funcionam.'
  if (/duplicate key value/i.test(msg)) return 'Já existe uma linha com essa chave (valor repetido).'
  if (/null value in column "([^"]+)"/i.test(msg)) return `A coluna “${msg.match(/null value in column "([^"]+)"/i)![1]}” é obrigatória.`
  if (/violates foreign key constraint/i.test(msg)) return 'Essa linha está ligada a outra tabela (relação). Ajuste ou exclua primeiro a linha ligada.'
  if (/violates check constraint/i.test(msg)) return `Valor não permitido nessa coluna (${msg}).`
  if (/invalid input syntax for type ([a-z ]+)/i.test(msg)) return `Valor no formato errado para ${msg.match(/invalid input syntax for type ([a-z ]+)/i)![1]}.`
  return msg
}

/** Cria (chave = null) ou edita uma linha. valores: só as colunas alteradas. */
export async function salvarLinha(
  esquema: string,
  tabela: string,
  chave: Record<string, unknown> | null,
  valores: Record<string, unknown>
): Promise<Resultado> {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return { ok: false, erro: 'Sem acesso.' }
  const { error } = await supabase.rpc('db_salvar', {
    p_esquema: esquema,
    p_tabela: tabela,
    p_chave: chave as Json,
    p_valores: valores as Json,
  })
  if (error) return { ok: false, erro: traduzir(error.message) }
  caminho(esquema, tabela)
  return { ok: true }
}

export async function excluirLinha(esquema: string, tabela: string, chave: Record<string, unknown>): Promise<Resultado> {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return { ok: false, erro: 'Sem acesso.' }
  const { error } = await supabase.rpc('db_excluir', { p_esquema: esquema, p_tabela: tabela, p_chave: chave as Json })
  if (error) return { ok: false, erro: traduzir(error.message) }
  caminho(esquema, tabela)
  return { ok: true }
}

/** Descrição da tabela (coluna = null) ou de uma coluna. */
export async function descrever(
  esquema: string,
  tabela: string,
  coluna: string | null,
  campos: Record<string, string>
): Promise<Resultado> {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return { ok: false, erro: 'Sem acesso.' }
  const { error } = await supabase.rpc('db_descrever', {
    p_esquema: esquema,
    p_tabela: tabela,
    p_coluna: coluna,
    p_campos: campos as Json,
  })
  if (error) return { ok: false, erro: traduzir(error.message) }
  caminho(esquema, tabela)
  return { ok: true }
}
