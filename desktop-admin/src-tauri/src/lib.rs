use rand::{distr::Alphanumeric, Rng};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

struct ManagedProcesses(Mutex<HashMap<&'static str, Child>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    id: &'static str,
    name: &'static str,
    endpoint: &'static str,
    available: bool,
    status_code: Option<u16>,
    detail: String,
    managed_by_panel: bool,
    control: &'static str,
    setup_required: bool,
}

fn candidate_readiness_detail(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    let dependencies = value.get("dependencies")?.as_object()?;
    let unavailable = [
        ("identity", "identité"),
        ("offers", "offres"),
        ("hermes", "Hermes"),
    ]
    .iter()
    .filter_map(|(key, label)| {
        let dependency = dependencies.get(*key)?.as_object()?;
        (dependency.get("status")?.as_str()? != "up").then_some(*label)
    })
    .collect::<Vec<_>>();
    (!unavailable.is_empty())
        .then(|| format!("Dépendances indisponibles : {}", unavailable.join(", ")))
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("desktop-admin must be in the Cekarna workspace")
        .to_path_buf()
}

fn project_path() -> PathBuf {
    workspace_root().join("cekarna_website")
}

fn managed_by_panel(processes: &ManagedProcesses, id: &'static str) -> bool {
    let mut processes = processes.0.lock().expect("managed processes lock poisoned");
    if let Some(child) = processes.get_mut(id) {
        match child.try_wait() {
            Ok(None) => return true,
            Ok(Some(_)) | Err(_) => {
                processes.remove(id);
            }
        }
    }
    false
}

async fn check_service(
    client: &reqwest::Client,
    id: &'static str,
    name: &'static str,
    endpoint: &'static str,
    control: &'static str,
    managed_by_panel: bool,
    setup_required: bool,
) -> ServiceStatus {
    match client.get(endpoint).send().await {
        Ok(response) => {
            let status = response.status();
            let available = status.is_success();
            let degraded_detail = if !available && id == "candidate-api" {
                response
                    .text()
                    .await
                    .ok()
                    .and_then(|body| candidate_readiness_detail(&body))
            } else {
                None
            };
            ServiceStatus {
                id,
                name,
                endpoint,
                available,
                status_code: Some(status.as_u16()),
                detail: if available && managed_by_panel {
                    "Disponible · démarré par ce panneau".to_owned()
                } else if available {
                    "Disponible".to_owned()
                } else if let Some(detail) = degraded_detail {
                    detail
                } else {
                    format!("Réponse HTTP {}", status.as_u16())
                },
                managed_by_panel,
                control,
                setup_required,
            }
        }
        Err(error) => ServiceStatus {
            id,
            name,
            endpoint,
            available: false,
            status_code: None,
            detail: if error.is_timeout() {
                "Délai de réponse dépassé".to_owned()
            } else {
                "Injoignable".to_owned()
            },
            managed_by_panel,
            control,
            setup_required,
        },
    }
}

#[tauri::command]
async fn check_services(
    processes: tauri::State<'_, ManagedProcesses>,
) -> Result<Vec<ServiceStatus>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| "Impossible de préparer le contrôle local.".to_owned())?;
    let api_managed = managed_by_panel(&processes, "candidate-api");
    let offers_managed = managed_by_panel(&processes, "offers");
    let ollama_managed = managed_by_panel(&processes, "ollama");
    let notifications_setup_required =
        !project_path().join("services/notifications/.env").is_file();
    let offers_env = project_path().join("services/offers/.env");
    let api_env = project_path().join(".env");
    let offers_token = env_value(&offers_env, "OFFERS_INTERNAL_TOKEN");
    let api_token = env_value(&api_env, "OFFERS_INTERNAL_TOKEN");
    let offers_token_invalid = match offers_token.as_deref() {
        Some(value) => value.len() < 32,
        None => true,
    };
    let offers_setup_required =
        !offers_env.is_file() || offers_token_invalid || offers_token != api_token;

    Ok(vec![
        check_service(
            &client,
            "candidate-api",
            "API candidat",
            "http://127.0.0.1:3000/health/ready",
            "local",
            api_managed,
            false,
        )
        .await,
        check_service(
            &client,
            "auth",
            "Identité",
            "http://127.0.0.1:8081/health/ready",
            "docker",
            false,
            false,
        )
        .await,
        check_service(
            &client,
            "notifications",
            "Notifications",
            "http://127.0.0.1:8082/health/ready",
            "docker",
            false,
            notifications_setup_required,
        )
        .await,
        check_service(
            &client,
            "offers",
            "Offres d’emploi",
            "http://127.0.0.1:8083/health/ready",
            "local",
            offers_managed,
            offers_setup_required,
        )
        .await,
        check_service(
            &client,
            "ollama",
            "IA locale (Ollama)",
            "http://127.0.0.1:11434/api/tags",
            "local",
            ollama_managed,
            false,
        )
        .await,
    ])
}

