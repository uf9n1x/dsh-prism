// Prism bundle entry — Phase 0 skeleton.
// P1 will wire the real host plugin (GraphStore, tools, provider, runtime, Remote).
// Keep this dependency-free so the scaffold builds before host packages are added.

export const name = 'dsh-prism'

export function apply(): void {
  // intentionally empty in Phase 0; real wiring lands in P1–P8.
}

export default { name, apply }
