import { createApp } from './app.ts';
import { content } from './content.ts';
import { providerName } from './provider.ts';

const port = Number(process.env.PORT ?? 8787);
createApp().listen(port, () => {
  console.log(`Lernagent auf http://localhost:${port}`);
  console.log(`Inhalt: ${content.lessons.length} Lektionen in ${content.skills.flatMap((s) => s.tracks).length} Tracks`);
  const provider = providerName();
  console.log(provider === 'none' ? 'Modell: keines konfiguriert -> vorbereitete Inhalte (Modus «Ohne KI»)' : `Modell: ${provider}`);
});
