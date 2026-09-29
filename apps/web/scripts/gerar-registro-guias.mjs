// Copia o Index.html ORIGINAL do ADM Registro de Guia (pasta legado/) para
// um JSON que a rota /financeiro/guias serve. Rode de novo sempre que o
// Index.html original mudar:  node scripts/gerar-registro-guias.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const aqui = dirname(fileURLToPath(import.meta.url))
const origem = join(aqui, '../../../legado/registro-guias/Index.html')
const destino = join(aqui, '../lib/registro-guias/index-original.json')
const html = readFileSync(origem, 'utf8')
writeFileSync(destino, JSON.stringify({ origem: 'legado/registro-guias/Index.html', html }) + '\n')
console.log(`ok: ${html.length} caracteres → ${destino}`)
