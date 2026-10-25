import { atom, read } from 'claude-code'
import type { EngineInterface, PromptBox, Register } from 'claude-code'

import { LAYOUTS, literal, readPress, take } from './keys'
import type { Press } from './keys'
import { SOURCES, buildLexicon, fetchInRanges, isCurrent } from './lexicon'
import { addition, buildModel, empty, learn, predict } from './predict'
import type { Model } from './predict'

import type { History, Layout, Learned, Lexicon, Prediction, Settings } from '../types'

const NONE: Prediction = { prefix: '', words: [] }
const DEFAULTS: Settings = { isOn: true, layout: 'us' }

const PREDICTION = { plugin: 'word-predict', key: 'prediction' } as const
const SETTINGS = { plugin: 'word-predict', key: 'settings' } as const
const prediction = atom(PREDICTION, NONE)
const shown = atom(SETTINGS, DEFAULTS)

const HELP =
  '/predict on, off, layout us|danish|german|british (which Option+1/2/3 take a word), import (learn from past sessions), forget (clear what it learned)'

// The store holds the whole history; past this, an import is refused rather than
// crowding out the word list and what is learned (the store's limit is 4 MiB).
const MAX_HISTORY = 1_500_000

/** Publishes what the strip offers; a plain write, as nothing else writes it. */
function show($: EngineInterface, next: Prediction) {
  void $.state.set(PREDICTION, next)
}

/** Reads what `/predict import`'s script printed; rejects output too large to keep. */
function parseHistory(run: { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean }): History {
  if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || `python3 exited with code ${run.exitCode}`)
  if (run.isStdoutTruncated || run.stdout.length > MAX_HISTORY) throw new Error('your history is too large to keep')

  return JSON.parse(run.stdout) as History
}

const isLayout = (value: string): value is Layout => Object.hasOwn(LAYOUTS, value)

/** Reads what any session may have changed: settings, learned words, the imported history. */
async function readStored($: EngineInterface): Promise<{ settings: Settings; learned: Learned; history?: History }> {
  const [settings, learned, history] = await Promise.all([$.store.get('settings'), $.store.get('learned'), $.store.get('history')])
  return {
    settings: { ...DEFAULTS, ...(settings as Partial<Settings> | undefined) },
    learned: (learned as Learned | undefined) ?? empty(),
    history: history as History | undefined,
  }
}

