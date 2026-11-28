import { useCallback, useEffect, useState } from 'react';
import { useApp } from './AppContext';
import { t } from '../i18n';

const DEMO_KEY = 'tmt-demo-labels';
const KIND = 'ui_labels';
const ID = 'scope';

interface Labels {
  plant?: string;
  suffix?: string;
}

/** Nazwy w liście zakresu („cały zakład", „HVAC — cała linia główna”) do zmiany w Ustawieniach. Puste pole = domyślny napis. */
export function useLabels(): { plant: string; suffix: string; main: (g: string) => string; raw: Labels; save: (l: Labels) => Promise<void> } {
  const { backend } = useApp();
  const [raw, setRaw] = useState<Labels>({});

  const load = useCallback(async () => {
    const db = backend.client;
    if (!db) {
      try {
        setRaw(JSON.parse(localStorage.getItem(DEMO_KEY) ?? '{}') as Labels);
      } catch {
        setRaw({});
      }
      return;
    }
    const { data } = await db.from('records').select('data').eq('kind', KIND).eq('id', ID).maybeSingle();
    setRaw((data?.data as Labels | undefined) ?? {});
  }, [backend]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(
    async (l: Labels) => {
      const clean = { plant: l.plant?.trim() || undefined, suffix: l.suffix?.trim() || undefined };
      const db = backend.client;
      if (!db) localStorage.setItem(DEMO_KEY, JSON.stringify(clean));
      else {
        const { error } = await db.from('records').upsert({ kind: KIND, id: ID, data: clean });
        if (error) throw error;
      }
      await load();
    },
    [backend, load],
  );

  const plant = raw.plant ?? t('cały zakład');
  const suffix = raw.suffix ?? t('cała linia główna');
  return { plant, suffix, main: (g) => `${g} — ${suffix}`, raw, save };
}
