/** Serialize expensive previews, replacing queued mouse positions with the latest one. */
export function latestPreview<Input, Output>(
  calculate: (input: Input) => Promise<Output>,
  publish: (output: Output) => void,
  reportError: (error: unknown) => void,
  publishIntermediate?: (output: Output) => void
) {
  let version = 0
  let completed = 0
  let running = false
  let cancelled = false
  let input: Input
  let result: Output
  let failure: unknown
  let failed = false
  let final: { resolve: (output: Output) => void; reject: (error: unknown) => void } | null = null
  const settle = () => {
    if (!final || completed !== version) return
    if (failed) final.reject(failure)
    else final.resolve(result)
    final = null
  }
  const run = async () => {
    if (running || cancelled) return
    running = true
    while (!cancelled && completed !== version) {
      const request = version
      const point = input
      try {
        const output = await calculate(point)
        if (!cancelled && request === version) { result = output; failed = false; publish(output) }
        else if (!cancelled) publishIntermediate?.(output)
      } catch (error) {
        if (!cancelled && request === version) { failure = error; failed = true; reportError(error) }
      }
      completed = request
    }
    running = false
    if (!cancelled) settle()
  }
  return {
    update(next: Input) { if (cancelled || final) return; input = next; version++; void run() },
    finish(): Promise<Output> {
      if (cancelled) return Promise.reject(new Error('Drag cancelled'))
      return new Promise((resolve, reject) => { final = { resolve, reject }; settle() })
    },
    cancel() { cancelled = true; final?.reject(new Error('Drag cancelled')); final = null }
  }
}
