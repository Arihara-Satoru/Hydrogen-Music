if (process.platform === "win32" && process.stdout.isTTY) {
  require("node:child_process").execFileSync("chcp.com", ["65001"], {
    stdio: "ignore",
  });
}