fn run_docker_compose(directory: PathBuf, service: &str, action: &str) -> Result<(), String> {
    let command = if action == "start" { "up" } else { "stop" };
    let mut process = Command::new("docker");
    process
        .current_dir(&directory)
        .arg("compose")
        .arg("-f")
        .arg(directory.join("compose.yaml"))
        .arg(command);
    if action == "start" {
        process.arg("-d");
    }
    let status = process.arg(service).status().map_err(|_| {
        "Docker est introuvable ou ne peut pas être lancé. Démarrez Docker Desktop puis réessayez."
            .to_owned()
    })?;
    if status.success() {
        Ok(())
    } else {
        Err("La commande Docker a échoué. Vérifiez Docker Desktop, le fichier .env et les journaux du service.".to_owned())
    }
}

fn random_secret() -> String {
    rand::rng()
        .sample_iter(&Alphanumeric)
        .take(48)
        .map(char::from)
        .collect()
}

fn initialize_notifications_development() -> Result<(), String> {
    let path = project_path().join("services/notifications/.env");
    if path.exists() {
        return Ok(());
    }
    let content = format!(
        "# Configuration locale créée par Cekarna Admin. Ne pas utiliser en production.\nAPP_ENV=development\nPOSTGRES_PASSWORD={}\nNOTIFICATIONS_DATABASE_URL=postgres://cekarna:change-me@127.0.0.1:55433/cekarna_notifications?sslmode=disable\nNOTIFICATIONS_INTERNAL_TOKEN={}\nNOTIFICATIONS_SMTP_HOST=mailpit\nNOTIFICATIONS_SMTP_PORT=1025\nNOTIFICATIONS_SMTP_USERNAME=local\nNOTIFICATIONS_SMTP_PASSWORD=local\nNOTIFICATIONS_SMTP_FROM=Cekarna <no-reply@cekarna.local>\nNOTIFICATIONS_SMTP_SECURITY=plain\nNOTIFICATIONS_MAX_ATTEMPTS=5\nNOTIFICATIONS_RETRY_SECONDS=60\nNOTIFICATIONS_RETENTION_DAYS=30\nRUST_LOG=info\n",
        random_secret(),
        random_secret(),
    );
    std::fs::write(path, content)
        .map_err(|_| "Impossible de créer la configuration locale des notifications.".to_owned())
}

fn env_value(path: &Path, key: &str) -> Option<String> {
    let content = std::fs::read_to_string(path).ok()?;
    content.lines().find_map(|line| {
        let (name, value) = line.split_once('=')?;
        (name.trim() == key).then(|| value.trim().to_owned())
    })
}

fn set_env_value(path: &Path, key: &str, value: &str) -> Result<(), String> {
    let existing = std::fs::read_to_string(path).unwrap_or_default();
    let mut found = false;
    let mut lines = existing
        .lines()
        .map(|line| {
            if line
                .split_once('=')
                .is_some_and(|(name, _)| name.trim() == key)
            {
                found = true;
                format!("{key}={value}")
            } else {
                line.to_owned()
            }
        })
        .collect::<Vec<_>>();
    if !found {
        lines.push(format!("{key}={value}"));
    }
    std::fs::write(path, format!("{}\n", lines.join("\n")))
        .map_err(|_| "Impossible de mettre à jour la configuration de l’API candidat.".to_owned())
}

