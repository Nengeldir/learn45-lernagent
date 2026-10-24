// The lesson validator: the same rules for the prepared pool and for generated lessons.
import { describe, expect, it } from 'vitest';
import type { Lesson, MockSiteLesson, VideoLesson } from '@l45/shared';
import { content, getTrack, rejectedLessons } from '../src/content.ts';
import { shuffleQuiz } from '../src/generator.ts';
import { validateLesson } from '../src/validate.ts';
import { mockSiteJson } from './helpers.ts';

const sicherheit = getTrack('t-sicherheit')!;
const urls = ['https://www.bacs.admin.ch/de/phishing-de'];
const pool = (id: string) => structuredClone(content.lessons.find((l) => l.id === id)!) as Lesson;

function generatedMockSite(domain?: string): MockSiteLesson {
  const raw = JSON.parse(mockSiteJson({ domain }));
  return {
    id: 'ki-test', trackId: 't-sicherheit', type: 'mock-site', level: 'Grundstufe', title: raw.title, intro: raw.intro, durationMin: 3,
    mode: 'alone', targets: ['link'], source: 'model', primarySource: { title: 'BACS', url: urls[0] },
    provenance: { by: 'model', model: 'mock', at: '2026-10-24T00:00:00Z', basedOn: [], sessionNo: 1 },
    content: raw.content,
  };
}

describe('Validator', () => {
  it('nimmt alle vorbereiteten Lektionen an', () => {
    expect(rejectedLessons).toEqual([]);
    expect(content.lessons.length).toBe(24);
  });

  it('nimmt eine gültige erzeugte Webseiten-Lektion an', () => {
    expect(validateLesson(generatedMockSite(), { track: sicherheit, sourceUrls: urls })).toEqual([]);
  });

  it('lehnt echt wirkende Domains und echte Marken ab', () => {
    const errors = validateLesson(generatedMockSite('kundenportal.ch'), { track: sicherheit, sourceUrls: urls });
    expect(errors.join()).toMatch(/nur erfundene \.example-Adressen erlaubt, gefunden: kundenportal\.ch/);

    const l = generatedMockSite();
    l.content.mail![0].text = 'PostFinance <service@postfinance-info.example>';
    expect(validateLesson(l, { track: sicherheit, sourceUrls: urls }).join()).toMatch(/echte Marken.*postfinance/);
  });

  it('prüft, dass Entscheid und Warnzeichen zusammenpassen', () => {
    const l = generatedMockSite();
    l.content.correctVerdict = 'echt';
    expect(validateLesson(l, { track: sicherheit, sourceUrls: urls }).join()).toMatch(/«echt», aber Warnzeichen/);
    for (const p of [...l.content.mail!, ...l.content.site]) delete p.signal;
    l.content.correctVerdict = 'phishing';
    expect(validateLesson(l, { track: sicherheit, sourceUrls: urls }).join()).toMatch(/«phishing», aber kein Warnzeichen/);
  });

  it('lehnt Quizfragen mit ungleich langen Antworten ab', () => {
    const l = pool('sich-v1') as VideoLesson;
    l.content.questions[0].options = ['Kurz', 'Eine viel längere Antwort als die anderen', 'Mittel lang'];
    expect(validateLesson(l, { track: sicherheit }).join()).toMatch(/höchstens 2 Wörter unterscheiden \(jetzt 1\/7\/2\)/);
  });

  it('lässt Antworten zu, die sich um bis zu 2 Wörter unterscheiden', () => {
    const l = pool('sich-v1') as VideoLesson;
    l.content.questions[0].options = ['Eins zwei drei', 'Eins zwei drei vier', 'Eins zwei drei vier fünf'];
    expect(validateLesson(l, { track: sicherheit }).join()).not.toMatch(/Wörter/);
  });

  it('lehnt die richtige Antwort immer an derselben Stelle ab', () => {
    const l = pool('sich-v1') as VideoLesson;
    l.content.questions.forEach((q) => (q.correct = 0));
    expect(validateLesson(l, { track: sicherheit }).join()).toMatch(/an derselben Stelle/);
  });

  it('mischt die richtige Antwort an verschiedene Stellen', () => {
    for (let i = 0; i < 20; i++) {
      const qs = shuffleQuiz([
        { options: ['richtig eins', 'falsch zwei', 'falsch drei'], correct: 0 },
        { options: ['richtig vier', 'falsch fünf', 'falsch sechs'], correct: 0 },
      ]);
      expect(qs[0].correct).not.toBe(qs[1].correct);
      expect(qs[0].options[qs[0].correct]).toBe('richtig eins');
      expect(qs[1].options[qs[1].correct]).toBe('richtig vier');
    }
  });

  it('verlangt Schweizer Schreibweise, höchstens 5 Minuten und eine Quelle aus der Liste', () => {
    const l = generatedMockSite();
    l.title = 'Grüße aus dem Kundenportal';
    l.durationMin = 8;
    l.primarySource = { title: 'Blog', url: 'https://irgendwo.example/blog' };
    const e = validateLesson(l, { track: sicherheit, sourceUrls: urls }).join();
    expect(e).toMatch(/ss statt ß/);
    expect(e).toMatch(/Dauer muss 1 bis 5 Minuten/);
    expect(e).toMatch(/steht nicht in den Quellen/);
  });

  it('verlangt bei Text prüfen einen erfundenen Satz mit Kriterium des Bereichs', () => {
    const l = pool('info-m1');
    if (l.type !== 'mark-evidence') throw new Error('Testdaten');
    for (const s of l.content.summary) s.verdict = 'belegt';
    expect(validateLesson(l, { track: getTrack('t-info') }).join()).toMatch(/mindestens ein Satz muss «erfunden» sein/);
    const l2 = pool('info-m1');
    if (l2.type !== 'mark-evidence') throw new Error('Testdaten');
    l2.content.summary.find((s) => s.verdict === 'erfunden')!.criterion = 'gibtsnicht';
    expect(validateLesson(l2, { track: getTrack('t-info') }).join()).toMatch(/unbekanntes Kriterium gibtsnicht/);
  });
});
