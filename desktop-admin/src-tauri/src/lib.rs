#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![check_services])
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
use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    name: &'static str,
    endpoint: &'static str,
    available: bool,
    status_code: Option<u16>,
    detail: String,
}

async fn check_service(
    client: &reqwest::Client,
    name: &'static str,
    endpoint: &'static str,
) -> ServiceStatus {
    match client.get(endpoint).send().await {
        Ok(response) => {
            let status = response.status();
            ServiceStatus {
                name,
                endpoint,
                available: status.is_success(),
                status_code: Some(status.as_u16()),
                detail: if status.is_success() {
                    "Disponible".to_owned()
                } else {
                    format!("Réponse HTTP {}", status.as_u16())
                },
            }
        }
        Err(error) => ServiceStatus {
            name,
            endpoint,
            available: false,
            status_code: None,
            detail: if error.is_timeout() {
                "Délai de réponse dépassé".to_owned()
            } else {
                "Injoignable".to_owned()
            },
        },
    }
}

#[tauri::command]
async fn check_services() -> Result<Vec<ServiceStatus>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|_| "Impossible de préparer le contrôle local.".to_owned())?;
    Ok(vec![
        check_service(&client, "API candidat", "http://127.0.0.1:3000/health").await,
        check_service(&client, "Identité", "http://127.0.0.1:8081/health/ready").await,
        check_service(
            &client,
            "Notifications",
            "http://127.0.0.1:8082/health/ready",
        )
        .await,
        check_service(
            &client,
            "IA locale (Ollama)",
            "http://127.0.0.1:11434/api/tags",
        )
        .await,
    ])
}
