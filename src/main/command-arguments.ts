export function parseCommandArguments(text: string): string[] {
  const args: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let started = false
  const source = text.trim()

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] as string
    if (quote !== undefined) {
      if (character === quote) quote = undefined
      else if (quote === '"' && character === '\\' && (source[index + 1] === '"' || source[index + 1] === '\\')) {
        current += source[index + 1]
        index += 1
      }
      else current += character
      started = true
    } else if (character === '"' || character === "'") {
      quote = character
      started = true
    } else if (/\s/u.test(character)) {
      if (started) {
        args.push(current)
        current = ''
        started = false
      }
    } else {
      current += character
      started = true
    }
  }

  if (quote !== undefined) throw new Error('命令参数中存在未闭合的引号。')
  if (started) args.push(current)
  return args
}
