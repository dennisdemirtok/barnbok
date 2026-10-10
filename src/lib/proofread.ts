// Korrekturläsning av boktext med Claude (server). Bara språkfel - stavning,
// böjning, särskrivning, skiljetecken och repliker. Stil, logik och innehåll är
// lektörens sak (reviewManuscript i ./claude). Används av /api/proofread.
import { getClient, resolveLatestModel, withModelFallback } from './claude';
import type { ProofIssue } from './types';

export type CheckedIssue = ProofIssue & { certain: boolean };

export interface SectionProof {
  key: string;
  text: string; // texten efter de automatiska rättelserna
  fixed: number;
  issues: CheckedIssue[]; // det som inte rättades automatiskt
}

export interface ProofOptions {
  targetAge?: string;
  dialogue?: 'dash' | 'quotes' | 'none'; // none = serie, repliker i pratbubblor
  names?: string[]; // figurernas namn - rättas aldrig
  autoFix?: boolean; // rätta tydliga fel själv (AI-skriven text)
}

const KINDS: ProofIssue['kind'][] = ['stavning', 'böjning', 'särskrivning', 'skiljetecken', 'repliker', 'ordval', 'övrigt'];
// Ett anrop läser ungefär ett kapitel - längre texter blir slarvigare lästa
const WORDS_PER_CALL = 1200;
const PARALLEL_CALLS = 3;

const PROOF_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['section', 'quote', 'fix', 'kind', 'certain', 'reason'],
        properties: {
          section: { type: 'integer' },
          quote: { type: 'string' },
          fix: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          certain: { type: 'boolean' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

interface Finding {
  section: number;
  quote: string;
  fix: string;
  kind: string;
  certain: boolean;
  reason: string;
}

function proofPrompt(sections: string[], opts: ProofOptions): string {
  const comic = opts.dialogue === 'none';
  const dialogue = comic
    ? 'Boken är en serie: varje avsnitt är en pratbubbla, en textruta eller ett ljudord. Pratbubblor har inga repliktecken.'
    : `Repliker markeras med ${opts.dialogue === 'quotes' ? 'citattecken ("Hej!" sa hon.)' : 'talstreck (– Hej! sa hon.)'}.`;
  const names = (opts.names ?? []).filter(Boolean);
  return `Du är korrekturläsare på ett svenskt barnboksförlag. Läs texten ord för ord och hitta språkfel som måste rättas innan boken trycks. Du rättar bara språket, aldrig stil, innehåll eller författarens röst.

BOKEN: en barnbok${opts.targetAge ? ` för ${opts.targetAge}` : ''}. ${dialogue}${names.length ? `\nNAMN I BOKEN (rätta aldrig dessa): ${names.join(', ')}` : ''}

TEXTEN, i numrerade avsnitt:
"""
${sections.map((text, i) => `[${i + 1}]\n${text}`).join('\n\n')}
"""

RAPPORTERA:
- stavning: felstavade ord, fel eller saknade bokstäver
- böjning: fel genus (en/ett), bestämd form, plural, adjektivböjning, verbform, de/dem
- särskrivning: ord som ska skrivas ihop (glass bil ska vara glassbil), eller tvärtom
- skiljetecken: saknad punkt, frågetecken eller utropstecken i slutet av en mening, skiljetecken som gör meningen fel
${comic ? '' : '- repliker: en replik som saknar repliktecken eller har en annan sorts tecken än resten av boken\n'}- ordval: ett ord som uppenbart är fel ord, eller samma ord två gånger i rad av misstag
- övrigt: andra rena språkfel

RÄTTA INTE:
- talspråk och barnspråk, särskilt i repliker (nån, sen, dom, va, typ, asså) och stavningar som härmar tal
- påhittade ord, ordvitsar, ljudord, utrop, namn och smeknamn
- versaler för ljud eller betoning, och kursiv mellan understreck (_ord_) - rör aldrig understrecken
- korta meningar, meningar utan verb och upprepningar som är stilgrepp
- sådant som är en smaksak

FÖR VARJE FEL:
- section: avsnittets nummer
- quote: kopiera EXAKT texten med felet ur avsnittet, tecken för tecken. Ta med ett par ord runt felet så att citatet bara finns på ett ställe i avsnittet.
- fix: samma citat där bara felet är rättat
- certain: true om felet är odiskutabelt, något varje svensklärare skulle stryka under. false om det kan vara medvetet eller en smaksak.
- reason: en kort förklaring på svenska
Hellre inget fynd än ett tveksamt. Finns inga fel svarar du med en tom lista.`;
}

async function proofreadChunk(sections: string[], opts: ProofOptions): Promise<Finding[]> {
  const client = getClient();
  const model = await resolveLatestModel(client);
  return withModelFallback(model, async (m) => {
    const stream = client.messages.stream({
      model: m,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: PROOF_SCHEMA } },
      messages: [{ role: 'user', content: proofPrompt(sections, opts) }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') throw new Error('Korrekturläsningen kunde inte läsa texten just nu');
    if (message.stop_reason === 'max_tokens') throw new Error('Texten blev för lång för en korrekturläsning');
    const block = message.content.find(c => c.type === 'text');
    if (!block || block.type !== 'text') throw new Error('Inget svar från korrekturläsningen');
    const parsed = JSON.parse(block.text) as { issues?: Finding[] };
    return Array.isArray(parsed.issues) ? parsed.issues : [];
  });
}

const count = (text: string, char: string) => text.split(char).length - 1;
const words = (text: string) => text.split(/\s+/).filter(Boolean);

// Hur många ord som skiljer citatet och rättelsen (ungefär - räcker för att se en omskrivning)
function changedWords(a: string, b: string): number {
  const wa = words(a);
  const wb = words(b);
  let same = 0;
  while (same < wa.length && same < wb.length && wa[same] === wb[same]) same++;
  let tail = 0;
  while (tail < wa.length - same && tail < wb.length - same && wa[wa.length - 1 - tail] === wb[wb.length - 1 - tail]) tail++;
  return Math.max(wa.length, wb.length) - same - tail;
}

// Ett fynd som går att lita på: citatet står i texten och rättelsen är liten.
// Tydliga fel som bara finns på ett ställe får rättas automatiskt.
function check(finding: Finding, text: string): CheckedIssue | null {
  const { quote, fix } = finding;
  if (!quote || typeof fix !== 'string' || quote === fix || !text.includes(quote)) return null;
  if (count(quote, '_') !== count(fix, '_')) return null;
  const once = text.indexOf(quote) === text.lastIndexOf(quote);
  const small = Math.abs(fix.length - quote.length) <= 12 && changedWords(quote, fix) <= 2;
  const kind = KINDS.includes(finding.kind as ProofIssue['kind']) ? finding.kind as ProofIssue['kind'] : 'övrigt';
  return { quote, fix, kind, reason: (finding.reason || '').trim(), certain: finding.certain === true && once && small };
}

async function pool<T>(jobs: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const i = next++;
      results[i] = await jobs[i]();
    }
  }));
  return results;
}

