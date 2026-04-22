---
name: rev-methodology
description: Reverse engineering engagement methodology. Load at the start of every reverse-engineer engagement. Covers the .rev/ directory layout, engagement lifecycle, config.yaml schema, triage checklist, per-sample report template, confidence levels, sample classifications, and replay workflow.
---

# Reverse Engineering Methodology

## TL;DR

Every engagement is a structured lifecycle: scope -> triage -> static -> dynamic (if in scope) -> artifact authoring -> report -> replay. The `.rev/` directory is the engagement's complete record. Every capability claim has an evidence citation. Uncertain claims are labeled HYPOTHESIS, not promoted to capabilities.

## Engagement Lifecycle

Scope -> Triage -> Static analysis -> Dynamic analysis (if in scope) -> Artifact authoring (YARA/Sigma/IoC/protocol/patch) -> Report -> Replay

## The .rev/ Directory

```
.rev/
  config.yaml              # target(s), goal, authorization, risk class, sandbox digest
  samples/                 # hashed names + sample-map.json (gitignored)
  disasm/                  # raw per-tool output (Ghidra export, r2 sessions)
  decompiled/              # cleaned pseudocode per sample
  scripts/                 # r2 scripts, ghidra headless, frida hooks, python harnesses
    frida/
    ghidra/
    r2/
    python/
  yara/                    # authored YARA rules + <rule>.match.json outcome files
  sigma/                   # authored Sigma rules
  iocs/                    # structured JSON per sample, schema in rev-malware
  protocols/               # reversed protocol specs + .ksy files
  patches/                 # before/after binary patches + documentation
  traces/                  # dynamic capture
    strace/
    ltrace/
    frida/
    pcap/                  # gitignored
  reports/                 # per-sample and session reports
  sandbox/
    Dockerfile             # pinned RE toolkit (symlink or copy from skill resource)
    image-digest           # sha256 for reproducibility
    runs/                  # per-run metadata (timestamp, cmd, exit code, digest)
  run.sh                   # non-interactive replay
  .gitignore               # enforces: samples/, traces/pcap/, .env, large binaries
```

The default `.gitignore`:

```
samples/
traces/pcap/
.env
*.bin
*.exe.bak
sandbox/runs/*/core.*
```

## config.yaml Schema

```yaml
engagement:
  name: malware-triage-q2
  started: 2026-04-21
  authorization_ref: "User-owned sample, see docs/legal/"
  goal: malware-triage        # malware-triage | interop | capability-audit | firmware-audit | drm-analysis
  risk_class: suspected-malware  # unknown | trusted | suspected-malware | confirmed-malware
targets:
  - kind: native-pe
    path: samples/a3f2e1...
    sha256: a3f2e1...
  - kind: firmware
    path: samples/firmware-v2.bin
    sha256: 9b8c7d...
sandbox:
  image: re-toolkit
  digest: sha256:abcd1234...      # filled at build time
  network: none                   # none | tap
  tap_justification: ""           # required iff network: tap
tools:
  - { name: ghidra, version: "11.0.3" }
  - { name: rizin,  version: "0.7.2" }
output:
  format: markdown                # markdown | issues | inline
```

See `resources/config.example.yaml` for a fully annotated example.

## Sample Classifications

Sample classification drives sandbox strictness. Recorded in `config.yaml:engagement.risk_class`.

| Classification       | Sandbox Defaults                                        | Notes                                                  |
|----------------------|---------------------------------------------------------|--------------------------------------------------------|
| `unknown`            | `--network=none`, no tap without justification          | Default for first-time samples                         |
| `trusted`            | `--network=none` still required                         | Vendor-signed or user-authored binaries                |
| `suspected-malware`  | `--network=none` mandatory, execution timeout 120s      | All strict isolation applies                           |
| `confirmed-malware`  | `--network=none` mandatory, stricter timeouts, no tap   | Tap is forbidden unless user explicitly overrides      |

## Triage Checklist

