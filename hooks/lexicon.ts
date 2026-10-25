import type { EngineInterface } from 'claude-code'

import type { Lexicon } from '../types'

// Peter Norvig's English word and word-pair counts, derived from the Google Web
// Trillion Word Corpus. Each person's copy is downloaded from his site on first
// run and built here, so this repository ships none of the data. The hashes pin
// the exact files the mod was built and tested against: anything else is refused.
const SOURCES = [
  {
    url: 'https://www.norvig.com/ngrams/count_1w.txt',
    bytes: 4956241,
    sha256: '51df159fd3de12b20e403c108f526e96dbd723d9cabdd5f17955cdc16059e690',
  },
  {
    url: 'https://www.norvig.com/ngrams/count_2w.txt',
    bytes: 5566017,
    sha256: '781c0596c3eea532d30bef9f3dba1d5137d652f00376260822c761a7584dfb8c',
  },
] as const

// Bumped whenever buildLexicon's output changes, so stored copies are rebuilt.
export const LEXICON_VERSION = 2

// `$.http.fetch` cuts a body at 4 MiB, so each file is fetched in ranges below that.
const CHUNK = 2 * 1024 * 1024

const SIZE = 25000
const NEXT_PER_WORD = 5
const MAX_WORD = 24

// Kept out of suggestions, as a phone keyboard does; still typeable. A word is
// blocked when it starts with one of PREFIXES, or is one of ROOTS with an
// inflection added.
const PREFIXES = `porn xxx fuck shit cunt pussy pussies milf hentai slut whore dildo blowjob cumshot
  upskirt shemale tranny faggot bdsm gangbang bukkake masturbat orgasm erotic horny
  voyeur incest bestiality squirting creampie handjob threesome`.split(/\s+/)
const ROOTS = `sex sexy nude naked anal cum cock dick tit boob escort viagra cialis penis
  vagina fetish rape retard fag bondage bitch nigger nigga`.split(/\s+/)
const INFLECTIONS = ['', 's', 'es', 'ed', 'ing', 'er', 'ers', 'y', 'ies']

export const isBlocked = (word: string): boolean =>
  PREFIXES.some(prefix => word.startsWith(prefix)) ||
  ROOTS.some(root => word.startsWith(root) && INFLECTIONS.includes(word.slice(root.length)))

// Common, but absent from the corpus, which drops apostrophes.
const CONTRACTIONS = `don't can't won't isn't doesn't didn't wasn't aren't shouldn't couldn't wouldn't
  haven't hasn't i'm i've i'll i'd it's that's there's what's let's you're we're they're`.split(/\s+/)

// What the corpus keeps of a contraction once it splits it at the apostrophe.
const FRAGMENTS = new Set(['re', 'll', 've', 'don', 'haven', 'isn', 'doesn', 'didn', 'wasn', 'aren', 'shouldn', 'couldn', 'wouldn', 'hasn'])

/** Packs `word:next1,next2|...` from counts, each word's most frequent followers first. */
const pack = (counts: Map<string, Map<string, number>>, keep: number): string => {
  const rows: string[] = []
  for (const [key, nexts] of counts) {
    const top = [...nexts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, keep)
      .map(([word]) => word)
    if (top.length > 0) rows.push(`${key}:${top.join(',')}`)
  }
  return rows.join('|')
}

/** Builds the vocabulary and next-word table from the text of the two count files. */
export const buildLexicon = (wordCounts: string, pairCounts: string): Lexicon => {
  // A contraction's followers are counted under its apostrophe-less spelling
  // (`dont`), which leaves the word list for the contraction itself.
  const spelled = new Map(CONTRACTIONS.map(c => [c.replace(/'/g, ''), c]))
  const vocab: string[] = []
  for (const line of wordCounts.split('\n')) {
    const word = line.split('\t')[0] ?? ''
    const isWord = /^[a-z]+$/.test(word) && word.length <= MAX_WORD && (word.length > 1 || word === 'a' || word === 'i')
    if (isWord && !isBlocked(word) && !FRAGMENTS.has(word) && !spelled.has(word)) {
      vocab.push(word)
      if (vocab.length === SIZE) break
    }
  }
  const words = [...vocab.slice(0, 300), ...CONTRACTIONS, ...vocab.slice(300)]
  const known = new Set(words)

  const pairs = new Map<string, Map<string, number>>()
  for (const line of pairCounts.split('\n')) {
    const [phrase, count] = line.split('\t')
    const n = Number(count)
    const [written, second, extra] = (phrase ?? '').toLowerCase().split(' ')
    const first = spelled.get(written ?? '') ?? written
    if (!first || !second || extra !== undefined || !Number.isFinite(n) || !known.has(first) || !known.has(second)) continue
    const nexts = pairs.get(first) ?? new Map<string, number>()
    nexts.set(second, (nexts.get(second) ?? 0) + n)
    pairs.set(first, nexts)
  }

  return { version: LEXICON_VERSION, words: words.join(' '), next: pack(pairs, NEXT_PER_WORD) }
}

/** True for a stored lexicon this version built, not a stale or broken copy. */
export const isCurrent = (lexicon: Lexicon | undefined): lexicon is Lexicon =>
  lexicon?.version === LEXICON_VERSION && typeof lexicon.words === 'string' && typeof lexicon.next === 'string'

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')

/**
 * Fetches one source in ranges and checks its length and hash; rejects on any
 * mismatch. A range can end inside a multi-byte character, which arrives
 * broken as text, so each range keeps whole lines and the next starts after them.
 */
async function fetchSource($: EngineInterface, source: (typeof SOURCES)[number]): Promise<string> {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let start = 0
  while (start < source.bytes) {
    const end = Math.min(start + CHUNK, source.bytes) - 1
    const response = await $.http.fetch(source.url, { headers: { Range: `bytes=${start}-${end}` } })
    if (response.status !== 206) throw new Error(`${source.url} answered ${response.status}`)
    const kept = end === source.bytes - 1 ? response.text : response.text.slice(0, response.text.lastIndexOf('\n') + 1)
    if (kept === '') throw new Error(`${source.url} sent no whole line`)
    parts.push(kept)
    start += encoder.encode(kept).length
  }
  const text = parts.join('')
  const bytes = encoder.encode(text)
  const digest = hex(await crypto.subtle.digest('SHA-256', bytes))
  if (bytes.length !== source.bytes || digest !== source.sha256) throw new Error(`${source.url} is not the expected file`)

  return text
}

/** Downloads both count files, verifies them, and builds the lexicon. */
export async function downloadLexicon($: EngineInterface): Promise<Lexicon> {
  const [words, pairs] = await Promise.all(SOURCES.map(source => fetchSource($, source)))

  return buildLexicon(words ?? '', pairs ?? '')
}
