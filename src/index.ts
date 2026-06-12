export { run } from "./cli.ts";
export { cleanupWorkspace, type CleanupWorkspaceOptions } from "./commands/cleanupWorkspace.ts";
export { doctor } from "./commands/doctor.ts";
export {
  interruptWorkspace,
  type InterruptWorkspaceOptions,
} from "./commands/interruptWorkspace.ts";
export { orchestrate, type OrchestratorOptions } from "./commands/orchestrator.ts";
export {
  createAutopilot,
  DEFAULT_AUTOPILOT_DEPS,
  decideFollowUps,
  hasAutopilotCandidates,
  staleMemoClears,
  type Autopilot,
  type AutopilotDeps,
  type DecideFollowUpsInput,
  type FollowUpAction,
} from "./commands/autopilot.ts";
export { recordTaskAutopilot, type RecordTaskAutopilotInput } from "./lib/runState.ts";
export { formatReviewCommentsNudge, selectUndeliveredComments } from "./lib/reviewNudges.ts";
export {
  buildCiFailureNudge,
  excerptLastLines,
  fetchFailingRunLog,
  formatCiFailureNudge,
  type CiCommandRunner,
  type FailingRunLog,
} from "./lib/ciLogs.ts";
export { resumeWorkspace, type ResumeWorkspaceOptions } from "./commands/resumeWorkspace.ts";
export {
  setupWorkspace,
  setupWorkspaceCli,
  type SetupWorkspaceOptions,
} from "./commands/setupWorkspace.ts";
export { status, type StatusOptions } from "./commands/status.ts";
export type {
  AutopilotConfig,
  AutopilotUserConfig,
  Config,
  NotificationRoutingConfig,
  NotifierEntryConfig,
  HookCommands,
  AgentDefinition,
  KnownRepository,
  QuietHoursConfig,
  ResolvedConfig,
  SourceConfig,
} from "./lib/config.ts";
export { DEFAULT_AUTOPILOT, loadConfig } from "./lib/config.ts";
export { isPlainTaskId } from "./lib/taskId.ts";
export { clearPause, pausePath, readPause, recordPause, type PauseState } from "./lib/pause.ts";
export { isWithinQuietHours, nextTickDelay, type FleetPacingSignals } from "./lib/tickDelay.ts";
export {
  acquireKeepAwake,
  type AcquireKeepAwakeInput,
  type KeepAwakeHandle,
  type KeepAwakeProcess,
} from "./lib/keepAwake.ts";
export {
  clearLastSession,
  lastSessionPath,
  readLastSession,
  recordLastSession,
  runningSessionTasks,
  selectRestoreTasks,
  type LastSession,
  type LastSessionTask,
  type RestoreSelection,
  type RestoreSelectionInput,
} from "./lib/lastSession.ts";
export { parseDurationMilliseconds } from "./commands/pause.ts";
export { parseSnoozeUntil } from "./commands/snooze.ts";
export { workspaces, type WorkspaceSendResult } from "./lib/workspaces.ts";
export {
  collectFleetSnapshot,
  joinFleetSnapshot,
  type CollectFleetSnapshotInput,
  type FleetBoardFeed,
  type FleetFeedHealth,
  type FleetIssue,
  type FleetSnapshot,
  type FleetTask,
  type FleetWorkspaceLiveness,
  type FleetWorktree,
  type JoinFleetSnapshotInput,
} from "./lib/fleet.ts";
export {
  claudeProjectSlug,
  decayByAge,
  detectAwaitingInput,
  PULSE_THRESHOLDS,
  pulseDirectory,
  readPulse,
  type Pulse,
  type PulseSource,
  type PulseState,
  type ReadPulseInput,
} from "./lib/pulse.ts";
export {
  listRunStates,
  readRunState,
  recordRunState,
  recordTaskPulse,
  type RecordTaskPulseInput,
  recordTaskPullRequest,
  type RecordTaskPullRequestInput,
  recordTaskSnooze,
  type RecordTaskSnoozeInput,
  removeRunState,
  runStateDirectory,
  runStatePath,
  updateRunState,
  type RunLifecycleState,
  type RunState,
} from "./lib/runState.ts";
export {
  fetchBlockersForTask,
  fetchInProgressIssueCount,
  fetchRawLinearIssue,
  fetchResolvedIssue,
  isIssueInProgress,
  isIssueTodo,
  isTerminalStateType,
  isTerminalStatusForBlocker,
  isTerminalStatusForIssue,
  type RawLinearIssue,
} from "./lib/adapters/linear/fetch.ts";
export {
  resolveAgentFor,
  resolveRepositoryFor,
  type AgentResolution,
  type RepositoryResolution,
} from "./lib/adapters/linear/parsing.ts";
export {
  clearPullRequestLookupCache,
  fetchReviewComments,
  findPullRequestsForBranch,
  isMergeablePullRequest,
  mergePullRequest,
  type MergePullRequestInput,
  type MergePullRequestResult,
  summarizeCheckRollup,
  type CiStatus,
  type FetchReviewCommentsInput,
  type PullRequestSummary,
  type ReviewComment,
  type ReviewState,
} from "./lib/pullRequests.ts";
export { getUsageByAgent, type UsageByAgent } from "./lib/usage.ts";
export {
  CREW_EVENT_PRIORITY,
  makeCrewEvent,
  type CrewEvent,
  type CrewEventKind,
  type CrewEventPriority,
  type MakeCrewEventInput,
} from "./lib/crewEvents.ts";
export type { Notifier, NotifierContext, NotifierDefinition } from "./lib/notifierDefinition.ts";
export { notifierRegistry } from "./lib/notifiers/registry.ts";
export {
  buildNotifiers,
  buildNotifiersWith,
  dispatchCrewEvent,
  notificationRouting,
  routeEvent,
  type DispatchCrewEventInput,
  type NotificationRouting,
} from "./lib/notifiers/resolve.ts";
export { type Board, createBoard } from "./lib/board.ts";
export { buildSources, buildSourcesWith, sourcesFromConfig } from "./lib/buildSources.ts";
export type { AdapterContext, AdapterDefinition } from "./lib/adapterDefinition.ts";
export {
  adapterRegistry,
  type AdapterLoader,
  buildRegistry,
  buildSourceConfigSchema,
  listAdapterDirectories,
} from "./lib/adapters/registry.ts";
export {
  AmbiguousTaskError,
  type Blocker as CanonicalBlocker,
  type BoardState as CanonicalBoardState,
  type CanonicalStatus,
  type CreateTaskInput,
  type GroundcrewIssue as CanonicalGroundcrewIssue,
  type Issue as CanonicalIssue,
  isGroundcrewIssue as isCanonicalGroundcrewIssue,
  type ParentSkip as CanonicalParentSkip,
  type TaskSource,
} from "./lib/taskSource.ts";
