// Every test file gets its own empty learner folder, so tests never touch backend/var.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests opt into model calls explicitly; media tests inject speakers instead of making paid calls.
process.env.MODEL_PROVIDER = 'none';
process.env.VIDEO_SPEECH_PROVIDER = 'elevenlabs';
process.env.ELEVENLABS_API_KEY = 'test-speech-key';
process.env.ELEVENLABS_VOICE_ID = 'test-voice-a';
process.env.ELEVENLABS_SECOND_VOICE_ID = 'test-voice-b';

process.env.LEARNER_DIR = mkdtempSync(join(tmpdir(), 'lernagent-'));
