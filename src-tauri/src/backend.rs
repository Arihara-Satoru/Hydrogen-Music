use std::process::{Child, Command, Stdio};
use std::time::Duration;

const SIDECAR_PORT: u16 = 36531;

/// Sidecar 进程状态
pub struct SidecarState {
    pub process: Option<Child>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self { process: None }
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        if let Some(mut child) = self.process.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// 查找 node.exe 路径
fn find_node() -> Option<String> {
    // 1. 尝试环境变量
    if let Ok(node) = std::env::var("NODE") {
        if !node.is_empty() {
            let p = std::path::Path::new(&node);
            if p.exists() {
                return Some(node);
            }
        }
    }

    // 2. 尝试 PATH 中的 node
    if let Ok(paths) = std::env::var("PATH") {
        for dir in std::env::split_paths(&paths) {
            let candidates = if cfg!(target_os = "windows") {
                vec![dir.join("node.exe"), dir.join("node.cmd")]
            } else {
                vec![dir.join("node")]
            };
            for candidate in candidates {
                if candidate.exists() {
                    return Some(candidate.to_string_lossy().to_string());
                }
            }
        }
    }

    None
}

/// 查找 sidecar 脚本路径
fn find_sidecar_script() -> Option<std::path::PathBuf> {
    let candidates = vec![
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar").join("index.js"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

/// 启动 sidecar 进程
pub fn start_sidecar() -> Result<Child, String> {
    let node = find_node().ok_or_else(|| {
        "Node.js not found in PATH. Please install Node.js or set NODE environment variable.".to_string()
    })?;

    let script = find_sidecar_script().ok_or_else(|| {
        "Sidecar script not found. Ensure src-tauri/sidecar/index.js exists.".to_string()
    })?;

    let child = Command::new(&node)
        .arg(&script)
        .arg("--port")
        .arg(SIDECAR_PORT.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start sidecar: {}", e))?;

    println!("[backend] Sidecar started (PID: {})", child.id());
    Ok(child)
}

/// 等待 sidecar 端口就绪
pub fn wait_for_sidecar(timeout_ms: u64) -> bool {
    let start = std::time::Instant::now();
    let timeout = Duration::from_millis(timeout_ms);

    while start.elapsed() < timeout {
        if is_port_open(SIDECAR_PORT) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }

    false
}

/// 检测端口是否已打开
fn is_port_open(port: u16) -> bool {
    use std::net::TcpStream;
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(100),
    )
    .is_ok()
}

/// 停止 sidecar 进程
pub fn stop_sidecar(state: &std::sync::Mutex<SidecarState>) {
    if let Ok(mut guard) = state.lock() {
        if let Some(mut child) = guard.process.take() {
            println!("[backend] Stopping sidecar (PID: {})", child.id());
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// 获取 sidecar URL
pub fn sidecar_url() -> String {
    format!("http://127.0.0.1:{}", SIDECAR_PORT)
}

/// 检测 KuGou API 端口是否就绪
pub fn is_kugou_api_ready() -> bool {
    is_port_open(36530)
}
