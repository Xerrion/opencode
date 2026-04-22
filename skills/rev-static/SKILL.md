---
name: rev-static
description: Static reverse engineering across native, managed, JavaScript, and WebAssembly targets. Load for any disassembly, decompilation, string/xref analysis, compiler fingerprinting, packer detection, or capability-ID work. Covers Ghidra headless, rizin/radare2, language fingerprints, and JS/WASM/managed specifics.
---

# Static Reverse Engineering

## TL;DR

Static analysis extracts capabilities, strings, imports, and structure without running the sample. Prefer deterministic outputs: Ghidra headless exports and r2 scripts produce reproducible artifacts that land under `.rev/disasm/` and `.rev/decompiled/`. Every capability claim cites a file:offset location.

## Triage Recipes by Format

| Format      | First Commands                                                   |
|-------------|------------------------------------------------------------------|
| ELF         | `file`, `readelf -a`, `objdump -d`, `rizin -A`, `strings -n 6`   |
| PE          | `pefile`, `dumpbin /headers`, `rizin -A`, `capa`, `yara`         |
| Mach-O      | `otool -L`, `otool -h`, `class-dump`, `rizin -A`                 |
| APK         | `apktool d`, `jadx -d out/`, `androguard`                        |
| JAR / class | `cfr` or `procyon`; `javap -v` for version                       |
| DLL (.NET)  | `ilspycmd`, `dnSpy`, `ildasm`                                    |
| WASM        | `wasm-tools print`, `wasm-decompile`, `wabt wasm-objdump`        |
| Min-JS      | `webcrack`, `js-beautify`, sourcemap search                      |

## Ghidra Headless Workflow

Deterministic project creation and decompile export:

```bash
analyzeHeadless .rev/disasm/<hash>/ghidra-proj re-proj \
  -import /work/sample \
  -scriptPath .rev/scripts/ghidra/ \
  -postScript ExportCleanedDecompile.java .rev/decompiled/<hash>/
```

Conventions:

- One project per sample, named `re-proj`
- `.rev/scripts/ghidra/` holds reusable export scripts (cleaned pseudocode, function listings, import tables)
- Re-running is idempotent: Ghidra reuses the project; the script overwrites export files

## rizin / radare2 Workflow

```bash
rizin -A -q -c 'aaa; afl; pdf @ main; q' /work/sample > .rev/disasm/<hash>/r2-main.txt
```

Core command cheatsheet:

| Command   | Purpose                                |
|-----------|----------------------------------------|
| `aaa`     | Full auto-analysis                     |
| `afl`     | List functions                         |
| `pdf @ F` | Print disassembly of function `F`      |
| `axt @ S` | Cross-references to symbol `S`         |
| `iz`      | Strings in data sections               |
| `izz`     | Strings in the whole binary            |
| `ii`      | Imports                                |
| `is`      | Symbols                                |
| `iS`      | Sections                               |

For automation, use `r2pipe` from Python. Scripts live in `.rev/scripts/r2/` and write output to `.rev/disasm/<hash>/`.

## String and Cross-Reference Analysis

- `strings -n 6 -a /work/sample | tee .rev/disasm/<hash>/strings.txt`
- Filter suspicious patterns: URLs, file paths, registry keys, crypto constants, API names
- For every interesting string, record its xref: `axt @ <addr>` in rizin or Ghidra's "References" view
- Cross-reference findings belong in `.rev/disasm/<hash>/xrefs.md`

## Capability Identification (capa-style)

