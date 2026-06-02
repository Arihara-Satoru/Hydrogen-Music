use std::process::{Child, Command, Stdio};
use std::time::Duration;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::Manager;

const SIDECAR_PORT: u16 = 36530;

/// Windows 上隐藏控制台窗口的标志
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

/// 获取当前平台的 target triple
fn target_triple() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("windows", "x86_64") => "x86_64-pc-windows-msvc",
        ("windows", "aarch64") => "aarch64-pc-windows-msvc",
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu",
        ("macos", "x86_64") => "x86_64-apple-darwin",
        ("macos", "aarch64") => "aarch64-apple-darwin",
        (os, arch) => {
            eprintln!("[backend] Unknown platform: {}-{}", os, arch);
            ""
        }
    }
}

/// 查找 sidecar 二进制路径
/// 开发模式：在 src-tauri/binaries/ 目录下
/// 生产模式：通过 app.path().resource_dir() 找到 Tauri 资源目录
fn find_sidecar_binary(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let ext = if cfg!(target_os = "windows") { ".exe" } else { "" };
    let triple = target_triple();
    let binary_name = format!("sidecar-server-{}{}", triple, ext);

    // 1. 开发模式：从 CARGO_MANIFEST_DIR/binaries/ 查找
    #[cfg(debug_assertions)]
    {
        let dev_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(&binary_name);
        if dev_path.exists() {
            return Some(dev_path);
        }
        // 也尝试不带 triple 的名字
        let simple_name = format!("sidecar-server{}", ext);
        let simple_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(&simple_name);
        if simple_path.exists() {
            return Some(simple_path);
        }
    }

    // 2. 生产模式：从 Tauri 资源目录查找
    //    Tauri 2.x 会将 sidecar 二进制放在资源目录下
    if let Ok(resource_dir) = app.path().resource_dir() {
        // 常见位置：resource_dir/binaries/sidecar-server-{triple}.exe
        let res_path = resource_dir.join("binaries").join(&binary_name);
        if res_path.exists() {
            return Some(res_path);
        }
        // 尝试直接放在资源目录下
        let res_direct = resource_dir.join(&binary_name);
        if res_direct.exists() {
            return Some(res_direct);
        }
        // 尝试不带 triple 的名字
        let simple_name = format!("sidecar-server{}", ext);
        let simple_path = resource_dir.join("binaries").join(&simple_name);
        if simple_path.exists() {
            return Some(simple_path);
        }
    }

    None
}

/// 查找 node.exe 路径（开发模式回退）
fn find_node() -> Option<String> {
    if let Ok(node) = std::env::var("NODE") {
        if !node.is_empty() {
            let p = std::path::Path::new(&node);
            if p.exists() {
                return Some(node);
            }
        }
    }

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

/// 查找 sidecar 脚本路径（开发模式回退）
fn find_sidecar_script() -> Option<std::path::PathBuf> {
    let candidates = vec![
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar").join("merged-server.js"),
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar").join("index.js"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }
    None
}

/// 创建隐藏窗口的 Command（Windows）
fn new_hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// 启动 sidecar 进程
/// 优先级：编译好的二进制 > node 脚本
pub fn start_sidecar(app: &tauri::AppHandle) -> Result<Child, String> {
    // 1. 尝试使用编译好的 sidecar 二进制
    if let Some(binary_path) = find_sidecar_binary(app) {
        println!("[backend] Starting sidecar binary: {:?}", binary_path);
        let child = new_hidden_command(&binary_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start sidecar binary: {}", e))?;
        println!("[backend] Sidecar binary started (PID: {})", child.id());
        return Ok(child);
    }

    // 2. 回退：通过 node 运行脚本（开发模式）
    println!("[backend] Sidecar binary not found, falling back to node script");
    let node = find_node().ok_or_else(|| {
        "Node.js 未找到。请安装 Node.js 或设置 NODE 环境变量。\n\
         如需生产构建，请先运行 'npm run build:sidecar' 编译独立二进制。"
            .to_string()
    })?;

    let script = find_sidecar_script().ok_or_else(|| {
        "Sidecar 脚本未找到。请确保 src-tauri/sidecar/merged-server.js 存在。".to_string()
    })?;

    let child = new_hidden_command(&node)
        .arg(&script)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start sidecar: {}", e))?;

    println!("[backend] Sidecar started via node (PID: {})", child.id());
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

/// 检测 KuGou API 端口是否就绪（和 sidecar 同端口）
pub fn is_kugou_api_ready() -> bool {
    is_port_open(SIDECAR_PORT)
}
