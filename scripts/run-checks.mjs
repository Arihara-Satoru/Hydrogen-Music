import { main } from './checks/runner.mjs'

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`检查入口错误：${error.message}\n使用 pnpm check --help 查看用法。`)
  process.exitCode = 1
}