export const register: Register = on => {
  let learned: Learned = empty()
  let lexicon: Lexicon | undefined
  let history: History | undefined
  let settings: Settings = DEFAULTS
  let model: Model = buildModel()
  // Whether the strip is drawn: Option keys take only words the person can see.
  let isStripDrawn = false
  // The last Option press that took a word, so the same key again types its character.
  let lastPress: { press: Press; after: PromptBox } | undefined

  const rebuild = () => {
    model = buildModel(lexicon, history)
  }

  /** Takes in what the store holds now, rebuilding the model only when the history changed. */
  const adopt = (stored: Awaited<ReturnType<typeof readStored>>) => {
    settings = stored.settings
    learned = stored.learned
    if (stored.history?.prompts !== history?.prompts || stored.history?.next.length !== history?.next.length) {
      history = stored.history
      rebuild()
    }
  }

  on('session.start', async ($, e, next) => {
    adopt(await readStored($))
    void $.state.set(SETTINGS, settings)
    lexicon = (await $.store.get('lexicon')) as Lexicon | undefined
    rebuild()
    await $.command.register({ name: 'predict', description: `Word prediction: ${HELP}` })

    // First run, or a word list from an older version: fetch it in the background.
    if (!isCurrent(lexicon)) {
      void (async () => {
        $.ui.status('Downloading the word list for word prediction…')
        try {
          // The only network use: two ranged GETs of Peter Norvig's count files.
          const [words, pairs] = await Promise.all([
            fetchInRanges(SOURCES.words, range =>
              $.http.fetch('https://www.norvig.com/ngrams/count_1w.txt', { headers: { Range: range } }),
            ),
            fetchInRanges(SOURCES.pairs, range =>
              $.http.fetch('https://www.norvig.com/ngrams/count_2w.txt', { headers: { Range: range } }),
            ),
          ])
          const fresh = buildLexicon(words, pairs)
          await $.store.set('lexicon', fresh)
          lexicon = fresh
          rebuild()
          $.ui.toast('Word prediction is ready. Run /predict layout to pick your keyboard, /predict import to learn from past prompts.')
        } catch (error) {
          $.ui.toast(`Word prediction could not set up its word list: ${String(error)}`)
        } finally {
          $.ui.status(undefined)
        }
      })()
    }

    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const press = settings.isOn && isStripDrawn ? readPress(settings.layout, e) : undefined
    if (press) {
      // The same key right after a pick: the person wanted the character, not a word.
      const isRepeat = lastPress?.press.char === press.char && e.text.trimEnd() === lastPress.after.text.trimEnd()
      const box = isRepeat && lastPress ? literal(lastPress.press) : take(model, learned, press)
      lastPress = box && !isRepeat ? { press, after: box } : undefined
      if (box) {
        show($, predict(model, learned, box.text, box.cursor))
        return box
      }
    }
    lastPress = undefined

    const box = await next(e)
    if (!settings.isOn) return box
    // The desktop holds a typed space back until the next character, so the box
    // does not have it yet: predict as if it had, so next words show at once.
    const isSpaceHeld = e.key?.key === 'space' && e.inputText === '' && box.text === e.text
    const text = isSpaceHeld ? box.text.slice(0, box.cursor) + ' ' + box.text.slice(box.cursor) : box.text
    show($, predict(model, learned, text, box.cursor + (isSpaceHeld ? 1 : 0)))

    return box
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    // The box is empty once a prompt is sent.
    lastPress = undefined
    show($, NONE)
    // Learn what entered, as the hooks beneath left it; nothing from a refused prompt.
    if (result.drop !== undefined || e.command || e.isMeta) return result

    // Merge into what the store holds now, so other sessions' learning and a
    // `/predict forget` elsewhere are kept, not overwritten by this session's copy.
    adopt(await readStored($))
    if (settings.isOn) {
      learned = learn(learned, result.text)
      await $.store.set('learned', learned).catch(() => $.ui.toast('Word prediction could not save what it learned: the store is full.'))
    }

    return result
  })

  on('command.run', { command: 'predict' }, async ($, e) => {
    const [arg = '', value = ''] = e.args.trim().toLowerCase().split(/\s+/)
    adopt(await readStored($))

    if (arg === 'on' || arg === 'off' || arg === 'layout') {
      if (arg === 'layout' && !isLayout(value)) return { text: `Pick one of: ${Object.keys(LAYOUTS).join(', ')}.` }
      settings = arg === 'layout' ? { ...settings, layout: value as Layout } : { ...settings, isOn: arg === 'on' }
      await $.store.set('settings', settings)
      void $.state.set(SETTINGS, settings)
      if (!settings.isOn) show($, NONE)
      return { text: arg === 'layout' ? `Option+1/2/3 now follow the ${value} layout.` : `Word prediction ${arg}.` }
    }
    if (arg === 'import') {
      let imported: History
      try {
        imported = parseHistory(
          await $.process.run(['python3', '-I', `${$.plugin.root}/scripts/import_history.py`], { timeoutMs: 300_000 }),
        )
        await $.store.set('history', imported)
      } catch (error) {
        return { text: `Could not import past sessions: ${String(error)}` }
      }
      history = imported
      rebuild()
      return { text: `Learned from ${imported.prompts} prompts in past sessions.` }
    }
    if (arg === 'forget') {
      await Promise.all([$.store.delete('learned'), $.store.delete('history')])
      learned = empty()
      history = undefined
      rebuild()
      return { text: 'Forgot everything learned from your prompts.' }
    }
    const state = settings.isOn ? 'on' : 'off'
    const words = model.vocab.length > 0 ? `${model.vocab.length} words` : 'no word list yet'
    const own = history ? `${history.prompts} past prompts imported` : 'past prompts not imported'
    const sent = `${Object.keys(learned.words).length} words learned since`

    return { text: `Word prediction is ${state} (${settings.layout} layout): ${words}, ${own}, ${sent}.\n${HELP}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { prefix, words } = await read($, prediction)
    const { isOn } = (await read($, shown)) as Settings
    isStripDrawn = isOn && !e.props.hasSurvey && !e.props.isWorking && words.length > 0
    if (!isStripDrawn) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    // A press takes the word against the box as it is now.
    const press = async (word: string) => {
      const box = await $.prompt.read()
      const added = addition(box.text.slice(0, box.cursor), word, prefix)
      const { isFilled } = await $.prompt.fill({ text: added, mode: 'insert' })
      // A fill is no keystroke, so offer the next words here, for the draft as the person now sees it.
      const text = box.text.slice(0, box.cursor) + added + box.text.slice(box.cursor)
      if (isFilled) show($, predict(model, learned, text, box.cursor + added.length))
    }

    return (
      <Box flexDirection="row" gap={3}>
        <Text dimColor>{prefix ? 'complete' : 'next'}</Text>
        {words.map((word, i) => (
          <Box key={`s${i}`} flexDirection="row" gap={1}>
            <Text dimColor>{`⌥${i + 1}`}</Text>
            <Button key={`w${i}`} label={word} plain onPress={() => press(word)} />
          </Box>
        ))}
      </Box>
    )
  })
}
