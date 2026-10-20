/** Pure path-classification helpers. Paths are POSIX-style repository paths. */

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? path : path.slice(i + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** Lower-case extension without the dot ("" when none). Dotfiles like ".gitignore" have no extension. */
export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i + 1).toLowerCase();
}

export function depth(path: string): number {
  return path.split("/").length - 1;
}

export function isRootFile(path: string): boolean {
  return !path.includes("/");
}

export const SOURCE_EXTENSIONS = new Set([
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "mts",
  "cts",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "kt",
  "kts",
  "scala",
  "cs",
  "fs",
  "php",
  "swift",
  "m",
  "mm",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "hh",
  "dart",
  "ex",
  "exs",
  "erl",
  "hs",
  "lua",
  "r",
  "jl",
  "vue",
  "svelte",
  "astro",
  "clj",
  "cljs",
  "groovy",
  "zig",
  "nim",
  "ml",
  "elm",
  "sol",
]);

/** Directories that hold vendored, generated, or dependency content rather than authored code. */
const NON_AUTHORED_SEGMENTS = new Set([
  "node_modules",
  "vendor",
  "third_party",
  "third-party",
  "thirdparty",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  "bower_components",
  "__pycache__",
  ".venv",
  "venv",
  "site-packages",
  "generated",
  "__generated__",
  "coverage",
  ".git",
]);

export function isNonAuthoredPath(path: string): boolean {
  return path.split("/").some((seg) => NON_AUTHORED_SEGMENTS.has(seg.toLowerCase()));
}

export function isMinified(path: string): boolean {
  return /\.min\.(js|css|mjs)$/i.test(path) || /[-.]bundle\.js$/i.test(path);
}

export function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(path)) && !isNonAuthoredPath(path) && !isMinified(path) && !path.endsWith(".d.ts");
}

const TEST_DIR_SEGMENTS = new Set(["test", "tests", "__tests__", "spec", "specs", "e2e", "cypress", "testing", "integration-tests"]);

const TEST_FILE_PATTERNS: RegExp[] = [
  /\.(test|spec)\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i, // JS/TS
  /(^|\/)test_[^/]+\.py$/i, // pytest
  /(^|\/)[^/]+_test\.py$/i,
  /_test\.go$/, // Go
  /_spec\.rb$/, // RSpec
  /(^|\/)test_[^/]+\.rb$/, // minitest
  /_test\.rb$/,
  /(Test|Tests|IT)\.(java|kt|scala|groovy)$/, // JUnit conventions
  /Tests?\.cs$/, // xUnit/NUnit
  /Test\.php$/, // PHPUnit
  /_test\.dart$/,
  /Tests?\.swift$/,
  /_test\.exs$/,
  /\.test\.(vue|svelte)$/i,
];

export function isTestFile(path: string): boolean {
  if (isNonAuthoredPath(path)) return false;
  if (TEST_FILE_PATTERNS.some((re) => re.test(path))) return true;
  const ext = extname(path);
  if (!SOURCE_EXTENSIONS.has(ext)) return false;
  const dirs = path.split("/").slice(0, -1);
  return dirs.some((d) => TEST_DIR_SEGMENTS.has(d.toLowerCase()));
}

/** Text-like files that are worth scanning for credential patterns. */
const SCANNABLE_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  "json",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "config",
  "properties",
  "env",
  "xml",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "tf",
  "tfvars",
  "hcl",
  "gradle",
  "sql",
  "txt",
  "md",
  "plist",
  "npmrc",
  "pypirc",
]);

const LOCKFILE_NAMES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "poetry.lock",
  "pipfile.lock",
  "cargo.lock",
  "gemfile.lock",
  "composer.lock",
  "go.sum",
  "uv.lock",
  "packages.lock.json",
  "pubspec.lock",
  "mix.lock",
  "flake.lock",
]);

export function isLockfile(path: string): boolean {
  return LOCKFILE_NAMES.has(basename(path).toLowerCase());
}

export function isScannableTextFile(path: string): boolean {
  if (isLockfile(path) || isMinified(path)) return false;
  const base = basename(path).toLowerCase();
  if (base.startsWith(".env")) return true;
  if ([".npmrc", ".pypirc", ".netrc", ".dockercfg", "dockerfile", "docker-compose.yml"].includes(base)) return true;
  return SCANNABLE_EXTENSIONS.has(extname(path));
}

const BINARY_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "ico",
  "webp",
  "tiff",
  "psd",
  "mp3",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "wav",
  "flac",
  "ogg",
  "webm",
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "7z",
  "rar",
  "xz",
  "jar",
  "war",
  "exe",
  "dll",
  "so",
  "dylib",
  "bin",
  "iso",
  "dmg",
  "pdf",
  "woff",
  "woff2",
  "ttf",
  "otf",
  "eot",
  "pkl",
  "h5",
  "onnx",
  "pt",
  "pth",
  "ckpt",
  "safetensors",
  "parquet",
  "sqlite",
  "db",
  "wasm",
  "class",
  "o",
  "a",
  "lib",
  "pyc",
  "npy",
  "npz",
]);

export function isBinaryExtension(path: string): boolean {
  return BINARY_EXTENSIONS.has(extname(path));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
