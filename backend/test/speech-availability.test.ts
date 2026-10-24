import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Speech, speechUnavailable, speechConfig, secondSpeechConfig } from '../src/video/speech.ts';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('enables video and podcast with one configured voice, using a distinct second voice when supplied', () => {
  vi.stubEnv('VIDEO_SPEECH_PROVIDER', 'elevenlabs');
  vi.stubEnv('ELEVENLABS_API_KEY', '');
  expect(speechUnavailable('video')).toBeTruthy(); expect(speechUnavailable('podcast')).toBeTruthy();
  expect(speechUnavailable('ai-chat')).toBeUndefined(); expect(speechUnavailable('mark-evidence')).toBeUndefined();
  vi.stubEnv('ELEVENLABS_API_KEY', 'available-key'); vi.stubEnv('ELEVENLABS_SECOND_VOICE_ID', '');
  expect(speechUnavailable('video')).toBeUndefined(); expect(speechUnavailable('podcast')).toBeUndefined();
  expect(secondSpeechConfig().voice).toBe(speechConfig().voice);
  vi.stubEnv('ELEVENLABS_SECOND_VOICE_ID', 'voice-b');
  expect(speechUnavailable('podcast')).toBeUndefined();
  expect(secondSpeechConfig().voice).toBe('voice-b');
});

it('requires explicit local speech configuration and detects an unusable local installation', () => {
  vi.stubEnv('VIDEO_SPEECH_PROVIDER', undefined); vi.stubEnv('ELEVENLABS_API_KEY', '');
  expect(speechUnavailable('video')).toBeTruthy();
  vi.stubEnv('VIDEO_SPEECH_PROVIDER', 'local'); vi.stubEnv('FFMPEG_PATH', '/missing/ffmpeg');
  expect(speechUnavailable('video')).toBeTruthy();
});

it('disables a rejected ElevenLabs key and recovers when the configuration changes', async () => {
  vi.stubEnv('VIDEO_SPEECH_PROVIDER', 'elevenlabs'); vi.stubEnv('ELEVENLABS_API_KEY', 'rejected-key');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
  const speech = new Speech({ provider: 'elevenlabs', voice: process.env.ELEVENLABS_VOICE_ID!, model: 'eleven_multilingual_v2' }, mkdtempSync(join(tmpdir(), 'l45-speech-status-')));
  await expect(speech.pcm('Test.')).rejects.toThrow('HTTP 401');
  expect(speechUnavailable('video')).toBeTruthy(); expect(speechUnavailable('podcast')).toBeTruthy();
  vi.stubEnv('ELEVENLABS_API_KEY', 'replacement-key');
  expect(speechUnavailable('video')).toBeUndefined();
});
