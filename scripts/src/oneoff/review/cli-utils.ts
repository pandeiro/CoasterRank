import process from 'node:process'

export interface KeypressOptions {
  prompt?: string
  validKeys?: string[]
  hideKeys?: boolean
}

export interface TextPromptOptions {
  prompt: string
  defaultValue?: string
  validate?: (input: string) => string | null
}

export function enableRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
  }
}

export function disableRawMode(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false)
    process.stdin.pause()
  }
}

export function promptKeypress(options: KeypressOptions = {}): Promise<string> {
  const { prompt = 'Press key: ', validKeys = [], hideKeys = false } = options

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      console.error('Not a TTY, cannot read keypress')
      resolve('')
      return
    }

    const originalWrite = process.stdout.write.bind(process.stdout)
    const keys: string[] = []

    const onData = (chunk: Buffer | string) => {
      const str = chunk.toString()

      if (str === '\u0003') {
        disableRawMode()
        process.removeListener('data', onData)
        process.exit(130)
      }

      keys.push(str)

      if (
        validKeys.length === 0 ||
        validKeys.some((k) => keys.join('') === k || keys.join('').startsWith(k))
      ) {
        disableRawMode()
        process.removeListener('data', onData)

        if (!hideKeys) {
          process.stdout.write('\n')
        }

        resolve(keys.join(''))
      }
    }

    enableRawMode()
    process.stdout.write(prompt)
    process.stdin.on('data', onData)
  })
}

export function promptText(options: TextPromptOptions): Promise<string> {
  const { prompt, defaultValue = '', validate } = options

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      console.error('Not a TTY, cannot read text input')
      resolve(defaultValue)
      return
    }

    const fullPrompt = defaultValue ? `${prompt} [${defaultValue}]: ` : `${prompt}: `

    process.stdout.write(fullPrompt)
    let input = ''

    const onData = (chunk: Buffer | string) => {
      const str = chunk.toString()

      if (str === '\u0003') {
        disableRawMode()
        process.stdin.removeListener('data', onData)
        process.exit(130)
      }

      if (str === '\r' || str === '\n') {
        disableRawMode()
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')

        const value = input || defaultValue
        if (validate) {
          const err = validate(value)
          if (err) {
            console.error(`  ${err}`)
            resolve(promptText(options))
          } else {
            resolve(value)
          }
        } else {
          resolve(value)
        }
        return
      }

      if (str === '\u007f' || str === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1)
          process.stdout.write('\b \b')
        }
        return
      }

      if (str >= ' ' && str <= '~') {
        input += str
        process.stdout.write(str)
      }
    }

    enableRawMode()
    process.stdin.on('data', onData)
  })
}

export async function promptYesNo(prompt: string, defaultYes = true): Promise<boolean> {
  const suffix = defaultYes ? 'Y/n' : 'y/N'
  const key = await promptKeypress({
    prompt: `${prompt} [${suffix}] `,
    validKeys: ['y', 'n', 'Y', 'N', '\r', '\n'],
  })
  if (key === '\r' || key === '\n') return defaultYes
  return key.toLowerCase() === 'y'
}

export async function promptYNS(prompt: string): Promise<'y' | 'n' | 's'> {
  const key = await promptKeypress({ prompt, validKeys: ['y', 'n', 's', 'Y', 'N', 'S'] })
  return key.toLowerCase() as 'y' | 'n' | 's'
}
