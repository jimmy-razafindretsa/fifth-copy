// The guest merge (#56) runs every registered step or refuses (fail closed). Steps register when their
// feature's index is evaluated, and `next dev` gives each route graph its own registry instance, so the
// sign-in and sign-up actions only see the steps this graph imports (#36). Import every feature that
// registers one: identity's own steps come with its merge (`identity/merge/steps.ts`). Every module imported
// bare here, and this file, is listed in package.json `sideEffects` (#986), or the bundler drops it.
import "@/features/lobby";
import "@/features/results";