fn initialize_offers_development() -> Result<(), String> {
    let project = project_path();
    let directory = project.join("services/offers");
    let env_path = directory.join(".env");
    let api_env = project.join(".env");
    let token = env_value(&env_path, "OFFERS_INTERNAL_TOKEN")
        .filter(|value| value.len() >= 32)
        .or_else(|| env_value(&api_env, "OFFERS_INTERNAL_TOKEN").filter(|value| value.len() >= 32))
        .unwrap_or_else(random_secret);
    set_env_value(&api_env, "OFFERS_BASE_URL", "http://127.0.0.1:8083")?;
    set_env_value(&api_env, "OFFERS_INTERNAL_TOKEN", &token)?;
    if env_path.exists() {
        set_env_value(&env_path, "OFFERS_INTERNAL_TOKEN", &token)?;
        return Ok(());
    }
    let validation = directory.join(".validation");
    std::fs::create_dir_all(&validation)
        .map_err(|_| "Impossible de préparer les données locales des offres.".to_owned())?;
    std::fs::write(
        validation.join("sources.toml"),
        "# Données entièrement synthétiques pour le développement local.\n[[source]]\nid = \"fixtures-locales\"\nkind = \"file\"\nterms = \"Données synthétiques locales, tests uniquement\"\nenabled = true\nmin_interval_seconds = 0\nlocations = [\"tests/fixtures/offres-synthetiques.json\"]\n\n[[source]]\nid = \"france-travail\"\nkind = \"france_travail\"\nterms = \"https://francetravail.io/data/api/offres-emploi\"\nenabled = false\nmin_interval_seconds = 900\nlocations = []\n",
    )
    .map_err(|_| "Impossible de créer la source locale des offres.".to_owned())?;
    std::fs::write(
        &env_path,
        format!(
            "# Configuration locale créée par Cekarna Admin. Ne pas utiliser en production.\nOFFERS_ADDR=127.0.0.1:8083\nOFFERS_DATABASE_PATH=offers.db\nOFFERS_INTERNAL_TOKEN={token}\nOFFERS_SOURCES_PATH=.validation/sources.toml\nRUST_LOG=info\n"
        ),
    )
    .map_err(|_| "Impossible de créer la configuration locale des offres.".to_owned())?;
    let status = Command::new("cargo")
        .args([
            "run",
            "--quiet",
            "--",
            "collect",
            "--source",
            "fixtures-locales",
        ])
        .current_dir(&directory)
        .status()
        .map_err(|_| "Cargo est introuvable ; installez Rust puis réessayez.".to_owned())?;
    if status.success() {
        Ok(())
    } else {
        let _ = std::fs::remove_file(env_path);
        Err(
            "La préparation des offres synthétiques a échoué. Consultez les journaux Cargo."
                .to_owned(),
        )
    }
}

fn start_local_service(processes: &ManagedProcesses, id: &'static str) -> Result<(), String> {
    if managed_by_panel(processes, id) {
        return Ok(());
    }
    let project = project_path();
    let mut command = match id {
        "candidate-api" => {
            let mut command = Command::new(if cfg!(windows) { "npm.cmd" } else { "npm" });
            command.arg("run").arg("start:dev").current_dir(project);
            command
        }
        "ollama" => {
            let mut command = Command::new("ollama");
            command.arg("serve");
            command
        }
        "offers" => {
            let mut command = Command::new("cargo");
            command
                .arg("run")
                .arg("--quiet")
                .arg("--")
                .arg("serve")
                .current_dir(project.join("services/offers"));
            command
        }
        _ => return Err("Service local inconnu.".to_owned()),
    };
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| match id {
            "ollama" => "Ollama est introuvable. Installez-le ou démarrez-le manuellement.".to_owned(),
            "offers" => "Le service d’offres n’a pas pu démarrer. Vérifiez Rust et sa configuration locale.".to_owned(),
            _ => "Le service candidat n’a pas pu démarrer. Vérifiez l’installation Node.js et ses dépendances.".to_owned(),
        })?;
    processes
        .0
        .lock()
        .expect("managed processes lock poisoned")
        .insert(id, child);
    Ok(())
}

