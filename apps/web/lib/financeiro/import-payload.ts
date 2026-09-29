import type { ParsedStatement } from './tiss-parser'

/**
 * Converte o demonstrativo lido para o JSON que a função
 * import_claim_statement(p jsonb) do banco espera.
 * Valores seguem em CENTAVOS inteiros; o banco divide por 100.
 */
export function toImportPayload(s: ParsedStatement) {
  return {
    fileName: s.fileName,
    fileSha256: s.fileSha256,
    tissVersion: s.tissVersion,
    operatorAnsCode: s.operatorAnsCode,
    operatorName: s.operatorName,
    operatorCnpj: s.operatorCnpj,
    providerCode: s.providerCode,
    contractedName: s.contractedName,
    statementNumber: s.statementNumber,
    emissionDate: s.emissionDate,
    declaredTotals: s.declaredTotals,
    itemTotals: s.itemTotals,
    divergences: s.divergences,
    items: s.items.map((i) => ({
      lotNumber: i.lotNumber,
      protocolNumber: i.protocolNumber,
      protocolSituation: i.protocolSituation,
      providerGuideNumber: i.providerGuideNumber,
      operatorGuideNumber: i.operatorGuideNumber,
      authPassword: i.authPassword,
      beneficiaryName: i.beneficiaryName,
      cardNumber: i.cardNumber,
      billingStartDate: i.billingStartDate,
      billingStartTime: i.billingStartTime,
      billingEndDate: i.billingEndDate,
      billingEndTime: i.billingEndTime,
      guideSituation: i.guideSituation,
      guideItemSequence: i.guideItemSequence,
      realizationDate: i.realizationDate,
      procedureTable: i.procedureTable,
      procedureCode: i.procedureCode,
      procedureDescription: i.procedureDescription,
      participationDegree: i.participationDegree,
      quantity: i.quantity,
      informedCents: i.informedCents,
      processedCents: i.processedCents,
      releasedCents: i.releasedCents,
      glossCents: i.glossCents,
      glosses: i.glosses,
      occurrence: i.occurrence,
      itemKey: i.itemKey,
      contentHash: i.contentHash,
    })),
  }
}

export type ImportPayload = ReturnType<typeof toImportPayload>

export type ImportResult =
  | { status: 'imported'; statement_id: string; plan_id: string; items: number; new: number; updated: number; unchanged: number }
  | { status: 'duplicate_file'; statement_id: string; statement_number: string; imported_at: string }
  | { status: 'statement_number_conflict'; statement_number: string }