export async function proofreadSections(sections: { key: string; text: string }[], opts: ProofOptions = {}): Promise<SectionProof[]> {
  const live = sections.filter(s => s.text.trim());

  // Hela avsnitt i varje anrop, ungefär ett kapitel åt gången
  const chunks: typeof live[] = [];
  let current: typeof live = [];
  let size = 0;
  for (const section of live) {
    const n = words(section.text).length;
    if (current.length > 0 && size + n > WORDS_PER_CALL) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(section);
    size += n;
  }
  if (current.length > 0) chunks.push(current);

  const found = await pool(chunks.map(chunk => () => proofreadChunk(chunk.map(s => s.text), opts)), PARALLEL_CALLS);

  const issuesByKey = new Map<string, CheckedIssue[]>();
  chunks.forEach((chunk, c) => {
    for (const finding of found[c]) {
      // Fel avsnittsnummer händer - då gäller avsnittet där citatet faktiskt står
      const numbered = chunk[finding.section - 1];
      const target = numbered && numbered.text.includes(finding.quote)
        ? numbered
        : chunk.filter(s => finding.quote && s.text.includes(finding.quote)).length === 1
          ? chunk.find(s => s.text.includes(finding.quote))
          : undefined;
      const issue = target && check(finding, target.text);
      if (!target || !issue) continue;
      const list = issuesByKey.get(target.key) ?? [];
      if (!list.some(i => i.quote === issue.quote && i.fix === issue.fix)) list.push(issue);
      issuesByKey.set(target.key, list);
    }
  });

  return live.map(section => {
    let text = section.text;
    let fixed = 0;
    const issues: CheckedIssue[] = [];
    const sorted = (issuesByKey.get(section.key) ?? []).sort((a, b) => section.text.indexOf(a.quote) - section.text.indexOf(b.quote));
    for (const issue of sorted) {
      if (!text.includes(issue.quote)) continue; // en tidigare rättelse tog redan felet
      if (opts.autoFix && issue.certain) {
        text = text.replace(issue.quote, issue.fix);
        fixed++;
      } else {
        issues.push(issue);
      }
    }
    return { key: section.key, text, fixed, issues };
  });
}
