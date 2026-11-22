# Software implementation code

Store only the delivered software's implementation, runtime resources, and necessary project descriptions, dependency manifests, and build configuration. Source may be compiled into the software; it need not be packaged unchanged. Test code, verification scripts, build and packaging helper scripts, and similar materials are outside the software implementation and belong in the separate test area.

## 离线个人项目管理工作台 0.1.0

单人、单机项目管理：看板与列表、项目和任务归档、SQLite 本机存储及手动备份恢复。当前验收平台为 Windows 11 x64；未验证 Windows 10 或整机断网环境。只想使用软件，请完整解压便携运行包并双击 `Start.cmd`，不需要构建源码。

### 文件职责

| 文件 | 职责 |
| --- | --- |
| `package.json`、`tsconfig.json` | 应用入口、直接依赖版本与 TypeScript 检查配置 |
| `main.cjs`、`main-language.cjs` | Electron 窗口、单实例、IPC、原生菜单与主进程文案 |
| `preload.cjs`、`workspace-api.d.ts` | 向界面提供受限的工作区 API 及其类型 |
| `storage.cjs`、`backup.cjs` | SQLite 数据、迁移、事务与备份文件读写 |
| `index.html`、`renderer.tsx`、`workspace.css` | 界面入口、React 业务交互与样式 |
| `renderer-language.ts`、`workspace-motion.tsx` | 界面文案与交互动效 |

### 从本机已准备的依赖构建

下列 Windows PowerShell 命令从本目录执行。需要本机已有 Node.js（已验证 24.22.3）、Electron 43.3.0 Windows x64（运行用；自带 `node:sqlite`），以及一个已解包的依赖目录（通常叫 `node_modules`）。其中需要 `react` 19.1.1、`react-dom` 19.1.1、`scheduler` 0.26.0、`typescript` 5.9.3、`@types/react` 19.1.16、`@types/react-dom` 19.1.9、`csstype` 3.2.3 和 `@esbuild/win32-x64` 0.28.2。源码不附依赖、Electron 或 lockfile；缺少依赖时须先自行准备这些版本，以下命令不会联网下载或安装。

先在同一 PowerShell 会话中将 `$deps` 设为该依赖目录的绝对路径，将 `$work` 设为独立测试区下尚不存在的构建目录绝对路径。不要把它们设在源码目录中。

```powershell
$ErrorActionPreference = 'Stop'
$source = (Get-Location).Path
if (-not [IO.Path]::IsPathRooted($deps) -or -not [IO.Path]::IsPathRooted($work)) {
    throw 'Set $deps and $work to absolute paths first.'
}
$deps = (Resolve-Path -LiteralPath $deps).Path
if (Test-Path -LiteralPath $work) { throw 'Use a new build directory.' }
$inputDir = Join-Path $work 'build-input'
$output = Join-Path $work 'app'
$tempDir = Join-Path $work 'tmp'
$stagedModules = Join-Path $inputDir 'node_modules'
$stagedTypes = Join-Path $stagedModules '@types'
New-Item -ItemType Directory -Path $stagedTypes,$output,$tempDir | Out-Null
foreach ($type in 'react','react-dom') {
    Copy-Item -Recurse -LiteralPath (Join-Path $deps "@types\$type") -Destination $stagedTypes
}
Copy-Item -Recurse -LiteralPath (Join-Path $deps 'csstype') -Destination $stagedModules
$runtime = 'package.json','main.cjs','main-language.cjs','preload.cjs','storage.cjs','backup.cjs','index.html','workspace.css'
$build = 'tsconfig.json','renderer.tsx','renderer-language.ts','workspace-motion.tsx','workspace-api.d.ts'
foreach ($file in $runtime + $build) {
    Copy-Item -LiteralPath (Join-Path $source $file) -Destination $inputDir
}
$oldNodePath, $oldTemp, $oldTmp = $env:NODE_PATH, $env:TEMP, $env:TMP
try {
    $env:NODE_PATH = $deps
    $env:TEMP = $env:TMP = $tempDir
    node (Join-Path $deps 'typescript\bin\tsc') --project (Join-Path $inputDir 'tsconfig.json')
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript check failed.' }
    $bundle = Join-Path $output 'renderer.js'
    & (Join-Path $deps '@esbuild\win32-x64\esbuild.exe') (Join-Path $inputDir 'renderer.tsx') --bundle --platform=browser --format=iife --jsx=automatic --log-level=warning "--outfile=$bundle"
    if ($LASTEXITCODE -ne 0) { throw 'Renderer build failed.' }
    foreach ($file in $runtime) {
        $inputFile = Join-Path $inputDir $file
        if ($file.EndsWith('.cjs')) {
            node --check $inputFile
            if ($LASTEXITCODE -ne 0) { throw "Syntax check failed: $file" }
        }
        Copy-Item -LiteralPath $inputFile -Destination $output
    }
} finally {
    $env:NODE_PATH, $env:TEMP, $env:TMP = $oldNodePath, $oldTemp, $oldTmp
}
```

产物是 `$output` 中的 9 个文件。要试运行，先将 `$electronExe` 设为已完整解压的 `electron.exe` 的绝对路径，再在同一 PowerShell 会话中执行（`$work` 必须为本次新建的测试区目录）：

```powershell
$profile = Join-Path $work ('profile-' + [guid]::NewGuid().ToString('N'))
$oldProfile, $oldTemp, $oldTmp = $env:WORKSPACE_DATA_DIR, $env:TEMP, $env:TMP
try {
    $env:WORKSPACE_DATA_DIR = $profile
    $env:TEMP = $env:TMP = $tempDir
    $run = Start-Process -FilePath $electronExe -ArgumentList ('"' + $output + '"') -WorkingDirectory $output -Wait -PassThru
    if ($run.ExitCode -ne 0) { throw "App exit code: $($run.ExitCode)" }
} finally {
    $env:WORKSPACE_DATA_DIR, $env:TEMP, $env:TMP = $oldProfile, $oldTemp, $oldTmp
}
```

这是一套普通构建命令：esbuild 会在注释中写入相对目录，不同的源码/测试区布局可能使 `renderer.js` 的哈希不同。便携包使用已验收的冻结文件，不使用按此处说明重新构建的文件。
