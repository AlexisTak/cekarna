import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Compass,
  FileText,
  LayoutDashboard,
  MailWarning,
  MapPin,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import {
  AuthError,
  bootstrapAuth,
  describeAuthError,
  fetchAccount,
  fetchCandidateWorkspace,
  logout,
  requestVerificationEmail,
  saveCandidateWorkspace,
  type Account,
} from './auth-api';
import {
  CONTRACTS,
  LABELS,
  STATUSES,
  STORAGE_KEY,
  demoWorkspace,
  emptyWorkspace,
  exportWorkspace,
  matches,
  normalize,
  parseWorkspace,
  profileProgress,
  safeUrl,
  type Job,
  type Profile,
  type Status,
  type Workspace,
} from './domain';

type View = 'dashboard' | 'jobs' | 'applications' | 'profile';
const nav = [
  { id: 'dashboard', label: 'Tableau de bord', icon: LayoutDashboard },
  { id: 'jobs', label: 'Mes offres', icon: Search },
  { id: 'applications', label: 'Mes candidatures', icon: Send },
  { id: 'profile', label: 'Mon profil', icon: UserRound },
] as const;
function getView(): View {
  const hash = window.location.hash.slice(1);
  return nav.find((n) => n.id === hash)?.id ?? 'dashboard';
}
function load(): { workspace: Workspace; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { workspace: demoWorkspace(), error: '' };
    const parsed = parseWorkspace(raw);
    return parsed
      ? { workspace: parsed, error: '' }
      : {
          workspace: demoWorkspace(),
          error:
            'La sauvegarde locale est illisible. Elle ne sera remplacée que lors d’une nouvelle modification.',
        };
  } catch {
    return {
      workspace: demoWorkspace(),
      error:
        'Le stockage de ce navigateur est indisponible. Exportez votre travail avant de fermer la page.',
    };
  }
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <header className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Fermer">
          <X size={20} />
        </button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

