/** Counts kept across sessions from the prompts sent; `<s>` keys sentence starters. */
export type Learned = {
  words: Record<string, number>
  pairs: Record<string, Record<string, number>>
}

/** The downloaded word list, packed: words by frequency, and `word:next1,next2|...`. */
export type Lexicon = { words: string; next: string }

/** What `/predict import` counted in past sessions' prompts, packed like `Lexicon.next`. */
export type History = { prompts: number; next: string; next2: string }

/** What the strip offers: completions of `prefix`, or next words where `prefix` is empty. */
export type Prediction = { prefix: string; words: string[] }

declare module 'claude-code' {
  interface PluginState {
    'word-predict': { prediction: Prediction; isOn: boolean }
  }
}
