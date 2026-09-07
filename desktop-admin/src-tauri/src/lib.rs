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
) -> ServiceStatus {
    match client.get(endpoint).send().await {
        Ok(response) => {
            let status = response.status();
            let available = status.is_success();
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
                } else {
                    format!("Réponse HTTP {}", status.as_u16())
                },
                managed_by_panel,
                control,
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
    let ollama_managed = managed_by_panel(&processes, "ollama");

    Ok(vec![
        check_service(
            &client,
            "candidate-api",
            "API candidat",
            "http://127.0.0.1:3000/health",
            "local",
            api_managed,
        )
        .await,
        check_service(
            &client,
            "auth",
            "Identité",
            "http://127.0.0.1:8081/health/ready",
            "docker",
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
        )
        .await,
        check_service(
            &client,
            "ollama",
            "IA locale (Ollama)",
            "http://127.0.0.1:11434/api/tags",
            "local",
            ollama_managed,
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
        _ => return Err("Service local inconnu.".to_owned()),
    };
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| match id {
            "ollama" => "Ollama est introuvable. Installez-le ou démarrez-le manuellement.".to_owned(),
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
    if !matches!(action.as_str(), "start" | "stop") {
        return Err("Action non autorisée.".to_owned());
    }
    match (service.as_str(), action.as_str()) {
        ("auth", action) => {
            run_docker_compose(project_path().join("services/auth"), "auth", action)
        }
        ("notifications", action) => run_docker_compose(
            project_path().join("services/notifications"),
            "notifications",
            action,
        ),
        ("candidate-api", "start") => start_local_service(&processes, "candidate-api"),
        ("ollama", "start") => start_local_service(&processes, "ollama"),
        ("candidate-api", "stop") => stop_local_service(&processes, "candidate-api"),
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
