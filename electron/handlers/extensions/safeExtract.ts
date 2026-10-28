/**
 * The safe package extractor lives with the API (api/ is built on its own, so the
 * one implementation has to sit inside it). The desktop uses the same code.
 */
export * from '../../../api/src/native-extensions/safeExtract'
