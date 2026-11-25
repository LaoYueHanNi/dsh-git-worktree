/**
 * Global toast host mounted into `shell.overlay` so worktree notifications
 * survive session switches and modal closes.
 *
 * @module git-worktree/client/ToastHost
 */

import { useEffect, useState } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { peekToast, registerToastHost, shiftToast, subscribeToasts, type QueuedToast } from './toast-bus.ts'

/** Render the head entry of the shared git-worktree toast queue. */
export function WorktreeToastHost() {
  const [head, setHead] = useState<QueuedToast | undefined>(() => peekToast())
  useEffect(() => {
    const unregister = registerToastHost()
    setHead(peekToast())
    const off = subscribeToasts(() => { setHead(peekToast()) })
    return () => {
      off()
      unregister()
    }
  }, [])
  if (head === undefined) return null
  return (
    <Toast
      key={head.seq}
      text={head.text}
      {...(head.tone === undefined ? {} : { tone: head.tone })}
      onDone={() => { shiftToast(head.seq) }}
    />
  )
}
