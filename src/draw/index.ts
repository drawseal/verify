// Surface publique du moteur de tirage provably-fair (cœur pur).
export { DrawEngineError } from './errors.js';
export { sha256Hex } from './hash.js';
export { canonicalize, computeFingerprint, assertValidPool } from './pool.js';
export type { PoolParticipant } from './pool.js';
export { pickWeighted } from './pick-weighted.js';
export { hashLeaf, hashNode, merkleRoot, merkleProof, verifyMerkleProof } from './merkle.js';
export type { MerkleProofStep } from './merkle.js';
export {
  canonicalEntry,
  computePoolSeal,
  poolLeaves,
  poolMatchesSeal,
  poolInclusionProof,
  sealPrecedesRandomness,
  verifyPoolInclusion,
} from './pool-seal.js';
export type { PoolSeal } from './pool-seal.js';
export {
  computeWinners,
  computeRankFinalHash,
  generateServerSeed,
  commitServerSeed,
} from './compute-winners.js';
export type { DrawCommitment, DrawInput, DrawWinner, DrawOutcome } from './compute-winners.js';
export { verifyDraw } from './verify.js';
export type { VerifyInput, VerifyResult, ClaimedWinner, SealCommitment } from './verify.js';
export { FakeRandomnessSource } from './randomness-source.js';
export type { RandomnessSource, FakeRandomnessSourceOptions } from './randomness-source.js';
export { verifyRedraws } from './verify-redraws.js';
export type {
  Designation,
  VerifyRedrawsInput,
  VerifyRedrawsResult,
  RedrawMismatch,
} from './verify-redraws.js';
export {
  computeWeights,
  type ComputeWeightsInput,
  type WeightInputParticipant,
  type WeightingMode,
} from './compute-weights.js';
export {
  buildWitnessPayload,
  witnessPayloadSha256,
  witnessPhaseOf,
  type WitnessRecordInput,
  type WitnessRecordSeal,
  type WitnessPhase,
} from './witness-record.js';
