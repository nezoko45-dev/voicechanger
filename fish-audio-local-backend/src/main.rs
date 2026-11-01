use axum::{
    body::Bytes,
    extract::{DefaultBodyLimit, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use reqwest::Client;
use serde::Deserialize;
use serde_json::json;
use std::{env, net::SocketAddr, sync::Arc};

const MAX_WAV_BYTES: usize = 4 * 1024 * 1024;
const ALLOWED_ORIGIN: &str = "https://nezoko45-dev.github.io";

#[derive(Clone)]
struct AppState {
    client: Client,
    api_key: String,
}

#[derive(Deserialize)]
struct TtsRequest {
    text: String,
    reference_id: String,
    speed: Option<f32>,
}

async fn cors(req: axum::http::Request<axum::body::Body>, next: Next) -> Response {
    let is_preflight = req.method() == Method::OPTIONS;
    let allowed_origin = req.headers().get(header::ORIGIN).and_then(|v| v.to_str().ok()) == Some(ALLOWED_ORIGIN);
    let mut response = if is_preflight {
        StatusCode::NO_CONTENT.into_response()
    } else {
        next.run(req).await
    };

    if allowed_origin {
        let h = response.headers_mut();
        h.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, HeaderValue::from_static(ALLOWED_ORIGIN));
        h.insert(header::ACCESS_CONTROL_ALLOW_METHODS, HeaderValue::from_static("POST, OPTIONS"));
        h.insert(header::ACCESS_CONTROL_ALLOW_HEADERS, HeaderValue::from_static("Content-Type"));
        h.insert("access-control-allow-private-network", HeaderValue::from_static("true"));
        h.insert(header::VARY, HeaderValue::from_static("Origin"));
    }
    response
}

async fn health() -> Json<serde_json::Value> {
    Json(json!({"ok": true, "service": "Fish Audio local backend"}))
}

async fn create_voice(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if body.len() > MAX_WAV_BYTES {
        return (StatusCode::PAYLOAD_TOO_LARGE, Json(json!({"error":"WAV upload is too large. Keep it under 4 MB."}))).into_response();
    }
    let content_type = match headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        Some(v) if v.to_ascii_lowercase().starts_with("multipart/form-data;") => v,
        _ => return (StatusCode::UNSUPPORTED_MEDIA_TYPE, Json(json!({"error":"Upload the WAV as multipart/form-data."}))).into_response(),
    };

    let result = state.client
        .post("https://api.fish.audio/model")
        .header(header::AUTHORIZATION, format!("Bearer {}", state.api_key))
        .header(header::CONTENT_TYPE, content_type)
        .body(body)
        .send()
        .await;

    match result {
        Ok(upstream) => {
            let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let content = upstream.bytes().await.unwrap_or_default();
            let mut response = (status, content).into_response();
            response.headers_mut().insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
            response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
            response
        }
        Err(e) => (StatusCode::BAD_GATEWAY, Json(json!({"error":format!("Could not contact Fish Audio: {e}")}))).into_response(),
    }
}

async fn reference_tts(
    State(state): State<Arc<AppState>>,
    Json(input): Json<TtsRequest>,
) -> Response {
    if input.text.trim().is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({"error":"Enter text to read aloud."}))).into_response();
    }
    if input.text.chars().count() > 3000 {
        return (StatusCode::PAYLOAD_TOO_LARGE, Json(json!({"error":"Keep each reading under 3,000 characters."}))).into_response();
    }
    if input.reference_id.len() < 8 || input.reference_id.len() > 100 ||
        !input.reference_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return (StatusCode::BAD_REQUEST, Json(json!({"error":"Upload your reference WAV first and select its saved voice ID."}))).into_response();
    }
    let speed = input.speed.unwrap_or(1.0).clamp(0.5, 1.5);
    let payload = json!({
        "text": input.text.trim(),
        "reference_id": input.reference_id,
        "format": "mp3",
        "normalize": true,
        "prosody": {"speed": speed}
    });

    match state.client
        .post("https://api.fish.audio/v1/tts")
        .header(header::AUTHORIZATION, format!("Bearer {}", state.api_key))
        .header(header::CONTENT_TYPE, "application/json")
        .header("model", "s2.1-pro")
        .body(payload.to_string())
        .send()
        .await
    {
        Ok(upstream) if upstream.status().is_success() => {
            let content_type = upstream.headers().get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok()).unwrap_or("audio/mpeg").to_string();
            match upstream.bytes().await {
                Ok(audio) => {
                    let mut response = (StatusCode::OK, audio).into_response();
                    if let Ok(value) = HeaderValue::from_str(&content_type) {
                        response.headers_mut().insert(header::CONTENT_TYPE, value);
                    }
                    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
                    response
                }
                Err(e) => (StatusCode::BAD_GATEWAY, Json(json!({"error":format!("Could not read Fish Audio audio: {e}")}))).into_response(),
            }
        }
        Ok(upstream) => {
            let status = StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
            let detail = upstream.text().await.unwrap_or_default();
            (status, Json(json!({"error":format!("Fish Audio request failed: {}", detail.chars().take(600).collect::<String>())}))).into_response()
        }
        Err(e) => (StatusCode::BAD_GATEWAY, Json(json!({"error":format!("Could not contact Fish Audio: {e}")}))).into_response(),
    }
}

#[tokio::main]
async fn main() {
    let api_key = match env::var("FISH_AUDIO_API_KEY") {
        Ok(value) if !value.trim().is_empty() => value,
        _ => {
            eprintln!("FISH_AUDIO_API_KEY is not set. Start the app with start.bat.");
            std::process::exit(1);
        }
    };
    let state = Arc::new(AppState {
        client: Client::builder().build().expect("Could not initialize HTTP client"),
        api_key,
    });

    let app = Router::new()
        .route("/", get(health))
        .route("/api/fish-create-voice", post(create_voice))
        .route("/api/fish-reference-tts", post(reference_tts))
        .layer(DefaultBodyLimit::max(MAX_WAV_BYTES))
        .layer(middleware::from_fn(cors))
        .with_state(state);

    let address = SocketAddr::from(([127, 0, 0, 1], 3000));
    let listener = tokio::net::TcpListener::bind(address).await.expect("Could not bind localhost:3000");
    println!("Fish Audio local backend is running at http://127.0.0.1:3000");
    println!("Keep this window open while using the GitHub Pages reader.");
    println!("Health check: http://127.0.0.1:3000/");
    axum::serve(listener, app).await.expect("Local backend stopped");
}
