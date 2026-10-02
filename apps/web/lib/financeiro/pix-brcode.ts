// ================================================================
// PIX ESTÁTICO (BR Code) — QR Code e "Pix Copia e Cola"
//
// Monta o código no padrão EMV do Banco Central (Manual de Padrões
// para Iniciação do Pix): chave + valor + nome + cidade. Não depende
// de banco nenhum — qualquer app (Cora incluído) lê o QR, mostra o
// nome do recebedor que está no DICT e pede a sua autorização.
//
// O nome e a cidade que vão no código são só informativos; o app do
// banco mostra o titular REAL da chave antes de você autorizar.
// ================================================================

export type TipoChavePix = 'cpf' | 'cnpj' | 'telefone' | 'email' | 'aleatoria'

export type ChavePix =
  | { ok: true; tipo: TipoChavePix; chave: string; rotulo: string }
  | { ok: false; erro: string }

const ROTULO: Record<TipoChavePix, string> = {
  cpf: 'CPF',
  cnpj: 'CNPJ',
  telefone: 'Telefone',
  email: 'E-mail',
  aleatoria: 'Chave aleatória',
}

export function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false
  const dv = (n: number) => {
    let soma = 0
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i)
    const r = (soma * 10) % 11
    return r === 10 ? 0 : r
  }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}

export function cnpjValido(d: string): boolean {
  if (!/^\d{14}$/.test(d) || /^(\d)\1{13}$/.test(d)) return false
  const calc = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const soma = pesos.reduce((t, p, i) => t + Number(d[i]) * p, 0)
    const r = soma % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13])
}

/**
 * Reconhece o tipo da chave como ela está na planilha (DadosPsi!O2) e
 * devolve no formato que o Pix exige: CPF/CNPJ só dígitos, telefone
 * +55DDDNÚMERO, e-mail minúsculo, aleatória minúscula com hífens.
 */
export function normalizarChavePix(bruta: unknown): ChavePix {
  const texto = String(bruta ?? '').trim()
  if (!texto) return { ok: false, erro: 'Chave Pix não informada na planilha (DadosPsi!O2).' }
  const ok = (tipo: TipoChavePix, chave: string): ChavePix => ({ ok: true, tipo, chave, rotulo: ROTULO[tipo] })

  if (texto.includes('@')) {
    const email = texto.toLowerCase().replace(/\s+/g, '')
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 77) return ok('email', email)
    return { ok: false, erro: `E-mail inválido como chave Pix: "${texto}"` }
  }

  const uuid = texto.toLowerCase().replace(/\s+/g, '')
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) return ok('aleatoria', uuid)
  if (/^[0-9a-f]{32}$/.test(uuid)) {
    return ok('aleatoria', `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`)
  }

  const digitos = texto.replace(/\D/g, '')
  const pareceTelefone = texto.startsWith('+') || /\(\d{2}\)/.test(texto)

  if (!pareceTelefone && digitos.length === 14 && cnpjValido(digitos)) return ok('cnpj', digitos)
  if (!pareceTelefone && digitos.length === 11 && cpfValido(digitos)) return ok('cpf', digitos)

  // CPF/CNPJ que a planilha guardou como NÚMERO perde os zeros da frente
  // (01761079590 vira 1761079590). Só digitos (sem +, parênteses, traço ou
  // ponto) e curto demais: se recolocando os zeros vira CPF/CNPJ válido,
  // é CPF/CNPJ — o app do banco ainda mostra o titular antes de pagar.
  if (!pareceTelefone && /^\d+$/.test(texto)) {
    if (digitos.length >= 12 && digitos.length < 14 && cnpjValido(digitos.padStart(14, '0'))) {
      return { ok: true, tipo: 'cnpj', chave: digitos.padStart(14, '0'), rotulo: 'CNPJ — zeros da frente recolocados' }
    }
    if (digitos.length >= 9 && digitos.length < 11 && cpfValido(digitos.padStart(11, '0'))) {
      return { ok: true, tipo: 'cpf', chave: digitos.padStart(11, '0'), rotulo: 'CPF — zeros da frente recolocados' }
    }
  }

  // telefone: com +55 / 55 na frente, ou DDD + 8/9 dígitos
  let tel = digitos
  if ((tel.length === 12 || tel.length === 13) && tel.startsWith('55')) tel = tel.slice(2)
  if ((tel.length === 10 || tel.length === 11) && !tel.startsWith('0')) {
    if (tel.length === 11 && tel[2] !== '9') {
      return { ok: false, erro: `Não deu para saber se "${texto}" é CPF ou telefone (CPF inválido e celular sem o 9).` }
    }
    return ok('telefone', `+55${tel}`)
  }

  if (digitos.length === 11) return { ok: false, erro: `CPF inválido como chave Pix: "${texto}"` }
  if (digitos.length === 14) return { ok: false, erro: `CNPJ inválido como chave Pix: "${texto}"` }
  return { ok: false, erro: `Formato de chave Pix não reconhecido: "${texto}"` }
}

/** Remove acentos e caracteres fora do padrão do BR Code, cortando no tamanho máximo. */
function textoBrCode(t: string, max: number): string {
  return t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,\-/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim()
}

function campo(id: string, valor: string): string {
  if (valor.length > 99) throw new Error(`Campo ${id} do Pix com mais de 99 caracteres.`)
  return id + String(valor.length).padStart(2, '0') + valor
}

/** CRC16/CCITT-FALSE (polinômio 0x1021, inicial 0xFFFF), como exige o BR Code. */
export function crc16(payload: string): string {
  let crc = 0xffff
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export type DadosPix = {
  chave: string
  nome: string
  cidade: string
  /** em reais; omitido = o pagador digita o valor */
  valor?: number
  /** identificador (até 25 letras/números); omitido = *** */
  txid?: string
  /** mensagem para o recebedor (campo 02 da chave) */
  descricao?: string
}

/** Gera o "Pix Copia e Cola" (o mesmo texto vai dentro do QR Code). */
export function gerarPixCopiaECola(d: DadosPix): string {
  const chave = d.chave.trim()
  if (!chave || chave.length > 77) throw new Error('Chave Pix vazia ou com mais de 77 caracteres.')

  let conta = campo('00', 'br.gov.bcb.pix') + campo('01', chave)
  const desc = d.descricao ? textoBrCode(d.descricao, 99 - conta.length - 4) : ''
  if (desc) conta += campo('02', desc)

  const nome = textoBrCode(d.nome, 25) || 'RECEBEDOR'
  const cidade = textoBrCode(d.cidade, 15) || 'BRASIL'
  const txid = (d.txid ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'

  let payload = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986')
  if (d.valor !== undefined) {
    if (!(d.valor > 0) || !Number.isFinite(d.valor)) throw new Error('Valor do Pix deve ser maior que zero.')
    payload += campo('54', d.valor.toFixed(2))
  }
  payload += campo('58', 'BR') + campo('59', nome) + campo('60', cidade) + campo('62', campo('05', txid)) + '6304'
  return payload + crc16(payload)
}
