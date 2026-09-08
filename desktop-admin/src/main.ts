import { invoke } from '@tauri-apps/api/core'
import './style.css'

type ServiceControl = 'docker' | 'local'

type ServiceStatus = {
  id: string
  name: string
  endpoint: string
  available: boolean
  statusCode: number | null
  detail: string
  managedByPanel: boolean
  control: ServiceControl
  setupRequired: boolean
}

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Cekarna · poste local</p>
        <h1>Administration</h1>
        <p class="subtitle">Supervision et contrôle des services utilisés par l’application candidat.</p>
      </div>
      <button id="refresh" class="button" type="button">Actualiser</button>
    </header>
    <section class="notice" aria-label="Périmètre du panneau">
      <strong>Services locaux uniquement.</strong> Les boutons Docker démarrent ou arrêtent uniquement le service Cekarna indiqué, sans supprimer les volumes. Les processus API et Ollama ne peuvent être arrêtés ici que s’ils ont été démarrés par ce panneau.
    </section>
    <section aria-labelledby="services-title">
      <div class="section-heading">
        <div><p class="eyebrow">Disponibilité</p><h2 id="services-title">Services locaux</h2></div>
        <p id="last-check" class="last-check" aria-live="polite">Contrôle non lancé</p>
      </div>
      <div id="services" class="service-grid" aria-live="polite" aria-busy="true"></div>
    </section>
    <section class="guidance" aria-labelledby="guidance-title">
      <h2 id="guidance-title">Utilisation</h2>
      <p>Le démarrage de l’identité ou des notifications exige Docker Desktop. Les offres locales utilisent Rust et des annonces entièrement synthétiques ; France Travail reste désactivé. Le panneau ne lit pas les CV, profils, jetons, secrets ou contenus de notifications. Consultez les journaux du service quand un démarrage échoue.</p>
    </section>
  </main>
`

const services = document.querySelector<HTMLDivElement>('#services')!
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!
const lastCheck = document.querySelector<HTMLParagraphElement>('#last-check')!

function controlMarkup(service: ServiceStatus) {
  if (service.setupRequired) {
    return `<button class="service-action" data-service="${service.id}" data-action="initialize" type="button">Préparer le développement</button>`
  }
  if (service.control === 'local' && service.available && !service.managedByPanel) {
    return '<p class="control-note">Démarré hors panneau</p>'
  }
  const action = service.available ? 'stop' : 'start'
  const label = action === 'start' ? 'Démarrer' : 'Arrêter'
  return `<button class="service-action ${action === 'stop' ? 'service-action--stop' : ''}" data-service="${service.id}" data-action="${action}" type="button">${label}</button>`
}

function renderStatuses(statuses: ServiceStatus[]) {
  services.innerHTML = statuses.map((service) => `
    <article class="service-card">
      <div class="service-card__heading">
        <h3>${service.name}</h3>
        <span class="status ${service.available ? 'status--ok' : 'status--error'}">${service.available ? 'Disponible' : 'Indisponible'}</span>
      </div>
      <p class="service-detail">${service.detail}</p>
      <code>${service.endpoint}</code>
      <div class="service-card__footer">${controlMarkup(service)}</div>
    </article>
  `).join('')
}

async function refreshStatuses() {
  refresh.disabled = true
  refresh.textContent = 'Contrôle…'
  services.setAttribute('aria-busy', 'true')
  try {
    const statuses = await invoke<ServiceStatus[]>('check_services')
    renderStatuses(statuses)
    lastCheck.textContent = `Dernier contrôle : ${new Intl.DateTimeFormat('fr-FR', { timeStyle: 'medium' }).format(new Date())}`
  } catch {
    services.innerHTML = '<p class="error">Le contrôle local a échoué. Fermez puis relancez l’application.</p>'
    lastCheck.textContent = 'Contrôle impossible'
  } finally {
    services.setAttribute('aria-busy', 'false')
    refresh.disabled = false
    refresh.textContent = 'Actualiser'
  }
}

services.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-service]')
  if (!button) return

  const { service, action } = button.dataset
  if (!service || (action !== 'start' && action !== 'stop' && action !== 'initialize')) return
  if (action === 'stop' && !window.confirm(`Arrêter ${service} ?`)) return

  button.disabled = true
  button.textContent = action === 'start' ? 'Démarrage…' : action === 'stop' ? 'Arrêt…' : 'Préparation…'
  try {
    await invoke('control_service', { service, action })
    if (service === 'offers' && action === 'initialize') {
      window.alert('Configuration des offres prête. Redémarrez l’API candidat si elle était déjà active afin qu’elle relise le jeton interne.')
    }
    await new Promise((resolve) => window.setTimeout(resolve, action === 'start' ? 1200 : 350))
    await refreshStatuses()
  } catch (error) {
    services.insertAdjacentHTML('afterbegin', `<p class="error">${typeof error === 'string' ? error : 'Action impossible. Consultez les journaux du service.'}</p>`)
    button.disabled = false
    button.textContent = action === 'start' ? 'Démarrer' : action === 'stop' ? 'Arrêter' : 'Préparer le développement'
  }
})

refresh.addEventListener('click', refreshStatuses)
void refreshStatuses()
