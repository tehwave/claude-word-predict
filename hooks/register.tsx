import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { pickByKey } from './keys'
import { downloadLexicon } from './lexicon'
import { addition, buildModel, complete, empty, learn, predict } from './predict'
import type { Model } from './predict'

import type { History, Learned, Lexicon, Prediction } from '../types'

const prediction = atom({ plugin: 'word-predict', key: 'prediction' } as const, { prefix: '', words: [] })
const isOn = atom({ plugin: 'word-predict', key: 'isOn' } as const, true)

const HELP = '/predict on, off, import (learn from past sessions), forget (clear what it learned)'

function show($: EngineInterface, model: Model, learned: Learned, text: string, cursor: number) {
  const next: Prediction = predict(model, learned, text, cursor)
  void update($, prediction, () => next)
}

/** Runs the history script and returns what it counted. */
async function importHistory($: EngineInterface): Promise<History> {
  const script = `${$.plugin.root}/scripts/import_history.py`
  const run = await $.process.run(['python3', '-I', script], { timeoutMs: 120_000 })
  if (run.exitCode !== 0) throw new Error(run.stderr.trim().split('\n').pop() || `exit code ${run.exitCode}`)

  return JSON.parse(run.stdout) as History
}

export const register: Register = on => {
  let learned: Learned = empty()
  let lexicon: Lexicon | undefined
  let history: History | undefined
  let model: Model = buildModel()

  on('session.start', async ($, e, next) => {
    learned = ((await $.store.get('learned')) as Learned | undefined) ?? empty()
    lexicon = (await $.store.get('lexicon')) as Lexicon | undefined
    history = (await $.store.get('history')) as History | undefined
    model = buildModel(lexicon, history)
    await $.command.register({ name: 'predict', description: `Word prediction: ${HELP}` })

    // First run: fetch the word list in the background; prediction starts once it lands.
    if (!lexicon) {
      void (async () => {
        $.ui.status('Downloading the word list for word prediction…')
        try {
          lexicon = await downloadLexicon($)
          await $.store.set('lexicon', lexicon)
          model = buildModel(lexicon, history)
          $.ui.toast('Word prediction is ready. Run /predict import to learn from your past prompts.')
        } catch (error) {
          $.ui.toast(`Word prediction could not download its word list: ${String(error)}`)
        } finally {
          $.ui.status(undefined)
        }
      })()
    }

    return next(e)
  })

  // The terminal's typeahead: ways to finish the word at the cursor.
  on('prompt.autocomplete', { token: /^[A-Za-z][A-Za-z']*$/ }, async ($, e, next) => {
    const found = await next(e)
    if (!(await read($, isOn))) return found
    const words = e.text.slice(0, e.start).trim().split(/\s+/)
    const previous = words[words.length - 1]?.toLowerCase().replace(/[^a-z']/g, '') || undefined
    const mine = complete(model, learned, e.token, previous, 5).map(text => ({ text }))

    return { suggestions: [...found.suggestions, ...mine] }
  })

  on('prompt.edit', async ($, e, next) => {
    if (await read($, isOn)) {
      const picked = pickByKey(model, learned, e)
      if (picked) {
        show($, model, learned, picked.text, picked.cursor)
        return picked
      }
    }

    const box = await next(e)
    // The desktop holds a typed space back until the next character, so the box
    // does not have it yet: predict as if it had, so next words show at once.
    const isSpaceHeld = e.key?.key === 'space' && e.inputText === '' && box.text === e.text
    const text = isSpaceHeld ? box.text.slice(0, box.cursor) + ' ' + box.text.slice(box.cursor) : box.text
    show($, model, learned, text, box.cursor + (isSpaceHeld ? 1 : 0))

    return box
  })

  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    show($, model, learned, e.text, e.cursor)

    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    void update($, prediction, () => ({ prefix: '', words: [] }))
    // Learning is best effort: the prompt is already on its way.
    if (!e.command && !e.isMeta && (await read($, isOn))) {
      learned = learn(learned, e.text)
      await $.store.set('learned', learned).catch(() => undefined)
    }

    return result
  })

  on('command.run', { command: 'predict' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, isOn, () => arg === 'on')
      return { text: `Word prediction ${arg}.` }
    }
    if (arg === 'import') {
      try {
        history = await importHistory($)
      } catch (error) {
        return { text: `Could not read past sessions (needs python3): ${String(error)}` }
      }
      await $.store.set('history', history)
      model = buildModel(lexicon, history)
      return { text: `Learned from ${history.prompts} prompts in past sessions.` }
    }
    if (arg === 'forget') {
      learned = empty()
      history = undefined
      model = buildModel(lexicon)
      await Promise.all([$.store.delete('learned'), $.store.delete('history')])
      return { text: 'Forgot everything learned from your prompts.' }
    }
    const state = (await read($, isOn)) ? 'on' : 'off'
    const words = model.vocab.length > 0 ? `${model.vocab.length} words` : 'no word list yet'
    const own = history ? `${history.prompts} past prompts imported` : 'past prompts not imported'
    const sent = `${Object.keys(learned.words).length} words learned since`

    return { text: `Word prediction is ${state}: ${words}, ${own}, ${sent}.\n${HELP}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { prefix, words } = await read($, prediction)
    if (e.props.hasSurvey || e.props.isWorking || words.length === 0 || !(await read($, isOn))) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    // A press takes the word against the box as it is now.
    const take = async (word: string) => {
      const box = await $.prompt.read()
      await $.prompt.fill({ text: addition(box.text.slice(0, box.cursor), word), mode: 'insert' })
    }

    return (
      <Box flexDirection="row" gap={3}>
        <Text dimColor>{prefix ? 'complete' : 'next'}</Text>
        {words.map((word, i) => (
          <Box key={`s${i}`} flexDirection="row" gap={1}>
            <Text dimColor>{`⌥${i + 1}`}</Text>
            <Button key={`w${i}`} label={word} plain onPress={() => take(word)} />
          </Box>
        ))}
      </Box>
    )
  })
}
