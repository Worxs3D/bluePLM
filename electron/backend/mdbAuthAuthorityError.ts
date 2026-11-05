/** Main-only error. IPC must expose only the code, never the message or secrets. */
export class MdbAuthAuthorityError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'MdbAuthAuthorityError'
  }
}

/** Internal marker for an identity mismatch that revokes a restored session. */
export class MdbAuthIdentityChangedError extends MdbAuthAuthorityError {
  constructor() {
    super('invalid-principal-response', 'Restored identity changed.')
    this.name = 'MdbAuthIdentityChangedError'
  }
}