fn stop_local_service(processes: &ManagedProcesses, id: &'static str) -> Result<(), String> {
    let child = processes
        .0
        .lock()
        .expect("managed processes lock poisoned")
        .remove(id);
    let Some(child) = child else {
        return Err(
            "Ce service n’a pas été démarré par ce panneau ; il n’est pas arrêté automatiquement."
                .to_owned(),
        );
    };
    #[cfg(windows)]
    {
        let status = Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status()
            .map_err(|_| "Impossible d’arrêter le processus local.".to_owned())?;
        if !status.success() {
            return Err("Impossible d’arrêter le processus local.".to_owned());
        }
    }
    #[cfg(not(windows))]
    {
        let mut child = child;
        child
            .kill()
            .map_err(|_| "Impossible d’arrêter le processus local.".to_owned())?;
    }
    Ok(())
}

#[tauri::command]
fn control_service(
    service: String,
    action: String,
    processes: tauri::State<'_, ManagedProcesses>,
) -> Result<(), String> {
    if !matches!(action.as_str(), "start" | "stop" | "initialize") {
        return Err("Action non autorisée.".to_owned());
    }
    match (service.as_str(), action.as_str()) {
        ("notifications", "initialize") => initialize_notifications_development(),
        ("offers", "initialize") => initialize_offers_development(),
        ("auth", action) => {
            run_docker_compose(project_path().join("services/auth"), "auth", action)
        }
        ("notifications", action) => run_docker_compose(
            project_path().join("services/notifications"),
            "notifications",
            action,
        ),
        ("candidate-api", "start") => start_local_service(&processes, "candidate-api"),
        ("offers", "start") => start_local_service(&processes, "offers"),
        ("ollama", "start") => start_local_service(&processes, "ollama"),
        ("candidate-api", "stop") => stop_local_service(&processes, "candidate-api"),
        ("offers", "stop") => stop_local_service(&processes, "offers"),
        ("ollama", "stop") => stop_local_service(&processes, "ollama"),
        _ => Err("Service inconnu.".to_owned()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(ManagedProcesses(Mutex::new(HashMap::new())))
        .invoke_handler(tauri::generate_handler![check_services, control_service])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{candidate_readiness_detail, env_value, set_env_value};

    #[test]
    fn readiness_detail_lists_only_known_unavailable_dependencies() {
        let detail = candidate_readiness_detail(
            r#"{"status":"degraded","dependencies":{"identity":{"status":"up"},"offers":{"status":"down"},"hermes":{"status":"not_configured"}}}"#,
        );
        assert_eq!(
            detail.as_deref(),
            Some("Dépendances indisponibles : offres, Hermes")
        );
        assert!(candidate_readiness_detail("not json").is_none());
    }

    #[test]
    fn env_value_is_added_then_replaced_without_duplicate() {
        let path = std::env::temp_dir().join(format!(
            "cekarna-admin-env-{}-{}.tmp",
            std::process::id(),
            rand::random::<u64>()
        ));
        std::fs::write(&path, "PORT=3000\n").unwrap();
        set_env_value(&path, "OFFERS_INTERNAL_TOKEN", "first-token").unwrap();
        set_env_value(&path, "OFFERS_INTERNAL_TOKEN", "second-token").unwrap();
        let content = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            env_value(&path, "OFFERS_INTERNAL_TOKEN").as_deref(),
            Some("second-token")
        );
        assert_eq!(content.matches("OFFERS_INTERNAL_TOKEN=").count(), 1);
        std::fs::remove_file(path).unwrap();
    }
}
