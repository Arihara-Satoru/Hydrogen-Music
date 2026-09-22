import assert from 'node:assert/strict'
import {
  completeOnboardingSteps,
  getPendingOnboardingSteps,
  ONBOARDING_STORAGE_KEY,
  readOnboardingState,
  resetOnboarding,
} from '../src/utils/onboarding.mjs'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}
const stepsV1 = [{ id: 'one', scope: 'home' }, { id: 'two', scope: 'settings' }]
const stepsV2 = [...stepsV1, { id: 'three', scope: 'home' }]

assert.deepEqual(getPendingOnboardingSteps(storage, stepsV1), stepsV1)
assert.deepEqual(getPendingOnboardingSteps(storage, stepsV2, 'home').map(({ id }) => id), ['one', 'three'])
completeOnboardingSteps(storage, ['one', 'two'], 1)
assert.deepEqual(getPendingOnboardingSteps(storage, stepsV2).map(({ id }) => id), ['three'])
assert.deepEqual(getPendingOnboardingSteps(storage, stepsV2, 'settings'), [])
completeOnboardingSteps(storage, ['three'], 2)
assert.deepEqual(readOnboardingState(storage), { version: 2, completedStepIds: ['one', 'two', 'three'] })
resetOnboarding(storage)
assert.equal(storage.getItem(ONBOARDING_STORAGE_KEY), null)
console.log('onboarding check passed')
