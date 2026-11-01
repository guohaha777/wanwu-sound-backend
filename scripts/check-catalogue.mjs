import { trustedCatalogue } from '../apps/api/src/catalogue.ts';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const catalogue = await trustedCatalogue(true);
const metadata = JSON.parse(
  await readFile(new URL('../data/catalogue/library-sounds.json', import.meta.url), 'utf8'),
);
const { ANALYSIS_RULES } = await import('../packages/sound-rules/src/rules.ts');
for (const sound of metadata.sounds)
  if (sound.analysis?.rules !== ANALYSIS_RULES.version)
    throw new Error('Catalogue analysis rule version differs');
console.log(
  JSON.stringify({
    status: 'pass',
    originals: catalogue.size,
    previews: metadata.sounds.length,
    frontendCheckoutRequired: false,
    catalogue: fileURLToPath(new URL('../data/catalogue/library-manifest.json', import.meta.url)),
  }),
);
