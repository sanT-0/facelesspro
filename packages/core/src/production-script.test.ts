import { describe, expect, it } from 'vitest';

import { parseProductionScript } from './production-script';

const POLICE_PROMPT = `# A DAY IN THE LIFE OF AN INDIAN POLICE OFFICER

### [0:00–0:30] THE HOOK

**Visual:** Dark screen. Police sirens. A police vehicle speeding through the streets. Close-up of a police officer putting on his uniform.

**Voiceover:**

"Imagine waking up every morning, knowing that today could be the most dangerous day of your life.

You don't know whether you'll return home safely.

You might face criminals, angry crowds, accidents, or life-threatening situations.

But you still wear that uniform.

Why?

Because millions of people depend on you.

This is the untold reality of an Indian police officer."

### [0:30–1:15] THE MORNING ROUTINE

**Visual:** Sunrise, police station, officers getting ready, uniform inspection.

**Voiceover:**

"A police officer's day often begins early.

Before most people start their daily routines, officers are already preparing for duty.

Uniforms are checked. Equipment is prepared. Instructions are received.

At the police station, officers discuss ongoing investigations, complaints, security arrangements, and important cases.

For them, every day brings a new responsibility.

And sometimes, there is no fixed time to go home."

### [1:15–2:00] THE REAL RESPONSIBILITIES

**Visual:** Traffic police managing roads, officers helping elderly people, police patrol vehicles.

**Voiceover:**

"Police work is not just about catching criminals.

They manage traffic, prevent crimes, investigate complaints, maintain public order, and help people during emergencies.

Imagine an accident happening on a busy road.

While everyone else watches, a police officer must take action.

They help injured people, control traffic, and coordinate emergency assistance.

Sometimes, a simple decision can save someone's life."

### [2:00–3:00] THE DANGEROUS SIDE

**Visual:** Night patrol, flashing police lights, officers entering a dark street, crime investigation.

**Voiceover:**

"But there is another side to this uniform.

A side that many people never see.

Night patrols. Dangerous criminals. Violent situations. Unexpected emergencies.

Police officers often face situations where one wrong decision can change everything.

They may work during festivals, holidays, and even natural disasters.

While families celebrate together, some officers remain on duty to protect them.

And behind every uniform is a human being.

Someone's son. Someone's daughter. Someone's husband. Someone's father.

They also have families waiting for them at home."

### [3:00–4:00] THE SACRIFICES

**Visual:** Police officer looking at family photographs, empty police station at night, officer walking alone.

**Voiceover:**

"One of the hardest parts of police life is sacrifice.

Missed family functions. Interrupted sleep. Long working hours.

Sometimes, officers cannot even attend important moments in their children's lives.

Yet they continue their responsibilities.

Not every police officer becomes famous.

Not every good action gets recorded.

And not every sacrifice gets recognized.

But their responsibility remains the same.

To protect the public and uphold the law."

### [4:00–4:40] THE MESSAGE

**Visual:** Police officer helping a child cross the road, saluting the national flag, police team standing together.

**Voiceover:**

"Of course, like every profession, policing has challenges and imperfections.

Accountability, honesty, and respect for people's rights are essential.

A good police officer is not someone who makes people afraid.

A good police officer is someone who makes people feel safe.

The uniform is not just a symbol of authority.

It represents responsibility, discipline, courage, and service."

### [4:40–5:00] POWERFUL ENDING + CTA

**Visual:** Slow-motion police officer walking towards the camera. Indian flag in the background. Fade to black.

**Voiceover:**

"The next time you see a police officer standing on a road in the middle of the night, remember...

While you are sleeping peacefully, someone is working to keep your world safe.

Respect the uniform.

Respect the duty.

And never forget the human being behind the badge.

If you respect those who protect society, share this video.

Because sometimes, the greatest heroes don't wear capes.

They wear uniforms."

**[END SCREEN]**

LIKE 👍 | SHARE | SUBSCRIBE
`;