function JobForm({
  job,
  onSave,
  onCancel,
}: {
  job?: Job;
  onSave: (job: Job) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState('');
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const value = (key: string) => String(form.get(key) ?? '').trim();
    const url = safeUrl(value('url'));
    if (url === null) {
      setError(
        'Ajoutez une adresse complète commençant par https:// ou http://.',
      );
      return;
    }
    if (!value('title') || !value('company')) {
      setError('Le poste et l’entreprise sont nécessaires.');
      return;
    }
    onSave({
      id: job?.id ?? crypto.randomUUID(),
      title: value('title'),
      company: value('company'),
      location: value('location'),
      salary: value('salary'),
      contract: value('contract') as Job['contract'],
      remote: form.get('remote') === 'on',
      url,
      description: value('description'),
      status: job?.status ?? 'saved',
      notes: job?.notes ?? '',
      updatedAt: new Date().toISOString(),
    });
  }
  return (
    <form onSubmit={submit} className="form-stack">
      <p className="muted">
        Gardez une offre trouvée sur un site d’emploi, dans un email ou auprès
        de votre réseau.
      </p>
      <label>
        Intitulé du poste <span className="required">*</span>
        <input
          name="title"
          maxLength={160}
          required
          defaultValue={job?.title}
          placeholder="Ex. Développeur front-end"
        />
      </label>
      <div className="form-row">
        <label>
          Entreprise <span className="required">*</span>
          <input
            name="company"
            maxLength={100}
            required
            defaultValue={job?.company}
            placeholder="Nom de l’entreprise"
          />
        </label>
        <label>
          Localisation
          <input
            name="location"
            maxLength={100}
            defaultValue={job?.location}
            placeholder="Ex. Paris"
          />
        </label>
      </div>
      <div className="form-row">
        <label>
          Contrat
          <select name="contract" defaultValue={job?.contract ?? 'CDI'}>
            {CONTRACTS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Rémunération indiquée
          <input
            name="salary"
            maxLength={100}
            defaultValue={job?.salary}
            placeholder="Ex. 35–42 k€ brut/an"
          />
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" name="remote" defaultChecked={job?.remote} />
        Télétravail mentionné dans l’offre
      </label>
      <label>
        Lien de l’offre
        <input
          name="url"
          maxLength={2000}
          defaultValue={job?.url}
          placeholder="https://…"
          inputMode="url"
        />
      </label>
      <label>
        Description ou points à retenir
        <textarea
          name="description"
          maxLength={12000}
          rows={4}
          defaultValue={job?.description}
          placeholder="Missions, compétences recherchées, détails utiles…"
        />
      </label>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button className="button secondary" type="button" onClick={onCancel}>
          Annuler
        </button>
        <button className="button primary" type="submit">
          {job ? 'Enregistrer les modifications' : 'Enregistrer l’offre'}
          <Check size={16} />
        </button>
      </div>
    </form>
  );
}

function JobCard({
  job,
  profile,
  open,
  compact = false,
}: {
  job: Job;
  profile: Profile;
  open: () => void;
  compact?: boolean;
}) {
  const criteria = matches(job, profile);
  return (
    <article className={`job-card ${compact ? 'compact' : ''}`}>
      <div
        className={`company-mark mark-${job.company.length % 4}`}
        aria-hidden="true"
      >
        {job.company.substring(0, 1)}
      </div>
      <div className="job-main">
        <p className="company-name">{job.company}</p>
        <button className="job-title" onClick={open}>
          {job.title}
        </button>
        <div className="job-meta">
          <span>
            <MapPin size={13} />
            {job.location || 'Lieu non renseigné'}
          </span>
          <span>{job.contract}</span>
          {job.remote && <span>Télétravail</span>}
        </div>
      </div>
      {!compact && (
        <div className="job-bottom">
          <span className={`status ${job.status}`}>{LABELS[job.status]}</span>
          {job.salary && <span className="salary">{job.salary}</span>}
        </div>
      )}
      {!compact && (
        <div className="job-match">
          <span>
            <CheckCheck size={14} />
            {criteria.length
              ? `${criteria.length} repère${criteria.length > 1 ? 's' : ''} en commun`
              : 'À comparer avec votre profil'}
          </span>
          <button
            className="icon-button small"
            aria-label={`Consulter ${job.title} chez ${job.company}`}
            onClick={open}
          >
            <ArrowUpRight size={18} />
          </button>
        </div>
      )}
      {compact && (
        <button
          className="icon-button"
          aria-label={`Consulter ${job.title} chez ${job.company}`}
          onClick={open}
        >
          <ChevronRight size={18} />
        </button>
      )}
    </article>
  );
}

export default function App() {
  const [initial] = useState(load);
  const [workspace, setWorkspace] = useState(initial.workspace);
  const [storageError, setStorageError] = useState(initial.error);
  const [view, setView] = useState<View>(getView);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [dialog, setDialog] = useState<'add' | 'help' | 'edit' | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<'local' | 'saved' | 'saving' | 'error' | 'conflict'>('local');
  const importRef = useRef<HTMLInputElement>(null);
  const saveQueue = useRef(Promise.resolve());
  const remoteRevision = useRef(0);
  const { profile, jobs, demo } = workspace;
  const selected = jobs.find((j) => j.id === selectedId);
  const counts = Object.fromEntries(
    STATUSES.map((s) => [s, jobs.filter((j) => j.status === s).length]),
  ) as Record<Status, number>;
  const progress = profileProgress(profile);
  const filtered = jobs.filter(
    (job) =>
      (filter === 'all' || job.status === filter) &&
      normalize(`${job.title} ${job.company} ${job.location}`).includes(
        normalize(query),
      ),
  );
  useEffect(() => {
    let cancelled = false;
    bootstrapAuth()
      .then(() => fetchAccount())
      .then(async (me) => {
        if (cancelled) return;
        setAccount(me);
        const remote = await fetchCandidateWorkspace();
        if (cancelled) return;
        if (remote !== null) {
          const parsed = parseWorkspace(JSON.stringify(remote.workspace));
          if (!parsed) throw new Error('invalid remote workspace');
          remoteRevision.current = remote.revision;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
          setWorkspace(parsed);
          setStorageError('');
          setRemoteStatus('saved');
          return;
        }
        if (!initial.workspace.demo && window.confirm('Enregistrer sur votre compte l’espace déjà présent sur cet appareil ?')) {
          remoteRevision.current = await saveCandidateWorkspace(initial.workspace, 0);
          if (!cancelled) setRemoteStatus('saved');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof AuthError && error.status === 401) {
          setRemoteStatus('local');
          return;
        }
        setRemoteStatus('error');
        setStorageError('Impossible de joindre votre compte. Votre copie locale reste disponible : exportez-la avant de fermer la page.');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const listener = () => setView(getView());
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    document.title = `${nav.find((n) => n.id === view)?.label} — Cekarna`;
  }, [view]);
  function commit(next: Workspace, message: string) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setStorageError('');
    } catch {
      setStorageError(
        'Sauvegarde locale impossible. Votre travail reste ouvert ici : exportez-le pour le conserver.',
      );
    }
    setWorkspace(next);
    setToast(message);
    if (account) {
      setRemoteStatus('saving');
      saveQueue.current = saveQueue.current
        .catch(() => undefined)
        .then(() => saveCandidateWorkspace(next, remoteRevision.current))
        .then((revision) => {
          remoteRevision.current = revision;
        })
        .then(() => setRemoteStatus('saved'))
        .catch((error: unknown) => {
          if (error instanceof AuthError && error.code === 'workspace_conflict') {
            setRemoteStatus('conflict');
            setStorageError('Une version plus récente existe sur un autre appareil. Choisissez quelle copie conserver.');
            return;
          }
          setRemoteStatus('error');
          setStorageError('La sauvegarde sur votre compte a échoué. Une copie reste conservée sur cet appareil.');
        });
    }
  }
  async function reloadServerWorkspace() {
    try {
      const remote = await fetchCandidateWorkspace();
      if (!remote) return;
      const parsed = parseWorkspace(JSON.stringify(remote.workspace));
      if (!parsed) throw new Error('invalid remote workspace');
      if (!window.confirm('Remplacer la copie ouverte par la version enregistrée sur votre compte ?')) return;
      remoteRevision.current = remote.revision;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
      setWorkspace(parsed);
      setStorageError('');
      setRemoteStatus('saved');
      setToast('La version enregistrée sur votre compte est ouverte.');
    } catch (error) {
      setToast(describeAuthError(error));
    }
  }
  async function overwriteServerWorkspace() {
    if (!window.confirm('Remplacer la version enregistrée sur votre compte par cette copie ? Les modifications de l’autre appareil seront perdues.')) return;
    try {
      remoteRevision.current = await saveCandidateWorkspace(workspace, remoteRevision.current, true);
      setStorageError('');
      setRemoteStatus('saved');
      setToast('Votre copie a remplacé la version enregistrée.');
    } catch (error) {
      setToast(describeAuthError(error));
    }
  }
  async function signOut() {
    await logout();
    window.location.assign('/connexion');
  }
  function saveJob(job: Job) {
    if (!jobs.some((j) => j.id === job.id) && jobs.length >= 1000) {
      setToast(
        'La limite de cet espace est de 1 000 offres. Retirez une offre avant d’en ajouter une.',
      );
      return;
    }
    commit(
      {
        ...workspace,
        jobs: jobs.some((j) => j.id === job.id)
          ? jobs.map((j) => (j.id === job.id ? job : j))
          : [job, ...jobs],
      },
      'Offre enregistrée.',
    );
    setDialog(null);
    setSelectedId(null);
  }
  function changeStatus(job: Job, status: Status) {
    commit(
      {
        ...workspace,
        jobs: jobs.map((j) =>
          j.id === job.id
            ? { ...j, status, updatedAt: new Date().toISOString() }
            : j,
        ),
      },
      'Suivi mis à jour.',
    );
  }
  function clearWorkspace() {
    if (
      !window.confirm(
        demo
          ? 'Créer un espace vide à la place de cet exemple ?'
          : 'Effacer le profil et toutes les offres de cet appareil ? Cette action est définitive.',
      )
    )
      return;
    commit(
      emptyWorkspace(),
      demo
        ? 'Votre espace est prêt. Commençons par votre profil.'
        : 'Les données de cet espace ont été effacées.',
    );
    setSelectedId(null);
    window.location.hash = 'profile';
  }
  async function restore(file: File | undefined) {
    if (!file) return;
    if (file.size > 5_000_000) {
      setToast('La sauvegarde dépasse la limite de 5 Mo.');
      return;
    }
    try {
      const state = parseWorkspace(await file.text());
      if (!state) {
        setToast('Ce fichier n’est pas une sauvegarde Cekarna valide.');
        return;
      }
      if (window.confirm('Remplacer l’espace actuel par cette sauvegarde ?'))
        commit(state, 'Sauvegarde restaurée.');
    } catch {
      setToast('Ce fichier ne peut pas être lu.');
    }
  }
  function resendVerification() {
    requestVerificationEmail()
      .then(() => setToast('Si nécessaire, un email de confirmation a été envoyé.'))
      .catch((err: unknown) => setToast(describeAuthError(err)));
  }
  const openJob = (job: Job) => {
    setDialog(null);
    setSelectedId(job.id);
  };
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Aller au contenu
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Retour à l’accueil Cekarna">
          <span className="brand-icon">
            <Compass size={23} strokeWidth={2.2} />
          </span>
          cekarna<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">MON ESPACE CANDIDAT</div>
        <nav aria-label="Navigation principale">
          {nav.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              aria-current={view === item.id ? 'page' : undefined}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
            >
              <item.icon size={19} />
              <span>{item.label}</span>
              {item.id === 'applications' &&
                counts.applied + counts.interview > 0 && (
                  <span className="nav-count">
                    {counts.applied + counts.interview}
                  </span>
                )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="small-tip">
            <span className="tip-icon">
              <Sparkles size={19} />
            </span>
            <strong>Un pas à la fois.</strong>
            <p>
              Votre prochain chapitre commence avec une première candidature.
            </p>
            <a href="#jobs">
              Voir mes offres <ArrowRight size={14} />
            </a>
          </div>
          <button className="help-button" onClick={() => setDialog('help')}>
            <CircleHelp size={18} />À propos de cet espace
          </button>
          {account && (
            <div className="account-actions">
              <a href="/compte">Gérer mon compte</a>
              <button onClick={signOut}>Se déconnecter</button>
            </div>
          )}
          <div className="sidebar-profile">
            <span className="avatar">
              {profile.firstName.trim().charAt(0).toUpperCase() || 'M'}
            </span>
            <div>
              <strong>{profile.firstName || 'Mon espace'}</strong>
              <span>
                {demo ? 'Profil de démonstration' : 'Espace personnel'}
              </span>
            </div>
            <a href="#profile" aria-label="Modifier mon profil">
              <SlidersHorizontal size={17} />
            </a>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Mon espace <ChevronRight size={13} />
            <span>{nav.find((n) => n.id === view)?.label}</span>
          </div>
          <div className="topbar-right">
            <span
              className={`local-indicator ${storageError ? 'warning' : ''}`}
            >
              <span />
              {storageError
                ? 'Sauvegarde à vérifier'
                : remoteStatus === 'saved'
                  ? 'Enregistré sur votre compte'
                  : remoteStatus === 'saving'
                    ? 'Enregistrement…'
                    : account
                      ? 'Copie locale'
                      : 'Sur cet appareil'}
            </span>
            <button
              className="avatar top-avatar"
              onClick={() => {
                window.location.hash = 'profile';
              }}
              aria-label="Ouvrir mon profil"
            >
              {profile.firstName.trim().charAt(0).toUpperCase() || 'M'}
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {storageError && (
            <div role="alert" className="warning-banner">
              {storageError}
              {remoteStatus === 'conflict' ? (
                <>
                  <button onClick={reloadServerWorkspace}>Voir la copie du compte</button>
                  <button onClick={overwriteServerWorkspace}>Conserver cette copie</button>
                </>
              ) : (
                <button onClick={() => exportWorkspace(workspace)}>Exporter mon espace</button>
              )}
            </div>
          )}
          {account && !account.email_verified && (
            <div role="status" className="warning-banner">
              <MailWarning size={17} />
              Confirmez votre adresse email ({account.email}) pour sécuriser
              votre compte.
              <button onClick={resendVerification}>Renvoyer l’email</button>
            </div>
          )}
          {demo && (
            <div className="demo-banner">
              <span>
                <span className="demo-dot" />
                Mode découverte{' '}
                <span className="demo-description">
                  — profil et offres fictifs pour explorer l’application.
                </span>
              </span>
              <button onClick={clearWorkspace}>
                Créer mon espace <ArrowRight size={14} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">VOTRE RECHERCHE, À VOTRE RYTHME</p>
              <h1>
                {view === 'dashboard'
                  ? `Bonjour${profile.firstName ? ` ${profile.firstName}` : ''} ${'☀'}`
                  : view === 'jobs'
                    ? 'Mes offres'
                    : view === 'applications'
                      ? 'Mes candidatures'
                      : 'Mon profil'}
              </h1>
              <p>
                {view === 'dashboard'
                  ? 'Un espace pour avancer vers un emploi qui vous ressemble.'
                  : view === 'jobs'
                    ? 'Toutes les opportunités que vous souhaitez garder à portée de main.'
                    : view === 'applications'
                      ? 'Gardez le fil, de la première intention au prochain entretien.'
                      : 'Vos envies et vos compétences, pour mieux orienter votre recherche.'}
              </p>
            </div>
            {view !== 'profile' && (
              <button
                className="button primary"
                onClick={() => {
                  setSelectedId(null);
                  setDialog('add');
                }}
              >
                <Plus size={18} />
                Ajouter une offre
              </button>
            )}
          </div>

          {view === 'dashboard' && (
            <>
              <div className="dashboard-grid">
                <section className="welcome-card">
                  <div className="welcome-copy">
                    <span className="pill">
                      <Compass size={14} />
                      Votre prochain chapitre
                    </span>
                    <h2>
                      Une recherche plus claire.
                      <br />
                      Un avenir plus proche.
                    </h2>
                    <p>
                      Rassemblez vos offres, préparez vos candidatures
                      <br className="desktop-only" /> et avancez une étape après
                      l’autre.
                    </p>
                    <a
                      className="button dark"
                      href={progress < 100 ? '#profile' : '#jobs'}
                    >
                      {progress < 100
                        ? 'Compléter mon profil'
                        : 'Explorer mes offres'}
                      <ArrowRight size={16} />
                    </a>
                  </div>
                  <div className="journey-art" aria-hidden="true">
                    <div className="orbit orbit-one" />
                    <div className="orbit orbit-two" />
                    <div className="art-card art-top">
                      <div className="art-check">
                        <Check size={18} />
                      </div>
                      <span>Un projet qui me ressemble</span>
                    </div>
                    <div className="art-center">
                      <Compass size={48} strokeWidth={1.3} />
                    </div>
                    <div className="art-card art-bottom">
                      <span className="art-star">✦</span>La suite commence ici
                    </div>
                    <span className="art-dot dot-one" />
                    <span className="art-dot dot-two" />
                  </div>
                </section>
                <section className="profile-card">
                  <div className="section-mini">
                    <span>Mon profil</span>
                    <UserRound size={18} />
                  </div>
                  <div
                    className="progress-ring"
                    style={{
                      background: `conic-gradient(var(--accent) ${progress}%, #f0eeeb 0)`,
                    }}
                  >
                    <div>
                      <strong>
                        {progress}
                        <small>%</small>
                      </strong>
                      <span>complété</span>
                    </div>
                  </div>
                  <p>
                    {progress === 100
                      ? 'Vos repères sont en place.'
                      : 'Quelques détails font la différence.'}
                  </p>
                  <a href="#profile">
                    {progress === 100
                      ? 'Actualiser mon profil'
                      : 'Continuer mon profil'}
                    <ArrowRight size={15} />
                  </a>
                </section>
              </div>
              <div className="stats-row">
                {[
                  {
                    label: 'Offres à préparer',
                    count: counts.saved,
                    icon: BriefcaseBusiness,
                    cls: 'coral',
                    target: 'jobs',
                  },
                  {
                    label: 'Candidatures envoyées',
                    count: counts.applied,
                    icon: Send,
                    cls: 'blue',
                    target: 'applications',
                  },
                  {
                    label: 'Entretiens en cours',
                    count: counts.interview,
                    icon: Target,
                    cls: 'green',
                    target: 'applications',
                  },
                ].map((stat) => (
                  <a
                    className="stat-card"
                    href={`#${stat.target}`}
                    key={stat.label}
                  >
                    <span className={`stat-icon ${stat.cls}`}>
                      <stat.icon size={20} />
                    </span>
                    <div>
                      <strong>{stat.count.toString().padStart(2, '0')}</strong>
                      <span>{stat.label}</span>
                    </div>
                    <ArrowUpRight size={17} />
                  </a>
                ))}
              </div>
              <div className="content-grid">
                <section>
                  <div className="section-heading">
                    <div>
                      <h2>Vos prochaines opportunités</h2>
                      <p>Les offres que vous avez gardées pour la suite.</p>
                    </div>
                    <a className="text-link" href="#jobs">
                      Tout voir
                      <ArrowRight size={15} />
                    </a>
                  </div>
                  {counts.saved ? (
                    <div className="jobs-grid">
                      {jobs
                        .filter((j) => j.status === 'saved')
                        .slice(0, 2)
                        .map((j) => (
                          <JobCard
                            key={j.id}
                            job={j}
                            profile={profile}
                            open={() => openJob(j)}
                          />
                        ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <BriefcaseBusiness size={28} />
                      <h3>Une opportunité en tête ?</h3>
                      <p>
                        Enregistrez votre première offre pour la retrouver ici.
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => setDialog('add')}
                      >
                        <Plus size={16} />
                        Ajouter une offre
                      </button>
                    </div>
                  )}
                </section>
                <section className="next-steps">
                  <div className="section-heading">
                    <h2>Un peu d’élan</h2>
                    <Sparkles size={18} />
                  </div>
                  <a href="#profile">
                    <span
                      className={`step-number ${progress === 100 ? 'done' : ''}`}
                    >
                      {progress === 100 ? <Check size={14} /> : '01'}
                    </span>
                    <div>
                      <strong>Affiner votre profil</strong>
                      <p>Faites le point sur ce que vous cherchez.</p>
                    </div>
                    <ChevronRight size={16} />
                  </a>
                  <a href="#jobs">
                    <span className="step-number">02</span>
                    <div>
                      <strong>Choisir une prochaine offre</strong>
                      <p>Une candidature à la fois, c’est déjà avancer.</p>
                    </div>
                    <ChevronRight size={16} />
                  </a>
                  <a href="#applications">
                    <span className="step-number">03</span>
                    <div>
                      <strong>Faire le point sur vos démarches</strong>
                      <p>Actualisez un statut ou ajoutez une note.</p>
                    </div>
                    <ChevronRight size={16} />
                  </a>
                </section>
              </div>
            </>
          )}

          {view === 'jobs' && (
            <section>
              <div className="list-toolbar">
                <div className="search-field">
                  <Search size={18} />
                  <input
                    aria-label="Rechercher dans mes offres"
                    placeholder="Rechercher un poste, une entreprise, une ville…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {query && (
                    <button
                      className="icon-button small"
                      aria-label="Effacer la recherche"
                      onClick={() => setQuery('')}
                    >
                      <X size={15} />
                    </button>
                  )}
                </div>
                <span className="result-count">
                  {filtered.length} offre{filtered.length > 1 ? 's' : ''}
                </span>
              </div>
              <div
                className="filter-row"
                aria-label="Filtrer les offres par statut"
              >
                {(['all', ...STATUSES] as const).map((s) => (
                  <button
                    aria-pressed={filter === s}
                    className={filter === s ? 'selected' : ''}
                    key={s}
                    onClick={() => setFilter(s)}
                  >
                    {s === 'all' ? 'Toutes les offres' : LABELS[s]}
                    <span>{s === 'all' ? jobs.length : counts[s]}</span>
                  </button>
                ))}
              </div>
              {filtered.length ? (
                <div className="jobs-grid all-jobs">
                  {filtered.map((j) => (
                    <JobCard
                      key={j.id}
                      job={j}
                      profile={profile}
                      open={() => openJob(j)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <Search size={30} />
                  <h2>
                    {jobs.length
                      ? 'Aucune offre ne correspond'
                      : 'Votre recherche prend forme ici'}
                  </h2>
                  <p>
                    {jobs.length
                      ? 'Essayez un autre mot-clé ou affichez tous les statuts.'
                      : 'Ajoutez un poste qui vous intéresse pour commencer votre suivi.'}
                  </p>
                  {jobs.length ? (
                    <button
                      className="button secondary"
                      onClick={() => {
                        setQuery('');
                        setFilter('all');
                      }}
                    >
                      Réinitialiser les filtres
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => setDialog('add')}
                    >
                      Ajouter ma première offre
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {view === 'applications' && (
            <>
              <div className="tracker-note">
                <CheckCheck size={17} />
                Les statuts sont mis à jour par vous. Aucun envoi de candidature
                n’est effectué par l’application.
              </div>
              <div className="kanban">
                {STATUSES.map((status) => (
                  <section className="kanban-column" key={status}>
                    <div className="column-heading">
                      <span className={`status-dot ${status}`} />
                      <h2>{LABELS[status]}</h2>
                      <span>{counts[status]}</span>
                    </div>
                    {jobs
                      .filter((j) => j.status === status)
                      .map((job) => (
                        <article className="tracking-card" key={job.id}>
                          <span
                            className={`company-mark small-mark mark-${job.company.length % 4}`}
                          >
                            {job.company.charAt(0)}
                          </span>
                          <p className="company-name">{job.company}</p>
                          <button
                            className="job-title"
                            onClick={() => openJob(job)}
                          >
                            {job.title}
                          </button>
                          <p className="tracking-location">
                            <MapPin size={12} />
                            {job.location || 'Lieu non renseigné'}
                          </p>
                          {job.notes && (
                            <p className="note-preview">
                              <FileText size={13} />
                              {job.notes}
                            </p>
                          )}
                          <label
                            className="status-label"
                            htmlFor={`status-${job.id}`}
                          >
                            Avancement
                            <select
                              id={`status-${job.id}`}
                              value={job.status}
                              onChange={(e) =>
                                changeStatus(job, e.target.value as Status)
                              }
                            >
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </article>
                      ))}
                    {!counts[status] && (
                      <p className="column-empty">
                        Aucune candidature
                        <br />à cette étape.
                      </p>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}

          {view === 'profile' && (
            <div className="profile-layout">
              <section className="panel">
                <div className="section-heading">
                  <div>
                    <h2>Ce qui vous ressemble</h2>
                    <p>
                      Vous pouvez faire évoluer ces informations à tout moment.
                    </p>
                  </div>
                </div>
                <form
                  key={JSON.stringify(profile)}
                  className="form-stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    const updated = { ...profile };
                    for (const key of Object.keys(updated) as (keyof Profile)[])
                      updated[key] = String(form.get(key) ?? '').trim();
                    commit(
                      { ...workspace, profile: updated },
                      'Profil enregistré.',
                    );
                  }}
                >
                  <div className="form-row">
                    <label>
                      Prénom
                      <input
                        name="firstName"
                        autoComplete="given-name"
                        defaultValue={profile.firstName}
                        maxLength={60}
                        placeholder="Votre prénom"
                      />
                    </label>
                    <label>
                      Poste recherché
                      <input
                        name="title"
                        defaultValue={profile.title}
                        maxLength={160}
                        placeholder="Ex. Chef de projet"
                      />
                    </label>
                  </div>
                  <div className="form-row">
                    <label>
                      Ville souhaitée
                      <input
                        name="city"
                        autoComplete="address-level2"
                        defaultValue={profile.city}
                        maxLength={100}
                        placeholder="Ex. Lyon"
                      />
                    </label>
                    <label>
                      Contrat souhaité
                      <select name="contract" defaultValue={profile.contract}>
                        <option value="">Tous les contrats</option>
                        {CONTRACTS.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    Vos compétences
                    <input
                      name="skills"
                      defaultValue={profile.skills}
                      maxLength={1000}
                      placeholder="Ex. Gestion de projet, Excel, anglais"
                    />
                    <span className="field-hint">
                      Séparez les compétences par des virgules.
                    </span>
                  </label>
                  <label>
                    Votre parcours en quelques mots
                    <textarea
                      name="about"
                      defaultValue={profile.about}
                      rows={5}
                      maxLength={5000}
                      placeholder="Vos expériences, vos points forts et ce que vous avez envie de faire ensuite…"
                    />
                  </label>
                  <div className="form-actions">
                    <button className="button primary" type="submit">
                      Enregistrer mon profil
                      <Check size={16} />
                    </button>
                  </div>
                </form>
              </section>
              <aside className="profile-aside">
                <section className="panel">
                  <span className="stat-icon coral">
                    <Compass size={21} />
                  </span>
                  <h2>Votre cap, vos choix.</h2>
                  <p>
                    Votre ville, votre contrat et vos compétences servent de
                    repères pour comparer les offres que vous enregistrez.
                  </p>
                  <p className="muted">
                    Ces repères sont de simples comparaisons de texte, pas une
                    évaluation par IA.
                  </p>
                </section>
                <section className="panel data-panel">
                  <h2>Mes données</h2>
                  <p>
                    Votre espace est conservé dans ce navigateur. Il n’est pas
                    synchronisé avec un compte.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => {
                      exportWorkspace(workspace);
                      setToast('Export de votre espace demandé.');
                    }}
                  >
                    <ArrowDownToLine size={16} />
                    Exporter mon espace
                  </button>
                  <button
                    className="text-link"
                    onClick={() => importRef.current?.click()}
                  >
                    Restaurer une sauvegarde
                  </button>
                  <input
                    hidden
                    type="file"
                    accept=".json,application/json"
                    ref={importRef}
                    onChange={(e) => {
                      void restore(e.target.files?.[0]);
                      e.currentTarget.value = '';
                    }}
                  />
                  <button className="danger-link" onClick={clearWorkspace}>
                    <Trash2 size={14} />
                    {demo ? 'Créer mon espace vide' : 'Effacer mes données'}
                  </button>
                </section>
              </aside>
            </div>
          )}
          <footer className="page-footer">
            <span>Chaque démarche compte.</span>
            <span>Cekarna · Votre espace de recherche d’emploi</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button small"
            aria-label="Fermer la notification"
            onClick={() => setToast('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {dialog === 'help' && (
        <Modal
          title="Un espace pour votre recherche"
          onClose={() => setDialog(null)}
        >
          <div className="form-stack">
            <p>
              Cette première version vous permet de garder des offres,
              renseigner votre profil et suivre vos démarches.
            </p>
            <p>
              Les données restent dans ce navigateur. Exportez une sauvegarde
              avant de changer d’appareil ou de supprimer les données du
              navigateur.
            </p>
            <p>
              L’import de CV, la recherche automatique et la rédaction par IA ne
              sont pas encore disponibles. Aucune candidature n’est envoyée
              depuis cet espace.
            </p>
            <button className="button primary" onClick={() => setDialog(null)}>
              C’est compris
              <Check size={16} />
            </button>
          </div>
        </Modal>
      )}
      {(dialog === 'add' || dialog === 'edit') && (
        <Modal
          title={dialog === 'edit' ? 'Modifier l’offre' : 'Ajouter une offre'}
          onClose={() => {
            setDialog(null);
            setSelectedId(null);
          }}
        >
          <JobForm
            job={dialog === 'edit' ? selected : undefined}
            onSave={saveJob}
            onCancel={() => {
              setDialog(null);
              setSelectedId(null);
            }}
          />
        </Modal>
      )}
      {selected && !dialog && (
        <Modal title={selected.title} onClose={() => setSelectedId(null)}>
          <div className="offer-detail">
            <div className="offer-company">
              <span
                className={`company-mark mark-${selected.company.length % 4}`}
              >
                {selected.company.charAt(0)}
              </span>
              <div>
                <strong>{selected.company}</strong>
                <p>
                  {selected.location || 'Lieu non renseigné'} ·{' '}
                  {selected.contract}
                  {selected.remote ? ' · Télétravail' : ''}
                </p>
              </div>
            </div>
            {selected.salary && <p className="salary">{selected.salary}</p>}
            <h3>À propos du poste</h3>
            <p className="preserve-lines">
              {selected.description ||
                'Aucune description enregistrée. Vous pouvez compléter cette offre.'}
            </p>
            <div className="criteria-box">
              <h3>
                <CheckCheck size={17} />
                Vos repères en commun
              </h3>
              {matches(selected, profile).length ? (
                <ul>
                  {matches(selected, profile).map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  Aucun repère commun identifié. Consultez la description et
                  complétez votre profil.
                </p>
              )}
              <small>
                Comparaison de texte uniquement, sans score ni évaluation IA.
              </small>
            </div>
            <label className="detail-status">
              Avancement de ma candidature
              <select
                value={selected.status}
                onChange={(e) =>
                  changeStatus(selected, e.target.value as Status)
                }
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <form
              key={selected.id}
              className="form-stack"
              onSubmit={(e) => {
                e.preventDefault();
                const notes = String(
                  new FormData(e.currentTarget).get('notes') ?? '',
                ).trim();
                commit(
                  {
                    ...workspace,
                    jobs: jobs.map((j) =>
                      j.id === selected.id
                        ? { ...j, notes, updatedAt: new Date().toISOString() }
                        : j,
                    ),
                  },
                  'Notes enregistrées.',
                );
              }}
            >
              <label>
                Mes notes
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={5000}
                  defaultValue={selected.notes}
                  placeholder="Relance, contact, préparation d’entretien…"
                />
              </label>
              <button className="button secondary" type="submit">
                Enregistrer mes notes
              </button>
            </form>
            <div className="detail-actions">
              {selected.url && (
                <a
                  className="button primary"
                  href={safeUrl(selected.url) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Ouvrir l’offre
                  <ArrowUpRight size={16} />
                </a>
              )}
              <button
                className="button secondary"
                onClick={() => setDialog('edit')}
              >
                Modifier
              </button>
              <button
                className="icon-button danger"
                aria-label="Supprimer cette offre"
                onClick={() => {
                  if (window.confirm('Supprimer cette offre et ses notes ?')) {
                    commit(
                      {
                        ...workspace,
                        jobs: jobs.filter((j) => j.id !== selected.id),
                      },
                      'Offre supprimée.',
                    );
                    setSelectedId(null);
                  }
                }}
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
