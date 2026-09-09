import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const validationRoot = resolve(repoRoot, ".tmp/theme-validation");
function runProcess(command, args, options = {}) {
  const {
    cwd = repoRoot,
    env = process.env,
    captureStdout = false,
    captureStderr = false,
  } = options;

  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio:
        captureStdout || captureStderr
          ? ["ignore", captureStdout ? "pipe" : "inherit", captureStderr ? "pipe" : "inherit"]
          : "inherit",
    });
    let stdout = "";
    let stderr = "";

    if (captureStdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
    }
    if (captureStderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0) {
        const error = new Error(
          `${command} ${args.join(" ")} exited with ${signal || `status ${code}`}`,
        );
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolveProcess({ stdout, stderr });
    });
  });
}

export function collectTestExecutables(stdout) {
  const executables = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Cargo emitted invalid JSON while collecting test executables: ${line}`,
        { cause: error },
      );
    }
    if (
      message.reason === "compiler-artifact" &&
      message.profile?.test === true &&
      message.executable
    ) {
      executables.push(message.executable);
    }
  }
  return [...new Set(executables)];
}

export function spawnTestExecutable(executable, args, options = {}) {
  return runProcess(executable, args, {
    ...options,
    captureStdout: true,
    captureStderr: true,
  });
}

async function createIsolation(caseName, root = validationRoot) {
  const caseRoot = join(root, "rust", `${caseName}-${randomUUID()}`);
  const cwd = join(caseRoot, "cwd");
  const config = join(caseRoot, "os-config");
  const home = join(caseRoot, "home");
  const cache = join(caseRoot, "cache");
  const data = join(caseRoot, "data");
  const tmp = join(caseRoot, "tmp");
  const state = join(caseRoot, "state");
  const runtime = join(caseRoot, "runtime");
  const configDirs = join(caseRoot, "config-dirs");
  const dataDirs = join(caseRoot, "data-dirs");
  const fixtureRoot = join(cwd, "fixtures", "default-folder");

  await mkdir(fixtureRoot, { recursive: true });
  await Promise.all([
    mkdir(config, { recursive: true }),
    mkdir(home, { recursive: true }),
    mkdir(cache, { recursive: true }),
    mkdir(data, { recursive: true }),
    mkdir(state, { recursive: true }),
    mkdir(runtime, { recursive: true, mode: 0o700 }),
    mkdir(configDirs, { recursive: true }),
    mkdir(dataDirs, { recursive: true }),
    mkdir(tmp, { recursive: true }),
  ]);
  await writeFile(join(fixtureRoot, "README.txt"), "isolated theme validation fixture\n");

  return {
    caseRoot,
    cwd,
    env: {
      ...process.env,
      HOME: home,
      TMPDIR: tmp,
      XDG_CACHE_HOME: cache,
      XDG_CONFIG_HOME: config,
      XDG_DATA_HOME: data,
      XDG_STATE_HOME: state,
      XDG_RUNTIME_DIR: runtime,
      XDG_CONFIG_DIRS: configDirs,
      XDG_DATA_DIRS: dataDirs,
    },
  };
}

export async function runTestExecutables(
  executables,
  { filter, isolationRoot = validationRoot } = {},
) {
  for (const [index, executable] of executables.entries()) {
    const executableName = String(executable).split(/[\\/]/).pop();
    const safeName = executableName.replace(/[^A-Za-z0-9._-]/g, "_");
    const caseName = `case-${index}-${safeName}`;
    const isolation = await createIsolation(caseName, isolationRoot);
    const args = filter ? [filter, "--test-threads=1"] : ["--test-threads=1"];
    const runMetadata = {
      executable,
      args,
      filter: filter ?? null,
      cwd: isolation.cwd,
      env: {
        HOME: isolation.env.HOME,
        TMPDIR: isolation.env.TMPDIR,
        XDG_CACHE_HOME: isolation.env.XDG_CACHE_HOME,
        XDG_CONFIG_HOME: isolation.env.XDG_CONFIG_HOME,
        XDG_DATA_HOME: isolation.env.XDG_DATA_HOME,
        XDG_STATE_HOME: isolation.env.XDG_STATE_HOME,
        XDG_RUNTIME_DIR: isolation.env.XDG_RUNTIME_DIR,
        XDG_CONFIG_DIRS: isolation.env.XDG_CONFIG_DIRS,
        XDG_DATA_DIRS: isolation.env.XDG_DATA_DIRS,
      },
    };
    let result;
    try {
      result = await spawnTestExecutable(executable, args, {
        cwd: isolation.cwd,
        env: isolation.env,
      });
    } catch (error) {
      await writeFile(join(isolation.caseRoot, "stdout.log"), error.stdout ?? "");
      await writeFile(join(isolation.caseRoot, "stderr.log"), error.stderr ?? "");
      await writeFile(
        join(isolation.caseRoot, "run.json"),
        `${JSON.stringify({ ...runMetadata, status: "failed", error: error.message }, null, 2)}\n`,
      );
      throw error;
    }
    await writeFile(join(isolation.caseRoot, "stdout.log"), result.stdout);
    await writeFile(join(isolation.caseRoot, "stderr.log"), result.stderr);
    await writeFile(
      join(isolation.caseRoot, "run.json"),
      `${JSON.stringify({ ...runMetadata, status: "passed" }, null, 2)}\n`,
    );
  }
}

export async function runIsolatedRustTests({ filter, root = repoRoot } = {}) {
  const targetDir = resolve(root, "target");
  const { stdout: compileOutput } = await runProcess(
    "cargo",
    [
      "test",
      "--locked",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--no-run",
      "--message-format=json",
    ],
    {
      cwd: root,
      env: { ...process.env, CARGO_TARGET_DIR: targetDir },
      captureStdout: true,
    },
  );
  const executables = collectTestExecutables(compileOutput);
  if (executables.length === 0) {
    throw new Error("Cargo produced no test executables");
  }
  await runTestExecutables(executables, {
    filter,
    isolationRoot: resolve(root, ".tmp/theme-validation"),
  });
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === "--all") return {};
  if (argv.length === 2 && argv[0] === "--filter" && argv[1]) {
    return { filter: argv[1] };
  }
  throw new Error("Usage: node scripts/run-isolated-rust-tests.mjs --filter <name> | --all");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runIsolatedRustTests(parseArgs(process.argv.slice(2))).catch((error) => {
    if (error.stdout) process.stdout.write(error.stdout);
    console.error(error.message);
    process.exitCode = 1;
  });
}
