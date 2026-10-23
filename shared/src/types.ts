// Shared types. Three separate data areas: diagnostics (DCC), learning (map, results), transfer.

export type DccLevel = 'Grundstufe' | 'Mittelstufe' | 'Fortgeschritten';
export const DCC_LEVELS: DccLevel[] = ['Grundstufe', 'Mittelstufe', 'Fortgeschritten'];

export type Mode = 'alone' | 'ai' | 'peer';
/** Where content or a decision came from. Shown as a tag in the UI. */
export type Source = 'rule' | 'model' | 'prepared' | 'simulation';

// ---------------------------------------------------------------------------
// Diagnostics: the DCC profile. Read-only once loaded. Learning never changes it.
// ---------------------------------------------------------------------------

export interface DccProfile {
  /** How the profile came in */
  source: 'file' | 'manual';
  fileName?: string;
  assessedOn: string | null;
  /** level per track id; null = "nicht erhoben" (never treated as low) */
  levels: Record<string, DccLevel | null>;
}

/** Format of a DCC result file (synthetic). */
export interface DccResultFile {
  type: 'dcc-result';
  version: 1;
  synthetic: true;
  assessedOn?: string;
  areas: { area: string; name?: string; level: DccLevel | null }[];
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export interface Skill {
  id: string;
  name: string;
  dccBased: boolean;
  tracks: Track[];
}

export interface Track {
  id: string;
  skillId: string;
  name: string;
  /** DigComp 2.2 area number, only for DCC-based skills */
  dccArea?: string;
  /** Kinds of things the learner should notice or include, used as criteria */
  criteria: Criterion[];
  /** Asked the first time the track is opened: three suggestions, plus a default when skipped */
  mission?: { suggestions: string[]; default: string };
}

export interface Criterion {
  id: string;
  label: string;
  ruleOfThumb: string;
}

export type LessonType = 'video' | 'ai-chat' | 'mock-site' | 'mark-evidence';

interface LessonBase {
  id: string;
  trackId: string;
  type: LessonType;
  /** Which DCC level this lesson is written for */
  level: DccLevel;
  title: string;
  /** One sentence: what the learner does */
  intro: string;
  durationMin: number;
  mode: Mode;
  /** Criterion ids of the track this lesson trains */
  targets: string[];
  transfer?: string;
  source: 'prepared' | 'model';
  /** The one high-trust source the lesson builds on (from data/resources/<trackId>.md) */
  primarySource?: { title: string; url: string };
  /** Only for lessons made during learning (by a rule template or by the model) */
  provenance?: LessonProvenance;
}

export interface LessonProvenance {
  by: 'rule' | 'model';
  model?: string;
  at: string;
  /** Learning record and event ids the lesson was made for */
  basedOn: string[];
  sessionNo: number;
  /** Criteria a mixed review lesson brings back */
  reviewOf?: string[];
}

// --- Video (Aha video or placeholder storyboard) ---
export type VideoVisual = 'next-word' | 'invented-detail' | 'secant-tangent' | 'slope-zoom' | 'steps' | 'falling' | 'url-parts';
export interface VideoScene {
  caption: string;
  visual: VideoVisual;
  /** For 'steps' and 'url-parts': short labels shown in the animation */
  items?: string[];
  seconds: number;
}
export interface VideoQuestion {
  afterScene: number;
  prompt: string;
  options: string[];
  correct: number;
  explanation: string;
  criterion?: string;
}
export interface VideoLesson extends LessonBase {
  type: 'video';
  content: { videoUrl?: string; scenes: VideoScene[]; questions: VideoQuestion[] };
}

// --- Chat with the AI ---
export interface ChatCriterion {
  id: string;
  label: string;
  hint: string;
  /** Case-insensitive regex for judging without a model (learner messages only) */
  patterns: string[];
}
export interface AiChatLesson extends LessonBase {
  type: 'ai-chat';
  content: {
    /** tutor: asks questions; roleplay: plays a role; prompt-lab: executes the learner's prompt literally */
    kind: 'tutor' | 'roleplay' | 'prompt-lab';
    /** What the learner should achieve, shown on screen */
    goal: string;
    /** Instructions for the model: who it plays and how it behaves */
    aiRole: string;
    /** First AI message */
    opening: string;
    /** Synthetic material shown next to the chat (notes, error message, ...) */
    material?: { title: string; lines: string[] };
    criteria: ChatCriterion[];
    /** Scripted AI replies used without a model, in order; the last one repeats */
    fallbackReplies: string[];
    /** Number of learner messages before the lesson can be finished */
    minTurns: number;
  };
}

// --- Inspect a fictional website or mail ---
export type MockPartKind = 'from' | 'subject' | 'greeting' | 'paragraph' | 'link' | 'signature' | 'url' | 'logo' | 'heading' | 'field' | 'button' | 'footer';
export interface MockPart {
  id: string;
  kind: MockPartKind;
  text: string;
  linkTarget?: string;
  signal?: { criterion: string; explanation: string };
  harmless?: string;
}
export interface MockSiteLesson extends LessonBase {
  type: 'mock-site';
  content: {
    disclaimer: string;
    mail?: MockPart[];
    site: MockPart[];
    correctVerdict: 'phishing' | 'echt';
    verdictExplanation: string;
  };
}

// --- Check an AI summary against its source ---
export interface SummarySentence {
  id: string;
  text: string;
  verdict: 'belegt' | 'erfunden';
  criterion?: string;
  explanation: string;
  hint?: string;
  correction?: string;
}
export interface MarkEvidenceLesson extends LessonBase {
  type: 'mark-evidence';
  content: { noteTitle: string; note: string[]; summary: SummarySentence[] };
}

export type Lesson = VideoLesson | AiChatLesson | MockSiteLesson | MarkEvidenceLesson;

// ---------------------------------------------------------------------------
// Answers and results
// ---------------------------------------------------------------------------

export interface ChatTurn {
  role: 'ai' | 'learner';
  text: string;
  source?: Source;
}

export type Answer =
  | { type: 'video'; answers: Record<number, number> }
  | { type: 'ai-chat'; turns: ChatTurn[] }
  | { type: 'mock-site'; marked: string[]; verdict: 'phishing' | 'echt' | null }
  | { type: 'mark-evidence'; marks: Record<string, 'belegt' | 'erfunden'> };

export interface CriterionResult {
  key: string;
  label: string;
  status: 'met' | 'missed';
  note?: string;
}

export interface LessonResult {
  allMet: boolean;
  criteria: CriterionResult[];
  items: { label: string; correct: boolean; text: string }[];
  summary: string;
  judgedBy: 'rule' | 'model' | 'keywords';
}

export interface PartialCheck {
  complete: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Learning area: the mind map and what happened on it
// ---------------------------------------------------------------------------

export type NodeKind = 'start' | 'skill' | 'track' | 'lesson';
export type NodeState = 'planned' | 'recommended' | 'alternative' | 'done' | 'skipped';

export interface MapNode {
  id: string;
  kind: NodeKind;
  parentId: string | null;
  label: string;
  skillId?: string;
  trackId?: string;
  lessonId?: string;
  state?: NodeState;
  /** Added by the agent after a result (the map grows) */
  addedByAgent?: boolean;
  /** Added by the rules only for a provisional plan; removed again if the agent's plan is accepted */
  provisionalOf?: string;
  recommendationId?: string;
  result?: LessonResult;
  helpUsed?: boolean;
}

export type RuleId = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7' | 'A1';

export interface Recommendation {
  id: string;
  createdAt: string;
  ruleId: RuleId;
  ruleName: string;
  nodeId: string;
  alternativeNodeId?: string;
  /** What the agent saw */
  observation: string;
  /** Short reason */
  reason: string;
  /** Didactic justification: why this step and mode help now */
  why: string;
  tags: Source[];
  status: 'open' | 'accepted' | 'declined';
  /** Rule plan shown while the planner agent still works on it */
  provisional?: boolean;
  /** Learning record and event ids the recommendation cites (A1) */
  basedOn?: string[];
}

export interface Observation {
  id: string;
  trackId: string;
  criterion: string;
  text: string;
  count: number;
  status: 'active' | 'outdated';
  createdAt: string;
}

export interface LearningEvent {
  id: string;
  at: string;
  nodeId: string;
  lessonId: string;
  trackId: string;
  mode: Mode;
  helpUsed: boolean;
  /** 1 = right at the first check */
  attempts: number;
  durationMin: number;
  result: LessonResult;
  source: Source;
}

export interface ModelCall {
  at: string;
  purpose: 'chat' | 'judge' | 'hint' | 'generate' | 'plan';
  ok: boolean;
  fallback: boolean;
  ms: number;
}

export type ModelStatus = 'online' | 'offline' | 'simulation';

// ---------------------------------------------------------------------------
// Teaching workspace per learner (on disk). Learning area only, never diagnostics.
// ---------------------------------------------------------------------------

/** One DCC result as it came in. The latest snapshot is the active profile. */
export interface DccSnapshot {
  at: string;
  source: DccProfile['source'];
  fileName?: string;
  profile: DccProfile;
}

export interface LearnerProfile {
  id: string;
  name: string;
  createdAt: string;
  dccSnapshots: DccSnapshot[];
}

export interface Mission {
  trackId: string;
  text: string;
  /** set: chosen or written by the learner. default: skipped, the track's default is used */
  status: 'set' | 'default';
  updatedAt: string;
}

/** A change of a mission the learner confirmed. Its id is evidence for a mission-shift record. */
export interface MissionChange {
  id: string;
  at: string;
  trackId: string;
  from: string;
  to: string;
}

export type RecordKind = 'demonstrated' | 'prior-knowledge' | 'misconception' | 'mission-shift';

/** Decision-grade insight, not a log entry. Cites the events that prove it. */
export interface LearningRecord {
  id: string;
  trackId: string;
  criterion?: string;
  kind: RecordKind;
  /** 'active' or 'superseded by LR-0007' */
  status: string;
  evidence: string[];
  title: string;
  body: string;
  createdAt: string;
  author: 'rule' | 'agent';
}

/** Merkblatt line: a rule of thumb or a glossary term the learner has demonstrated */
export interface ReferenceEntry {
  section: 'rule' | 'term';
  title: string;
  text: string;
  basedOn: string[];
}

/** A demonstrated criterion waiting for spaced retrieval practice */
export interface ReviewItem {
  id: string;
  trackId: string;
  criterion: string;
  recordId: string;
  addedAt: string;
  /** Number of events when it was added; due after 2 more lessons */
  addedAfterEvents: number;
  /** Due in a later session at the latest */
  addedInSession: number;
  status: 'waiting' | 'done';
  doneEventId?: string;
}

export type LernstandState = 'unbekannt' | 'am-ueben' | 'sicher';

/** Learning progress per criterion, derived from learning records. Not a DCC level. */
export interface LernstandEntry {
  trackId: string;
  criterion: string;
  state: LernstandState;
  recordIds: string[];
}

export interface PlannerRun {
  id: string;
  eventId: string;
  trackId: string;
  startedAt: string;
  finishedAt?: string;
  steps: number;
  outcome: 'running' | 'accepted' | 'fallback';
  /** Why the rules decided, or what the agent did */
  note: string;
  /** Tools the agent called, in order */
  tools: string[];
}

export interface Session {
  id: string;
  learnerId: string;
  /** Counts logins of this learner; 1 = first session */
  sessionNo: number;
  createdAt: string;
  userName: string;
  timeBudgetMin: number;
  usedMin: number;
  /** Forces prepared content, as if the model were unreachable */
  simulation: boolean;
  nodes: MapNode[];
  recommendations: Recommendation[];
  observations: Observation[];
  events: LearningEvent[];
  transfer: { at: string; lessonTitle: string; text: string }[];
  helpUsed: Record<string, boolean>;
  checks: Record<string, number>;
  modelCalls: ModelCall[];
  generatedLessons: Lesson[];
  reviewQueue: ReviewItem[];
  missionChanges: MissionChange[];
  plannerRuns: PlannerRun[];
  /** True while the planner agent works on the next step */
  planning: boolean;
}

export interface WorkspaceView {
  missions: Mission[];
  records: LearningRecord[];
  reference: Record<string, ReferenceEntry[]>;
  notes: string[];
  lernstand: LernstandEntry[];
  dccSnapshots: Omit<DccSnapshot, 'profile'>[];
}

/** What the browser gets: session and the read-only DCC profile, kept apart */
export interface SessionView {
  session: Omit<Session, 'generatedLessons'>;
  dcc: DccProfile;
  recommendation: Recommendation | null;
  remainingMin: number;
  modelStatus: ModelStatus;
  /** Whether a planner agent can run (Anthropic or mock, not simulated offline) */
  agentAvailable: boolean;
  workspace: WorkspaceView;
}

/** Login with a name that already exists: the learner chooses to continue or start fresh */
export interface LoginConflict {
  code: 'learner-exists';
  name: string;
  createdAt: string;
  lessonsDone: number;
}

export interface ContentBundle {
  skills: Skill[];
  lessons: Lesson[];
}

export const MODE_LABEL: Record<Mode, string> = { alone: 'Alleine', ai: 'Mit KI', peer: 'Mit anderen' };
export const SOURCE_LABEL: Record<Source, string> = { rule: 'Regel', model: 'KI', prepared: 'Vorbereitet', simulation: 'Simulation' };
export const RECORD_KIND_LABEL: Record<RecordKind, string> = {
  demonstrated: 'Ohne Hilfe gezeigt',
  'prior-knowledge': 'Vorwissen',
  misconception: 'Fehlvorstellung korrigiert',
  'mission-shift': 'Mission geändert',
};
export const LERNSTAND_LABEL: Record<LernstandState, string> = { unbekannt: 'unbekannt', 'am-ueben': 'am Üben', sicher: 'sicher' };
export const TYPE_LABEL: Record<LessonType, string> = {
  video: 'Video',
  'ai-chat': 'Mit der KI',
  'mock-site': 'Webseite prüfen',
  'mark-evidence': 'Text prüfen',
};
