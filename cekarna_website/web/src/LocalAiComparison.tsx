import { useState } from 'react';
import type { Job, Profile } from './domain';
import { compareWithLocalAi, type AiFinding } from './local-ai-api';
export function LocalAiComparison({
  profile,
  job,
}: {
  profile: Profile;
  job: Job;
}) {
  const [findings, setFindings] = useState<AiFinding[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run() {
    setBusy(true);
    setError('');
    try {
      setFindings((await compareWithLocalAi(profile, job)).findings);
    } catch {
      setError(
        'Hermes local est indisponible. Vérifiez qu’Ollama est démarré.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="criteria-box">
      <h3>Analyse locale avec Hermes</h3>
      <p>Cette analyse reste sur votre machine et doit être relue.</p>
      <button
        className="button secondary"
        type="button"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? 'Analyse en cours…' : 'Comparer avec Hermes'}
      </button>
      {error && <p className="form-error">{error}</p>}
      {findings &&
        (findings.length ? (
          <ul>
            {findings.map((finding, index) => (
              <li key={`${finding.criterion}-${index}`}>
                <strong>{finding.criterion}</strong> —{' '}
                {finding.status === 'satisfied'
                  ? 'satisfait'
                  : finding.status === 'missing'
                    ? 'non satisfait'
                    : 'inconnu'}
                {finding.evidence.length
                  ? ` · ${finding.evidence.join(' · ')}`
                  : ''}
              </li>
            ))}
          </ul>
        ) : (
          <p>Aucun constat suffisamment sourcé.</p>
        ))}
      <small>
        Aucun score d’embauche. Les constats sans preuve littérale sont écartés.
      </small>
    </div>
  );
}
