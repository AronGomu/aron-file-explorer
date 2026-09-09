// @vitest-environment node
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const repoRoot = resolve(import.meta.dirname, "../..");
const scratchParent = join(repoRoot, ".tmp/theme-validation");
const envKeys = [
  "HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME",
  "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "XDG_CONFIG_DIRS", "XDG_DATA_DIRS", "TMPDIR",
];
let root;

beforeEach(async () => {
  await mkdir(scratchParent, { recursive: true });
  root = await mkdtemp(join(scratchParent, "runner-test-"));
  await mkdir(join(root, "scripts"));
  await mkdir(join(root, "bin"));
  await copyFile(
    join(repoRoot, "scripts/run-isolated-rust-tests.mjs"),
    join(root, "scripts/run-isolated-rust-tests.mjs"),
  );
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await executable("cargo", `
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
writeFileSync("compile-call.json", JSON.stringify({
  argv: process.argv.slice(2), cwd: process.cwd(), target: process.env.CARGO_TARGET_DIR,
}));
process.stderr.write("dummy cargo stderr\\n");
const artifact = (name, profile = { test: true }, reason = "compiler-artifact") =>
  JSON.stringify({ reason, profile, executable: name && resolve("bin", name) });
switch (process.env.STUB_SCENARIO) {
  case "compile-failure":
    process.stdout.write(JSON.stringify({ reason: "compiler-message", message: { rendered: "dummy compile diagnostic" } }) + "\\n");
    process.exit(9); break;
  case "malformed": process.stdout.write("not cargo JSON\\n"); break;
  case "no-executable": process.stdout.write(artifact(null) + "\\n"); break;
  default:
    process.stdout.write([
      artifact("must-not-run", { test: false }),
      artifact("must-not-run", { test: true }, "build-script-executed"),
      artifact(null), artifact("first"), artifact("first"), artifact("second"), "",
    ].join("\\n"));
}
`);
  const child = `
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
const keys = ${JSON.stringify(envKeys)};
const env = Object.fromEntries(keys.map(key => [key, process.env[key]]));
writeFileSync("observation.json", JSON.stringify({
  cwd: process.cwd(), argv: process.argv.slice(2), env,
  fixture: readFileSync("fixtures/default-folder/README.txt", "utf8"),
}));
for (const [key, value] of Object.entries(env)) {
  if (value) writeFileSync(join(value, key + ".probe"), "dummy child wrote here\\n");
}
process.stdout.write("dummy test stdout\\n");
process.stderr.write("dummy test stderr\\n");
process.exit(process.env.STUB_SCENARIO === "child-failure" ? 7 : 0);
`;
  await executable("first", child);
  await executable("second", child);
});

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function executable(name, source) {
  const path = join(root, "bin", name);
  await writeFile(path, `#!${process.execPath}\n${source}`);
  await chmod(path, 0o755);
}

async function run(argv, scenario = "success") {
  const inherited = join(root, "inherited-must-not-use");
  await mkdir(inherited, { recursive: true });
  const result = spawnSync(process.execPath, [join(root, "scripts/run-isolated-rust-tests.mjs"), ...argv], {
    cwd: root,
    env: {
      ...process.env,
      ...Object.fromEntries(envKeys.map(key => [key, inherited])),
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      STUB_SCENARIO: scenario,
    },
    encoding: "utf8",
    timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  const evidence = join(repoRoot, "artifacts/theme-validation/repair/runner", root.split("/").pop());
  await mkdir(evidence, { recursive: true });
  await writeFile(join(evidence, "cli.json"), JSON.stringify({ argv, scenario, status: result.status, stdout: result.stdout, stderr: result.stderr }, null, 2));
  for (const path of await readdir(root, { recursive: true })) {
    if (path.endsWith("run.json") || path.endsWith("observation.json") || path.endsWith(".log") || path === "compile-call.json") {
      const target = join(evidence, path);
      await mkdir(resolve(target, ".."), { recursive: true });
      await copyFile(join(root, path), target);
    }
  }
  return result;
}

async function cases() {
  const path = join(root, ".tmp/theme-validation/rust");
  return (await readdir(path)).sort().map(name => join(path, name));
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

describe("isolated Rust runner real CLI with dummy executables", () => {
  test.each([
    [["--filter", "fixture with spaces; literal"], ["fixture with spaces; literal", "--test-threads=1"]],
    [["--all"], ["--test-threads=1"]],
  ])("forwards %j; filters and deduplicates Cargo artifacts; isolates real children", async (argv, forwarded) => {
    const result = await run(argv);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("dummy cargo stderr");
    expect(await json(join(root, "compile-call.json"))).toEqual({
      argv: ["test", "--locked", "--manifest-path", "src-tauri/Cargo.toml", "--no-run", "--message-format=json"],
      cwd: root,
      target: join(root, "target"),
    });
    const roots = await cases();
    expect(roots).toHaveLength(2);
    for (const caseRoot of roots) {
      const observed = await json(join(caseRoot, "cwd/observation.json"));
      const metadata = await json(join(caseRoot, "run.json"));
      expect(observed.cwd).toBe(join(caseRoot, "cwd"));
      expect(observed.argv).toEqual(forwarded);
      expect(observed.fixture).toBe("isolated theme validation fixture\n");
      expect(metadata).toMatchObject({ cwd: observed.cwd, args: forwarded, status: "passed" });
      for (const key of envKeys) {
        expect(observed.env[key]?.startsWith(`${caseRoot}/`), `${key} must not inherit host path`).toBe(true);
        expect(metadata.env[key]).toBe(observed.env[key]);
        expect(await readFile(join(observed.env[key], `${key}.probe`), "utf8")).toBe("dummy child wrote here\n");
      }
      expect((await stat(observed.env.XDG_RUNTIME_DIR)).mode & 0o777).toBe(0o700);
      expect(await readFile(join(caseRoot, "stdout.log"), "utf8")).toBe("dummy test stdout\n");
      expect(await readFile(join(caseRoot, "stderr.log"), "utf8")).toBe("dummy test stderr\n");
    }
    expect(await readdir(join(root, "inherited-must-not-use"))).toEqual([]);
  });

  test.each([
    ["malformed", "Cargo emitted invalid JSON while collecting test executables: not cargo JSON"],
    ["no-executable", "Cargo produced no test executables"],
    ["compile-failure", "exited with status 9"],
  ])("rejects %s without spawning tests", async (scenario, error) => {
    const result = await run(["--all"], scenario);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(error);
    if (scenario === "compile-failure") {
      expect(result.stdout).toContain('"rendered":"dummy compile diagnostic"');
    }
    expect((await readdir(root, { recursive: true })).filter(path => path.endsWith("observation.json"))).toEqual([]);
  });

  test("propagates real child failure with stdout, stderr, argv and failed run metadata", async () => {
    const result = await run(["--filter", "failure"], "child-failure");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("first failure --test-threads=1 exited with status 7");
    const roots = await cases();
    expect(roots).toHaveLength(1);
    expect(await json(join(roots[0], "run.json"))).toMatchObject({ status: "failed", args: ["failure", "--test-threads=1"] });
    expect(await readFile(join(roots[0], "stdout.log"), "utf8")).toBe("dummy test stdout\n");
    expect(await readFile(join(roots[0], "stderr.log"), "utf8")).toBe("dummy test stderr\n");
  });

  test.each([[], ["--filter"], ["--all", "extra"]])("rejects invalid CLI argv %j before Cargo", async (...argv) => {
    const result = await run(argv);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: node scripts/run-isolated-rust-tests.mjs --filter <name> | --all");
    expect(await readdir(root)).not.toContain("compile-call.json");
  });
});
