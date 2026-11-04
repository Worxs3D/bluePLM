import { useEffect, useRef, useState } from 'react'

/**
 * A text field that saves on blur or Enter: local text while typing, reset to the stored value
 * whenever that changes (a save, or another user's edit through realtime) and the field is not
 * being edited.
 */
export function useDraftField(stored: string) {
  const [draft, setDraft] = useState(stored)
  const editing = useRef(false)

  useEffect(() => {
    if (!editing.current) setDraft(stored)
  }, [stored])

  return {
    draft,
    setDraft: (value: string) => {
      editing.current = true
      setDraft(value)
    },
    /** Call on blur/Enter: returns the text to save, or null when nothing changed. */
    commit: (): string | null => {
      editing.current = false
      return draft === stored ? null : draft
    },
    /** Throw the edit away (Escape, or an invalid value). */
    revert: () => {
      editing.current = false
      setDraft(stored)
    },
  }
}
