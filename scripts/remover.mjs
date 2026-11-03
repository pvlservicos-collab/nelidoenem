// Remove explicações de questões cujos dados estão incompletos ou não batem com o gabarito.
import { sql } from '../api/_lib/db.js';
const ids = process.argv.slice(2);
const r = await sql`DELETE FROM explicacoes WHERE qid = ANY(${ids}) RETURNING qid`;
console.log('removidas', r.length, r.map(x => x.qid).join(' '));
console.log('restam', (await sql`SELECT count(*)::int n FROM explicacoes`)[0].n);
