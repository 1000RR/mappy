import { describe, expect, it, vi } from 'vitest'
import { latestPreview } from './latestPreview'

const deferred = <T,>() => {
  let resolve!: (result: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('live route preview scheduling', () => {
  it('coalesces rapid movements and only publishes and commits the latest position', async () => {
    const first = deferred<number>()
    const last = deferred<number>()
    const calculate = vi.fn((point: number) => point === 1 ? first.promise : last.promise)
    const publish = vi.fn()
    const preview = latestPreview(calculate, publish, vi.fn())
    preview.update(1)
    preview.update(2)
    preview.update(3)
    const committed = preview.finish()
    first.resolve(10)
    await Promise.resolve()
    expect(calculate.mock.calls).toEqual([[1], [3]])
    expect(publish).not.toHaveBeenCalled()
    last.resolve(30)
    await expect(committed).resolves.toBe(30)
    expect(publish.mock.calls).toEqual([[30]])
  })

  it('can show intermediate routed geometry while still committing only the final position', async () => {
    const first = deferred<number>()
    const last = deferred<number>()
    const intermediate = vi.fn()
    const publish = vi.fn()
    const preview = latestPreview((point: number) => point === 1 ? first.promise : last.promise, publish, vi.fn(), intermediate)
    preview.update(1)
    preview.update(2)
    const committed = preview.finish()
    first.resolve(10)
    await Promise.resolve()
    expect(intermediate).toHaveBeenCalledWith(10)
    expect(publish).not.toHaveBeenCalled()
    last.resolve(20)
    await expect(committed).resolves.toBe(20)
  })

  it('publishes while dragging, then rejects an invalid release rather than committing an older valid preview', async () => {
    const calculate = vi.fn(async (point: number) => {
      if (point === 2) throw new Error('No road within 200m')
      return point
    })
    const publish = vi.fn()
    const error = vi.fn()
    const preview = latestPreview(calculate, publish, error)
    preview.update(1)
    await Promise.resolve()
    expect(publish).toHaveBeenCalledWith(1)
    preview.update(2)
    await expect(preview.finish()).rejects.toThrow('No road within 200m')
    expect(error).toHaveBeenCalledOnce()
  })

  it('ignores worker results after cancellation', async () => {
    const job = deferred<number>()
    const publish = vi.fn()
    const preview = latestPreview(() => job.promise, publish, vi.fn())
    preview.update(1)
    const committed = preview.finish()
    preview.cancel()
    await expect(committed).rejects.toThrow('Drag cancelled')
    job.resolve(1)
    await Promise.resolve()
    expect(publish).not.toHaveBeenCalled()
  })
})
