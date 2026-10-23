// Every test file gets its own empty learner folder, so tests never touch backend/var.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.LEARNER_DIR = mkdtempSync(join(tmpdir(), 'lernagent-'));
