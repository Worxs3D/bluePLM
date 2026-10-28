/**
 * What jsdom lacks for the vault UI: layout (the virtualized list and tree render nothing in a
 * zero-size viewport), ResizeObserver, `elementFromPoint` and DataTransfer.
 *
 * `installLayout()` gives every element a fixed box so TanStack Virtual renders its rows.
 * `dragAndDrop()` fires the HTML5 sequence (dragstart on the source, dragenter/dragover/drop on
 * the target, dragend on the source) with one shared DataTransfer, the way the browser does: what
 * the drag source writes in dragstart is what the drop handler reads.
 */
import { act, fireEvent } from '@testing-library/react'

export function installLayout(): void {
  // React's act() warns on every call unless the environment says it is a test.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: 4000,
    right: 1600,
    width: 1600,
    height: 4000,
    toJSON: () => ({}),
  }
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return rect as DOMRect
  }
  for (const prop of ['offsetHeight', 'clientHeight'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 4000 })
  }
  for (const prop of ['offsetWidth', 'clientWidth'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 1600 })
  }
  // Drag start asks what is under the pointer to refuse drags from text cells; nothing is.
  document.elementFromPoint = () => null
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
  }
  if (typeof Element.prototype.scrollIntoView !== 'function') {
    Element.prototype.scrollIntoView = function scrollIntoView() {}
  }
  if (typeof Element.prototype.scrollTo !== 'function') {
    Element.prototype.scrollTo = function scrollTo() {}
  }
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList
  }
}

/** The DataTransfer jsdom does not have: a string store plus `files`, `items` and `types`. */
export class FakeDataTransfer {
  private readonly data = new Map<string, string>()
  dropEffect: 'none' | 'copy' | 'move' | 'link' = 'none'
  effectAllowed = 'uninitialized'
  readonly files: File[] = []

  get types(): string[] {
    return [...this.data.keys(), ...(this.files.length ? ['Files'] : [])]
  }

  get items(): { length: number } & ArrayLike<unknown> {
    return Object.assign([...this.data.keys()].map(() => ({ kind: 'string' })), {
      length: this.data.size + this.files.length,
    })
  }

  setData(format: string, value: string): void {
    this.data.set(format, value)
  }

  getData(format: string): string {
    return this.data.get(format) ?? ''
  }

  clearData(format?: string): void {
    if (format) this.data.delete(format)
    else this.data.clear()
  }

  setDragImage(): void {}
}

export interface DragOptions {
  /** Hold Ctrl at drop (copy instead of move where the handler reads it). */
  ctrlKey?: boolean
  /** Reuse a DataTransfer, e.g. one prefilled to stand for a drag from another window. */
  dataTransfer?: FakeDataTransfer
  /** Skip dragstart, for drags that start elsewhere (another pane, outside the app). */
  skipDragStart?: boolean
}

/** Drag `source` and drop it on `target`, awaiting the async drop handler. */
export async function dragAndDrop(
  source: Element | null,
  target: Element,
  options: DragOptions = {},
): Promise<FakeDataTransfer> {
  const dataTransfer = options.dataTransfer ?? new FakeDataTransfer()
  const init = { dataTransfer, ctrlKey: !!options.ctrlKey, clientX: 10, clientY: 10 }
  await act(async () => {
    if (source && !options.skipDragStart) fireEvent.dragStart(source, init)
  })
  await act(async () => {
    fireEvent.dragEnter(target, init)
    fireEvent.dragOver(target, init)
  })
  await act(async () => {
    fireEvent.drop(target, init)
  })
  await act(async () => {
    if (source && !options.skipDragStart) fireEvent.dragEnd(source, init)
  })
  return dataTransfer
}
