import type { CSSProperties } from 'react';
import type { Achievement, CompletionReward, LearningProgress, LevelProgress } from '@l45/shared';
import { XP_PER_LEVEL, levelProgress } from '@l45/shared';
import { Icon, type IconName } from '../lib/icons.tsx';

const BADGE_ICONS: Record<Achievement['id'], IconName> = {
  'first-step': 'star', 'five-lessons': 'trophy', explorer: 'map', formats: 'sparkle',
};

export function XpBar({ progress, label, from }: { progress: LevelProgress; label: string; from?: number }) {
  return (
    <span className="xp-bar" role="progressbar" aria-label={label} aria-valuenow={progress.intoLevel} aria-valuemin={0} aria-valuemax={XP_PER_LEVEL} aria-valuetext={`${progress.intoLevel} von ${XP_PER_LEVEL} XP bis Level ${progress.level + 1}`}>
      <span className={from === undefined ? '' : 'xp-fill-earned'} style={{ width: `${progress.percent}%`, '--xp-from': `${from ?? 0}%` } as CSSProperties} />
    </span>
  );
}

export function RewardsSummary({ progress, name }: { progress: LearningProgress; name: string }) {
  return (
    <section className="rewards-hero" aria-label={`Dein Lernfortschritt, Level ${progress.level}`}>
      <div className="rewards-main">
        <div className="level-emblem" aria-hidden="true"><Icon name="star" size={23} /><strong>{progress.level}</strong><span>LEVEL</span></div>
        <div className="rewards-intro">
          <p className="eyebrow">{name}</p>
          <h2>Dein Fortschritt</h2>
        </div>
      </div>
      <div className="hero-progress">
        <div className="xp-label"><strong><Icon name="sparkle" size={17} />{progress.xp} XP gesammelt</strong><span>Level {progress.level + 1}</span></div>
        <XpBar progress={progress} label="Dein Gesamtlevel" />
        <p>Noch {progress.toNextLevel} XP bis zum nächsten Level</p>
      </div>
      <div className="rewards-stats">
        <span><Icon name="book" size={18} /><strong>{progress.completedLessons}</strong> {progress.completedLessons === 1 ? 'Lektion' : 'Lektionen'}</span>
        <span><Icon name="trophy" size={18} /><strong>{progress.achievements.filter((a) => a.unlocked).length}</strong> von {progress.achievements.length} Abzeichen</span>
      </div>
    </section>
  );
}

export function LearningGoals({ progress }: { progress: LearningProgress }) {
  const days = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  return (
    <section className="learning-goals" aria-label="Deine Lernziele">
      <div className={`daily-goal${progress.todayComplete ? ' goal-done' : ''}`}>
        <span className="goal-icon"><Icon name={progress.todayComplete ? 'check' : 'target'} size={23} /></span>
        <div><span className="eyebrow">Dein Tagesziel</span><strong>{progress.todayComplete ? 'Geschafft!' : 'Eine Lektion abschliessen'}</strong></div>
      </div>
      <div className="weekly-goal">
        <div><strong>Deine Lernwoche</strong><span className="small muted">{Math.min(progress.weekActiveDays, 3)} / 3 Lerntage{progress.weekActiveDays >= 3 ? ' · Geschafft!' : ''}</span></div>
        <ol className="week-days" aria-label="Lerntage dieser Woche">
          {days.map((day, index) => <li key={day} className={progress.weekDays[index] ? 'active' : ''} aria-label={`${day}: ${progress.weekDays[index] ? 'gelernt' : 'noch offen'}`}><span>{day}</span><span className="day-dot">{progress.weekDays[index] && <Icon name="check" size={14} />}</span></li>)}
        </ol>
      </div>
    </section>
  );
}