- Run `capa /work/sample -j > .rev/disasm/<hash>/capa.json`
- Capability rules match on imports + strings + mnemonic patterns
- Promote a capa match to a HIGH capability only after human review of the underlying disasm location
- Novel capabilities (not in capa's ruleset) require handwritten rules under `.rev/scripts/capa/`

## Compiler and Language Fingerprinting

| Fingerprint          | Indicators                                                         |
|----------------------|--------------------------------------------------------------------|
| Go                   | `.gopclntab` section, `runtime.` symbols, `go:itab` strings        |
| Rust                 | `core::panicking`, `rust_begin_unwind`, demangleable `_ZN` names   |
| Swift                | `_$s` mangled prefix; demangle with `swift demangle`               |
| Nim                  | `nimrtl`, `NimMain` symbols                                        |
| Crystal              | `_crystal_main`, `GC_init`                                         |
| .NET                 | CLR header at PE offset, `mscoree.dll` import                      |
| JVM class            | Magic `CAFEBABE`; major version maps to JDK                        |
| MSVC                 | Rich header (`Rich` magic before PE header)                        |
| GCC / clang          | `.comment` section with `GCC: ` or `clang version`                 |

Record the fingerprint in `.rev/disasm/<hash>/triage.json` under `language`.

## Packer and Protector Detection

| Packer      | Detection                                                        |
|-------------|------------------------------------------------------------------|
| UPX         | section names `UPX0`/`UPX1`, `upx -d` unpacks                    |
| VMProtect   | section `.vmp0`/`.vmp1`, high entropy, thunked IAT              |
| Themida     | section `.themida`, anti-debug stubs                             |
| ConfuserEx  | `ConfuserEx` string in assembly info; control-flow flattening    |
| ProGuard    | single-letter class and method names in JAR                      |

Record detection in `.rev/disasm/<hash>/triage.json` under `packer`. For unpackable packers (UPX), unpack a copy; never modify the original sample.

## JavaScript Specifics

- `webcrack <bundle.js> -o .rev/decompiled/<hash>/webcrack-out/` deobfuscates common obfuscators
- Search for sourcemap comments: `//# sourceMappingURL=` - if present and fetchable, prefer the mapped original
- Webpack extraction: identify the runtime (`__webpack_require__`) and dump each module to a separate file
- Obfuscator fingerprints: `obfuscator.io` (dead-code branches, string arrays with rotation), `javascript-obfuscator` (hex identifiers), `jscrambler` (control-flow flattening)
- Beautify only after deobfuscation: `js-beautify -s 2 -w 120`

## WebAssembly Specifics

- `wasm-tools print module.wasm > .rev/decompiled/<hash>/module.wat`
- `wasm-decompile module.wasm -o .rev/decompiled/<hash>/module.dcmp`
- Fingerprint runtime:
  - Emscripten: `_emscripten_*` imports, `GOT.mem`/`GOT.func` globals
  - Rust-wasm: `wbindgen` imports, `__wbindgen_placeholder__`
  - Go-wasm: `runtime.wasmExit`, `go.importObject`
- Cross-reference WASM imports against the host JS glue code to find the real API surface

## Managed Bytecode Specifics

**JVM:**

- `cfr --outputdir .rev/decompiled/<hash>/java/ /work/sample.jar`
- For single class: `javap -c -p Class.class`
- ProGuard detection: single-letter class/method names, `a.a.a()` chains
- Android DEX: convert with `dex2jar` then run `cfr`, or use `jadx` directly

**.NET:**

- `ilspycmd -o .rev/decompiled/<hash>/dotnet/ /work/sample.dll`
- ConfuserEx detection: `ConfusedBy` attribute, mangled names, control-flow flattening
- For native interop sections in a .NET binary, drop into Ghidra on the unmanaged stubs

## Output Conventions

```
.rev/disasm/<hash>/
  triage.json          # hashes, filetype, language, packer, size, entropy
  strings.txt          # strings -n 6 output
  ghidra-proj/         # ghidra project dir (gitignored)
  r2-main.txt          # rizin session output
  capa.json            # capa capability matches
  xrefs.md             # human-authored xref notes
.rev/decompiled/<hash>/
  main.c               # cleaned pseudocode for main/entry
  <function>.c         # one file per interesting function
  java/                # JVM decompile output
  dotnet/              # .NET decompile output
  webcrack-out/        # JS deobfuscation output
  module.wat           # WASM text format
  module.dcmp          # WASM decompiled C-like
```

## Forbidden Actions

- NEVER modify the original sample. Work on copies under `.rev/samples/`.
- NEVER fabricate a file:offset citation. If you cannot pin the evidence, the claim is a HYPOTHESIS.
- NEVER commit Ghidra project directories - they are large and not reproducible across versions.
