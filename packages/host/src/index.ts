export type {ChunkRequest} from './lesson/ChunkRequest';
export {Lesson} from './lesson/Lesson';
export type {LessonAdvanceResult, LessonOptions} from './lesson/Lesson';
export {initialLessonState} from './lesson/LessonState';
export type {BeatRecord, LessonState} from './lesson/LessonState';
export {LessonStore} from './lesson/LessonStore';

export {BeatAdapter} from './presentation/BeatAdapter';
export type {BeatAuditSpec, BeatManifest} from './presentation/BeatManifest';
export {BEAT_SIZE, BeatPresentation} from './presentation/BeatPresentation';
export {BeatScrubber} from './presentation/BeatScrubber';
export type {
  BeatScrubberOptions,
  ScrubberState,
} from './presentation/BeatScrubber';
export {resolveBeatSource} from './presentation/BeatSource';
export {TransitionDriver} from './presentation/TransitionDriver';
export type {
  TransitionDriverOptions,
  TransitionTarget,
} from './presentation/TransitionDriver';
export {buildBeatProject} from './presentation/buildBeatProject';
export {createFallbackBeat} from './presentation/fallbackBeat';
export {createOpenerBeat} from './presentation/openerBeat';
export {attemptMechanicalRepair} from './presentation/repair';
export type {RepairResult} from './presentation/repair';
export {
  createHarmonicOscillatorBeat,
  createKeplerianOrbitBeat,
  createProjectileDragBeat,
} from './presentation/simulationBeats';

export {BeatStagingCoordinator} from './orchestration/BeatStagingCoordinator';
export type {
  AttemptsExhausted,
  BeatStagingResult,
} from './orchestration/BeatStagingCoordinator';
export {LessonHost} from './orchestration/LessonHost';
export type {LessonHostOptions} from './orchestration/LessonHost';