export function Achievements({ achievements }: { achievements: Achievement[] }) {
  return (
    <section className="achievements" aria-labelledby="achievements-title">
      <div className="section-heading"><h2 id="achievements-title">Deine Meilensteine</h2></div>
      <ul className="badge-grid">
        {achievements.map((badge) => <li key={badge.id} className={`achievement${badge.unlocked ? ' unlocked' : ''}`}>
          <span className="badge-medal" aria-hidden="true"><Icon name={BADGE_ICONS[badge.id]} size={27} /><span className="badge-state"><Icon name={badge.unlocked ? 'check' : 'lock'} size={12} /></span></span>
          <strong>{badge.name}</strong><p>{badge.description}</p>
          <span className="badge-count">{badge.unlocked ? 'Verdient!' : `${badge.progress} / ${badge.target}`}</span>
        </li>)}
      </ul>
      <details className="xp-explained"><summary>Wie sammle ich XP?</summary><p>XP sind Erfahrungspunkte. Für eine neue Lektion bekommst du 40 XP, dazu bis zu 60 XP für erreichte Lernziele. Jedes Format zählt gleich viel. Tipps kosten keine Punkte. Bei Wiederholungen gibt es die zusätzlichen XP für ein besseres Ergebnis. Alle 200 XP steigst du ein Level auf, insgesamt und im jeweiligen Thema. Diese Level zeigen deinen Lernweg; dein DCC-Testresultat bleibt separat.</p></details>
    </section>
  );
}

export function TopicLevel({ progress = levelProgress(0), name }: { progress?: LevelProgress; name: string }) {
  return <span className="topic-level"><span className="xp-label"><strong>Level {progress.level}</strong><span>{progress.xp} XP</span></span><XpBar progress={progress} label={`Level in ${name}`} /></span>;
}

export function RewardCelebration({ reward, progress, trackId, trackName }: { reward: CompletionReward; progress: LearningProgress; trackId: string; trackName: string }) {
  const levelUp = reward.levelAfter > reward.levelBefore;
  const topicLevelUp = reward.topicLevelAfter > reward.topicLevelBefore;
  const topic = progress.tracks[trackId] ?? levelProgress(0);
  const previous = levelProgress(Math.max(0, topic.xp - reward.xp));
  return (
    <section className={`reward-celebration${levelUp ? ' level-up' : ''}`} aria-label="Deine Belohnung">
      {reward.xp > 0 && <div className="celebration-sparks" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ '--i': i } as CSSProperties} />)}</div>}
      <span className="celebration-medal" aria-hidden="true"><Icon name={levelUp ? 'trophy' : 'star'} size={36} /></span>
      <p className="eyebrow">{levelUp ? `Level ${reward.levelAfter} erreicht!` : reward.firstCompletion ? 'Geschafft!' : reward.xp > 0 ? 'Verbessert!' : 'Wiederholung abgeschlossen'}</p>
      <h3 className="xp-earned">{reward.xp > 0 ? `+${reward.xp} XP` : 'Übung abgeschlossen'}</h3>
      {reward.xp === 0 && <p>Weitere XP gibt es für ein besseres Ergebnis.</p>}
      <div className="reward-topic"><div className="xp-label"><strong>{trackName}</strong><span>Level {topic.level}</span></div><XpBar progress={topic} label={`Dein Fortschritt in ${trackName}`} from={topicLevelUp ? 0 : previous.percent} /><span className="small muted">{topicLevelUp ? `Neues Themenlevel: Level ${topic.level}!` : `Noch ${topic.toNextLevel} XP bis Level ${topic.level + 1}`}</span></div>
      {reward.achievements.map((badge) => <div className="unlocked-reward" key={badge.id}><Icon name={BADGE_ICONS[badge.id]} size={24} /><span><span className="eyebrow">Neues Abzeichen</span><strong>{badge.name}</strong></span><Icon name="check" size={20} /></div>)}
      {(reward.dailyGoalReached || reward.weeklyGoalReached) && <p className="goal-reached"><Icon name="check" size={18} />{reward.weeklyGoalReached ? 'Wochenziel geschafft: an 3 Tagen gelernt!' : 'Dein Tagesziel ist geschafft!'}</p>}
    </section>
  );
}
