/**
 * Gera js/supabase-config.js no build, a partir das variáveis de ambiente.
 *
 * O arquivo não é versionado: o repositório é público e, mesmo a chave anon
 * sendo publicável, deixá-la no GitHub amplia o acesso de "quem tem o link"
 * para "quem achar o repositório".
 *
 * Configure em Netlify → Site configuration → Environment variables:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 *
 * Sem elas o build FALHA de propósito. Publicar sem credenciais faria o app
 * cair no localStorage e fingir que funciona, com cada pessoa vendo um
 * calendário só seu — falha silenciosa é pior que deploy interrompido.
 */

const { writeFileSync, mkdirSync } = require('node:fs');
const { dirname, join } = require('node:path');

const URL_SUPABASE = process.env.SUPABASE_URL;
const CHAVE_ANON = process.env.SUPABASE_ANON_KEY;

const faltando = [
  !URL_SUPABASE && 'SUPABASE_URL',
  !CHAVE_ANON && 'SUPABASE_ANON_KEY',
].filter(Boolean);

if (faltando.length) {
  console.error(`
╭──────────────────────────────────────────────────────────────╮
│  Build interrompido: falta configurar o Supabase.            │
╰──────────────────────────────────────────────────────────────╯

Variáveis ausentes: ${faltando.join(', ')}

Defina em Netlify → Site configuration → Environment variables.
Use a chave "anon" (publicável), nunca a "service_role".
`);
  process.exit(1);
}

if (/service_role/.test(CHAVE_ANON) || CHAVE_ANON.length > 500) {
  console.error('\nSUPABASE_ANON_KEY parece não ser a chave anon. Verifique.\n');
  process.exit(1);
}

const destino = join(__dirname, '..', 'js', 'supabase-config.js');

const conteudo = `/* Gerado no build por scripts/gerar-config.cjs. Não edite. */
export const URL = ${JSON.stringify(URL_SUPABASE)};
export const ANON_KEY = ${JSON.stringify(CHAVE_ANON)};
`;

mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, conteudo, 'utf8');

console.log(`js/supabase-config.js gerado para ${URL_SUPABASE}`);