Run on every new sample before any deeper analysis.

- [ ] Compute `sha256`, `sha1`, `md5` (`sha256sum`)
- [ ] Compute `ssdeep` fuzzy hash
- [ ] For PE: compute `imphash` (pefile)
- [ ] `file` output + MIME type
- [ ] Entropy profile (`binwalk -E` or equivalent); flag >7.2 as likely packed/encrypted
- [ ] Packer/protector detection (UPX, VMProtect, Themida, ConfuserEx)
- [ ] Language/compiler fingerprint (Go pclntab, Rust panic strings, Swift demangle, .NET CLR header, Java class version, Nim/Crystal markers)
- [ ] `strings -n 6` full output to `.rev/disasm/<hash>/strings.txt`
- [ ] Import/export table (PE: `dumpbin`/`pefile`; ELF: `readelf -a`; Mach-O: `otool -L`)
- [ ] Signature/certificate status
- [ ] Record all outputs to `.rev/disasm/<hash>/triage.json`

## Per-Sample Report Template

See `resources/report-template.md` for the authoritative skeleton. Structure:

1. **Identity** - hashes, filetype, size, compiler fingerprint, first-seen timestamp, classification
2. **Capabilities** - enumerated behaviors, each with confidence level and evidence citation
3. **Network** - domains, IPs, URLs, protocols; sourced from static strings and/or pcap
4. **Persistence** - startup mechanisms, scheduled tasks, service install, registry run keys
5. **IoCs** - link to `.rev/iocs/<hash>.json`; summary table in the report
6. **YARA / Sigma** - list of authored rules and their match outcomes
7. **Hypotheses** - claims lacking direct evidence; the evidence needed to promote each
8. **Replay** - exact commands to reproduce the analysis

## Confidence Levels

Every claim in every report carries a confidence level. The levels are exact: do not invent intermediate grades.

| Level        | Criterion                                                                                   |
|--------------|---------------------------------------------------------------------------------------------|
| `HIGH`       | Direct evidence: disasm citation shows the behavior OR dynamic trace captured it executing |
| `MEDIUM`     | Strong indirect evidence: imports + string pattern + control flow strongly imply the behavior |
| `LOW`        | Weak indirect evidence: one indicator present, others absent or ambiguous                   |
| `HYPOTHESIS` | No direct evidence yet. MUST include the experiment or artifact needed to confirm.          |

A HYPOTHESIS is not a capability. Reports list hypotheses in their own section, separate from capabilities.

## Replay Workflow

`run.sh` is assembled incrementally. Each phase appends a block.

- **Header block:** asserts sandbox image digest matches `config.yaml:sandbox.digest`; aborts on mismatch
- **Triage block:** regenerates hashes, strings, imports for each sample
- **Static block:** runs ghidra-headless / r2 scripts from `.rev/scripts/` and refreshes `disasm/` output
- **Dynamic block:** re-runs each sample in the sandbox with recorded args; captures trace output
- **YARA block:** runs every `.yar` rule against its source sample AND the benign corpus; updates `.match.json` files
- **IoC block:** regenerates `iocs/<hash>.json` from fresh static+dynamic output

Diff format for a replayed report:

- `new` - capability/IoC not present in previous run
- `resolved-hypothesis` - a hypothesis is now confirmed as a capability
- `regressed` - a capability previously confirmed no longer reproduces
- `stable` - unchanged

## Completion Checklist

- [ ] `.rev/config.yaml` present with authorization reference and sandbox digest
- [ ] Triage record present for every sample
- [ ] Every HIGH capability has an evidence citation
- [ ] Every HYPOTHESIS has an experiment plan
- [ ] All YARA rules match their source sample
- [ ] All YARA rules tested against the benign corpus with `.match.json` recorded
- [ ] All IoCs conform to the schema in `skills/rev-malware/resources/ioc-schema.json`
- [ ] `run.sh` executes end-to-end non-interactively
- [ ] Report committed; samples and pcaps remain gitignored