describe('parseProductionScript', () => {
  it('splits the police prompt into seven spoken sections', () => {
    const parsed = parseProductionScript(POLICE_PROMPT);
    expect(parsed).not.toBeNull();
    if (parsed === null) throw new Error('expected a production script');

    expect(parsed.title).toBe('A DAY IN THE LIFE OF AN INDIAN POLICE OFFICER');
    expect(parsed.sections).toHaveLength(7);
    expect(parsed.sections.map((section) => section.heading)).toEqual([
      'THE HOOK',
      'THE MORNING ROUTINE',
      'THE REAL RESPONSIBILITIES',
      'THE DANGEROUS SIDE',
      'THE SACRIFICES',
      'THE MESSAGE',
      'POWERFUL ENDING + CTA',
    ]);
  });

  it('keeps each section’s labelled time range', () => {
    const parsed = parseProductionScript(POLICE_PROMPT);
    if (parsed === null) throw new Error('expected a production script');

    expect(parsed.sections[0]).toMatchObject({ startMs: 0, endMs: 30_000 });
    expect(parsed.sections[1]).toMatchObject({ startMs: 30_000, endMs: 75_000 });
    expect(parsed.sections[3]).toMatchObject({ startMs: 120_000, endMs: 180_000 });
    expect(parsed.sections[6]).toMatchObject({ startMs: 280_000, endMs: 300_000 });
  });

  it('uses the Visual direction for images and never narrates it', () => {
    const parsed = parseProductionScript(POLICE_PROMPT);
    if (parsed === null) throw new Error('expected a production script');

    expect(parsed.sections[0]?.visual).toBe(
      'Dark screen. Police sirens. A police vehicle speeding through the streets. Close-up of a police officer putting on his uniform.',
    );
    expect(parsed.sections[3]?.visual).toBe(
      'Night patrol, flashing police lights, officers entering a dark street, crime investigation.',
    );
  });

  it('narrates only the Voiceover text, with markdown and quotes removed', () => {
    const parsed = parseProductionScript(POLICE_PROMPT);
    if (parsed === null) throw new Error('expected a production script');

    const first = parsed.sections[0]?.narration ?? '';
    expect(first.startsWith('Imagine waking up every morning')).toBe(true);
    expect(first.endsWith('This is the untold reality of an Indian police officer.')).toBe(true);
    expect(first).not.toContain('"');
    expect(first).not.toContain('Visual');
    expect(first).not.toContain('Voiceover');
    expect(first).not.toContain('#');
  });

  it('drops the end screen and the CTA strip but keeps a spoken CTA sentence', () => {
    const parsed = parseProductionScript(POLICE_PROMPT);
    if (parsed === null) throw new Error('expected a production script');

    const last = parsed.sections[6]?.narration ?? '';
    expect(last).toContain('If you respect those who protect society, share this video.');
    expect(last).not.toContain('END SCREEN');
    expect(last).not.toContain('LIKE');
    expect(last).not.toContain('SUBSCRIBE');
    expect(last).not.toContain('👍');
  });

  it('joins every section into the narration script', () => {
    const parsed = parseProductionScript(POLICE_PROMPT);
    if (parsed === null) throw new Error('expected a production script');

    expect(parsed.narration).toContain('Imagine waking up every morning');
    expect(parsed.narration).toContain('They wear uniforms.');
    expect(parsed.narration).not.toMatch(/\d+:\d{2}/u);
    expect(parsed.narration).not.toContain('**');
  });

  it('returns null for an ordinary narration script', () => {
    expect(parseProductionScript('வணக்கம். இன்று நாம் பேசுவோம்.')).toBeNull();
    expect(parseProductionScript('A plain English script. Nothing staged here.')).toBeNull();
  });

  it('accepts an unquoted Voiceover block', () => {
    const parsed = parseProductionScript(
      ['## Intro', '', 'Visual: a red car', '', 'Voiceover: hello there.', 'This is unquoted.'].join(
        '\n',
      ),
    );
    if (parsed === null) throw new Error('expected a production script');
    expect(parsed.sections[0]?.narration).toBe('hello there. This is unquoted.');
    expect(parsed.sections[0]?.visual).toBe('a red car');
  });

  it('accepts headings without a time range', () => {
    const parsed = parseProductionScript('## Intro\n\nVisual: a street\n\nVoiceover: Namaste.');
    if (parsed === null) throw new Error('expected a production script');
    expect(parsed.sections[0]).toMatchObject({
      heading: 'Intro',
      startMs: null,
      endMs: null,
      narration: 'Namaste.',
    });
  });

  it('keeps Tamil narration intact', () => {
    const parsed = parseProductionScript(
      ['### காட்சி', '', 'Visual: ஒரு தெரு', '', 'Voiceover: வணக்கம் நண்பர்களே.', 'இன்று பேசுவோம்.'].join(
        '\n',
      ),
    );
    if (parsed === null) throw new Error('expected a production script');
    expect(parsed.sections[0]?.narration).toBe('வணக்கம் நண்பர்களே. இன்று பேசுவோம்.');
    expect(parsed.sections[0]?.visual).toBe('ஒரு தெரு');
  });
});
