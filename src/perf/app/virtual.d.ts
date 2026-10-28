/** Provided by scripts/render-perf/perfBuildPlugin.ts in the perf build only. */
declare module 'virtual:perf-schema-shape' {
  const shape: {
    tables: Array<[string, { columns: string[]; requiredOnInsert: string[] }]>
    functions: Array<[string, { args: string[]; required: string[] }]>
  }
  export default shape
}
