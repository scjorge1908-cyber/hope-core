'use server'

import { revalidatePath } from 'next/cache'
import { requireFinanceAccess } from '@/lib/financeiro/server'
import { parseTissStatement, TissParseError } from '@/lib/financeiro/tiss-parser'
import { toImportPayload, type ImportResult } from '@/lib/financeiro/import-payload'

const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_FILES = 12

export interface FileOutcome {
  fileName: string
  ok: boolean
  title: string
  details: string[]
  divergences: string[]
}

export interface ImportState {
  outcomes: FileOutcome[]
  error?: string
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export async function importarDemonstrativos(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { supabase, allowed } = await requireFinanceAccess()
  if (!allowed) return { outcomes: [], error: 'Sem permissão para importar.' }

  const files = formData.getAll('arquivos').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length === 0) return { outcomes: [], error: 'Escolha pelo menos um arquivo XML.' }
  if (files.length > MAX_FILES) return { outcomes: [], error: `Envie no máximo ${MAX_FILES} arquivos por vez.` }

  const outcomes: FileOutcome[] = []

  // Um arquivo por vez: cada importação é uma transação própria no banco.
  for (const file of files) {
    const fileName = file.name.slice(0, 200)
    if (!fileName.toLowerCase().endsWith('.xml')) {
      outcomes.push({ fileName, ok: false, title: 'Não é um arquivo .xml', details: [], divergences: [] })
      continue
    }
    if (file.size > MAX_FILE_BYTES) {
      outcomes.push({ fileName, ok: false, title: 'Arquivo maior que 5 MB', details: [], divergences: [] })
      continue
    }

    let parsed
    try {
      parsed = parseTissStatement(new Uint8Array(await file.arrayBuffer()), fileName)
    } catch (e) {
      const msg = e instanceof TissParseError ? e.message : 'Erro inesperado ao ler o arquivo.'
      if (!(e instanceof TissParseError)) console.error('[financeiro/importar] parse', e)
      outcomes.push({ fileName, ok: false, title: msg, details: [], divergences: [] })
      continue
    }

    const { data, error } = await supabase.rpc('import_claim_statement', { p: toImportPayload(parsed) })
    if (error) {
      console.error('[financeiro/importar] rpc', error)
      outcomes.push({ fileName, ok: false, title: `Erro ao gravar: ${error.message}`, details: [], divergences: [] })
      continue
    }

    const r = data as unknown as ImportResult
    const head = `Demonstrativo ${parsed.statementNumber} (emitido ${parsed.emissionDate.split('-').reverse().join('/')})`
    if (r.status === 'duplicate_file') {
      outcomes.push({
        fileName,
        ok: true,
        title: `${head}: este arquivo já tinha sido importado. Nada foi alterado.`,
        details: [],
        divergences: [],
      })
    } else if (r.status === 'statement_number_conflict') {
      outcomes.push({
        fileName,
        ok: false,
        title: `${head}: já existe um demonstrativo com esse número, importado de OUTRO arquivo. Confira se a operadora reenviou uma versão corrigida antes de substituir.`,
        details: [],
        divergences: [],
      })
    } else {
      outcomes.push({
        fileName,
        ok: true,
        title: `${head}: importado.`,
        details: [
          `${r.items} sessões — ${r.new} novas, ${r.updated} atualizadas (reprocessadas pela operadora), ${r.unchanged} sem mudança`,
          `Informado ${brl(parsed.itemTotals.informedCents)} · Liberado ${brl(parsed.itemTotals.releasedCents)} · Glosado ${brl(parsed.itemTotals.glossCents)}`,
        ],
        divergences: parsed.divergences,
      })
    }
  }

  // demonstrativo importado → recebimento previsto na Agenda (dia 25 do mês seguinte)
  if (outcomes.some((o) => o.ok)) await supabase.rpc('previstos_demonstrativos_sync')
  revalidatePath('/financeiro')
  revalidatePath('/financeiro/agenda')
  return { outcomes }
}
