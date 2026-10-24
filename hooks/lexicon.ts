import type { EngineInterface } from 'claude-code'

import type { Lexicon } from '../types'

// Peter Norvig's English word and word-pair counts, derived from the Google Web
// Trillion Word Corpus. Each person's copy is downloaded from his site on first
// run and built here, so this repository ships none of the data.
export const SOURCES = {
  words: 'https://norvig.com/ngrams/count_1w.txt',
  pairs: 'https://norvig.com/ngrams/count_2w.txt',
}

const SIZE = 25000
const NEXT_PER_WORD = 5

// Kept out of suggestions, as a phone keyboard does; still typeable.
const BLOCK = new Set(
  `porn porno sex sexy xxx fuck fucking fucked fucker shit bitch cunt dick cock pussy
  tits boobs nude nudes naked anal milf hentai horny slut whore fetish bdsm gay lesbian
  escort escorts viagra cialis penis vagina orgasm masturbation erotic blowjob cum dildo
  nigger nigga fag faggot retard rape incest bondage shemale tranny voyeur upskirt`.split(/\s+/),
)

// Common, but absent from the corpus, which drops apostrophes.
const CONTRACTIONS = `don't can't won't isn't doesn't didn't wasn't aren't shouldn't couldn't wouldn't
  haven't hasn't i'm i've i'll i'd it's that's there's what's let's you're we're they're`.split(/\s+/)

/** Packs `word:next1,next2|...` from counts, each word's most frequent followers first. */
export const pack = (counts: Map<string, Map<string, number>>, keep: number, minimum = 1): string => {
  const rows: string[] = []
  for (const [key, nexts] of counts) {
    const top = [...nexts]
      .filter(([, n]) => n >= minimum)
      .sort((a, b) => b[1] - a[1])
      .slice(0, keep)
      .map(([word]) => word)
    if (top.length > 0) rows.push(`${key}:${top.join(',')}`)
  }
  return rows.join('|')
}

/** Builds the vocabulary and next-word table from the text of the two count files. */
export const buildLexicon = (wordCounts: string, pairCounts: string): Lexicon => {
  const vocab: string[] = []
  for (const line of wordCounts.split('\n')) {
    const word = line.split('\t')[0] ?? ''
    if (/^[a-z]+$/.test(word) && !BLOCK.has(word) && (word.length > 1 || word === 'a' || word === 'i')) {
      vocab.push(word)
      if (vocab.length === SIZE) break
    }
  }
  const has = new Set(vocab)
  const words = [...vocab.slice(0, 300), ...CONTRACTIONS.filter(c => !has.has(c)), ...vocab.slice(300)]
  const known = new Set(words)

  const pairs = new Map<string, Map<string, number>>()
  for (const line of pairCounts.split('\n')) {
    const [phrase, count] = line.split('\t')
    const [first, second, extra] = (phrase ?? '').toLowerCase().split(' ')
    if (!first || !second || extra !== undefined || !known.has(first) || !known.has(second)) continue
    const nexts = pairs.get(first) ?? new Map<string, number>()
    nexts.set(second, (nexts.get(second) ?? 0) + Number(count))
    pairs.set(first, nexts)
  }

  return { words: words.join(' '), next: pack(pairs, NEXT_PER_WORD) }
}

/** Downloads both count files and builds the lexicon; rejects on any failed fetch. */
export async function downloadLexicon($: EngineInterface): Promise<Lexicon> {
  const [words, pairs] = await Promise.all([$.http.fetch(SOURCES.words), $.http.fetch(SOURCES.pairs)])
  if (!words.ok || !pairs.ok) throw new Error(`download failed (${words.status}, ${pairs.status})`)

  return buildLexicon(words.text, pairs.text)
}
