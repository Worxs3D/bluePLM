/**
 * Types of occt-import-js (OpenCascade compiled to WebAssembly; LGPL-2.1, loaded at runtime as its
 * own module and .wasm file). Only what the model preview calls.
 */
declare module 'occt-import-js' {
  export type OcctColor = [number, number, number]

  export interface OcctMesh {
    name: string
    color?: OcctColor
    brep_faces: Array<{ first: number; last: number; color: OcctColor | null }>
    attributes: {
      position: { array: ArrayLike<number> }
      normal?: { array: ArrayLike<number> }
    }
    index: { array: ArrayLike<number> }
  }

  export interface OcctResult {
    success: boolean
    meshes: OcctMesh[]
  }

  export interface OcctParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot'
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value'
    linearDeflection?: number
    angularDeflection?: number
  }

  export interface OcctModule {
    ReadStepFile(content: Uint8Array, params: OcctParams | null): OcctResult
    ReadIgesFile(content: Uint8Array, params: OcctParams | null): OcctResult
    ReadBrepFile(content: Uint8Array, params: OcctParams | null): OcctResult
  }

  export default function occtimportjs(options?: {
    locateFile?: (path: string) => string
    wasmBinary?: ArrayBuffer
  }): Promise<OcctModule>
}
