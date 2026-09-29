'use client'

/** Botão que abre a janela de impressão (Salvar como PDF), como o PDF do RPA. */
export function BotaoImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        font: 'inherit',
        fontWeight: 600,
        padding: '9px 16px',
        borderRadius: 6,
        border: '1px solid var(--fin-border)',
        background: 'var(--fin-surface)',
        color: 'var(--fin-text)',
        cursor: 'pointer',
      }}
    >
      Imprimir / salvar PDF
    </button>
  )
}
