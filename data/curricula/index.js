import { createRequire } from 'module';

const require = createRequire(import.meta.url);

/**
 * Bundled curriculum reference data, loaded via createRequire so the module
 * works on any Node version >= 18 (JSON import attributes require >= 22.18).
 *
 * Each curriculum is an authoritative-ish subject list per grade. Curricula are
 * identified by stable string IDs (`cbse`, `icse`, ...) and are decoupled from
 * the school's free-text `boardOfEducation` field — schools pick one at import
 * time. Update a subject list by editing the JSON; no migration needed.
 */
export const cbse = require('./cbse.json');
export const icse = require('./icse.json');
export const ib = require('./ib.json');
export const igcse = require('./igcse.json');
export const tamilNadu = require('./tamilNadu.json');

export const curricula = [cbse, icse, ib, igcse, tamilNadu];
