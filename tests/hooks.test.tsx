import type { PromptBox, PromptEditInput } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { HISTORY, LEXICON } from './fixture'

const STRIP = {
  plugin: 'word-predict',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

// `prompt.edit` is raised by the composer, not called on `$`, so its call is
// untyped in the kit; the kit raises it all the same.
const edit = ($: unknown, e: PromptEditInput) =>
  ($ as { prompt: { edit: (e: PromptEditInput) => Promise<PromptBox> } }).prompt.edit(e)

const predict = (args: string) => ({
  command: 'predict',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 80 },
})

const typed = (text: string, inputText: string) => ({
  origin: { kind: 'composer' as const },
  text,
  cursor: text.length,
  start: text.length,
  end: text.length,
  inputText,
})

test('typing fills the strip, Option+1 takes a word, a press inserts one, on every surface', async ($, on) => {
  // These hooks stand for the engine.
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'predict' } }))
  on('prompt.edit', (_, e) => ({ text: e.text + e.inputText, cursor: e.cursor + e.inputText.length }))
  on('prompt.read', () => ({ value: { text: 'i want ', cursor: 7 } }))
  const filled: string[] = []
  on('prompt.fill', (_, e) => {
    filled.push(e.text)
    return { isFilled: true, text: '', cursor: 0 }
  })

  mock.store(on, { lexicon: LEXICON })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect(await edit($, { ...typed('i want', ' ¡'), key: { key: '¡', meta: true } })).toEqual({
    text: 'i want to ',
    cursor: 10,
  })
  await edit($, typed('i want', ' '))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...STRIP, surface })
    expect((await ui.find({ key: 'w0' }))?.text).toBe('to')
    await ui.press({ key: 'w1' })
    expect(filled.pop()).toBe('a ')
    await ui.unmount()
  }
})

test('/predict reports what it knows, and forget clears what it learned', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'predict' } }))
  mock.store(on, { lexicon: LEXICON, history: HISTORY })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  expect((await $.command.run(predict(''))).text).toContain('2 past prompts imported')
  await $.command.run(predict('forget'))
  expect((await $.command.run(predict(''))).text).toContain('not imported')
})
