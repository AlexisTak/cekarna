import { invoke } from '@tauri-apps/api/core'
import './style.css'

type ServiceStatus = {
  name: string
  endpoint: string
  available: boolean
  statusCode: number | null
  detail: string
}

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Cekarna · poste local</p>
        <h1>Administration</h1>
        <p class="subtitle">Supervision technique des services utilisés par l’application candidat.</p>
      </div>
      <button id="refresh" class="button" type="button">Actualiser</button>
    </header>
    <section class="notice" aria-label="Périmètre du panneau">
      <strong>Lecture seule.</strong> Cette application ne contient ni profils, ni CV, ni accès à l’espace candidat. Les contrôles sont effectués depuis ce poste vers les services locaux.
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
      <p>Un état « indisponible » signale seulement que le service ne répond pas sur ce poste. Vérifiez son journal et sa configuration avant toute action. Ce panneau n’exécute aucune modification, n’affiche aucun secret et ne remplace pas les procédures d’exploitation.</p>
    </section>
  </main>
`

const services = document.querySelector<HTMLDivElement>('#services')!
const refresh = document.querySelector<HTMLButtonElement>('#refresh')!
const lastCheck = document.querySelector<HTMLParagraphElement>('#last-check')!

function renderStatuses(statuses: ServiceStatus[]) {
  services.innerHTML = statuses.map((service) => `
    <article class="service-card">
      <div class="service-card__heading">
        <h3>${service.name}</h3>
        <span class="status ${service.available ? 'status--ok' : 'status--error'}">${service.available ? 'Disponible' : 'Indisponible'}</span>
      </div>
      <p class="service-detail">${service.detail}</p>
      <code>${service.endpoint}</code>
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

refresh.addEventListener('click', refreshStatuses)
void refreshStatuses()
