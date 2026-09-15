'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuthorVoice, FinishProject } from '@/lib/author-types';
import { listAuthorVoices, listFinishProjects } from '@/lib/storage';
import FinishOverview, { OverviewTab } from './FinishOverview';
import NewFinishProject from './NewFinishProject';
import FinishWorkspace, { CreateBookInput } from './FinishWorkspace';

interface Props {
  onBack: () => void;
  onCreateBook: (m: CreateBookInput) => void;
}

type View = { name: 'overview' } | { name: 'new' } | { name: 'workspace'; project: FinishProject };

// "Slutför din bok": översikt → nytt projekt → skrivbord med tidslinje och kapitel
export default function FinishBook({ onBack, onCreateBook }: Props) {
  const [view, setView] = useState<View>({ name: 'overview' });
  const [tab, setTab] = useState<OverviewTab>('projects');
  const [projects, setProjects] = useState<FinishProject[] | null>(null);
  const [voices, setVoices] = useState<AuthorVoice[]>([]);
  const [loadError, setLoadError] = useState('');

  const loadProjects = useCallback(async () => {
    try {
      setProjects(await listFinishProjects());
      setLoadError('');
    } catch (err) {
      console.error('Kunde inte ladda projekt:', err);
      setProjects([]);
      setLoadError('Dina projekt kunde inte laddas från webbläsaren. Ladda om sidan och försök igen.');
    }
  }, []);

  const loadVoices = useCallback(async () => {
    try {
      setVoices(await listAuthorVoices());
    } catch (err) {
      console.error('Kunde inte ladda författarspråk:', err);
    }
  }, []);

  useEffect(() => {
    loadProjects();
    loadVoices();
  }, [loadProjects, loadVoices]);

  const go = (next: View) => {
    setView(next);
    window.scrollTo({ top: 0 });
  };

  if (view.name === 'new') {
    return (
      <NewFinishProject
        voices={voices}
        onCancel={() => go({ name: 'overview' })}
        onCreated={project => {
          loadProjects();
          setView(v => (v.name === 'workspace' ? v : { name: 'workspace', project }));
          window.scrollTo({ top: 0 });
        }}
        onVoicesChanged={loadVoices}
      />
    );
  }

  if (view.name === 'workspace') {
    return (
      <FinishWorkspace
        key={view.project.id}
        initial={view.project}
        voices={voices}
        onVoicesChanged={loadVoices}
        onBack={() => {
          loadProjects();
          setTab('projects');
          go({ name: 'overview' });
        }}
        onCreateBook={onCreateBook}
      />
    );
  }

  return (
    <FinishOverview
      projects={projects}
      voices={voices}
      loadError={loadError}
      tab={tab}
      onTab={setTab}
      onBack={onBack}
      onNew={() => go({ name: 'new' })}
      onOpen={project => go({ name: 'workspace', project })}
      onProjectsChanged={loadProjects}
      onVoicesChanged={loadVoices}
    />
  );
}
