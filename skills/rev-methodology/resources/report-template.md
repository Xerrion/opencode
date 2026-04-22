# Reverse Engineering Report: <sample-name-or-hash>

- **Engagement:** <engagement-name from config.yaml>
- **Date:** YYYY-MM-DD
- **Analyst:** reverse-engineer
- **Sandbox digest:** sha256:...
- **Network mode:** none | tap (+ justification if tap)

## 1. Identity

| Field                 | Value           |
|-----------------------|-----------------|
| sha256                | ...             |
| sha1                  | ...             |
| md5                   | ...             |
| ssdeep                | ...             |
| imphash (PE only)     | ...             |
| Filetype              | e.g. PE32+ executable, Android APK, ARM firmware blob |
| Size                  | ... bytes       |
| Entropy               | e.g. 7.9 (likely packed) |
| Compiler / language   | e.g. Go 1.22, MSVC 2022, Swift 5.10 |
| Packer / protector    | e.g. UPX 4.0, or `none-detected` |
| Signature             | signed-by / unsigned / invalid |
| Classification        | unknown | trusted | suspected-malware | confirmed-malware |
| First seen            | YYYY-MM-DD      |

## 2. Capabilities

Each capability states confidence level and evidence citation. Capabilities without direct evidence belong in Section 7 (Hypotheses), not here.

### [HIGH] <Capability Title>

- **Evidence:** disasm citation (`.rev/decompiled/<hash>/main.c:142`) OR dynamic trace (`.rev/traces/frida/<hash>-run1.log:88`)
- **Behavior:** what the sample does, in one paragraph
- **References:** YARA rule name, IoC entry, ATT&CK technique if applicable

### [MEDIUM] <Capability Title>

- **Evidence:** indirect indicators (imports + string pattern)
- **Behavior:** ...
- **Gap to HIGH:** what would confirm this

## 3. Network

| Indicator       | Value                        | Source                       | Confidence |
|-----------------|------------------------------|------------------------------|------------|
| Domain          | c2.example.com               | static-string                | HIGH       |
| IP              | 198.51.100.42                | pcap (`traces/pcap/run1.pcap`) | HIGH     |
| URL             | https://c2.example.com/check | dynamic-trace                | HIGH       |
| Protocol        | HTTPS + custom header        | frida-hook                   | MEDIUM     |

## 4. Persistence

| Mechanism         | Location / Key                       | Source                | Confidence |
|-------------------|--------------------------------------|-----------------------|------------|
| Registry Run key  | HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Svc | strings+dynamic | HIGH |
| Scheduled task    | \Microsoft\Windows\Svc\Updater       | dynamic-trace         | HIGH       |

## 5. IoCs

Full IoC set: `.rev/iocs/<sha256>.json` (schema: `skills/rev-malware/resources/ioc-schema.json`).

Summary:

- 2 C2 domains (HIGH)
- 1 hardcoded IP (HIGH)
- 3 file paths dropped (HIGH)
- 1 mutex (HIGH)

## 6. YARA / Sigma

| Rule                       | Path                          | Matches source | Benign corpus false-positives |
|----------------------------|-------------------------------|----------------|-------------------------------|
| apt_xyz_stager             | `.rev/yara/apt_xyz_stager.yar`| yes            | 0                             |
| suspicious_c2_beacon       | `.rev/sigma/c2_beacon.yml`    | n/a (host log) | n/a                           |

## 7. Hypotheses

Claims lacking direct evidence. Each states what experiment or artifact would confirm it.

### [HYPOTHESIS] <Claim>

- **Basis:** why we suspect this
- **Confirmation plan:** specific trace, breakpoint, or decompile target that would confirm
- **Blocker:** anti-debug, missing symbols, packed section, etc.

## 8. MITRE ATT&CK Mapping

| Tactic              | Technique       | Observed?                 |
|---------------------|-----------------|---------------------------|
| Execution           | T1059.003       | yes - cmd.exe invoked     |
| Persistence         | T1547.001       | yes - Run key             |
| Defense Evasion     | T1027.002       | yes - packed with UPX     |
| Command and Control | T1071.001       | yes - HTTPS to C2         |

## 9. Replay

Exact non-interactive reproduction steps:

```bash
./.rev/run.sh
```

Or per-phase:

```bash
./.rev/run.sh --triage <sha256>
./.rev/run.sh --static <sha256>
./.rev/run.sh --dynamic <sha256>
./.rev/run.sh --yara
```

## 10. Sandbox Attestation

- **Image digest:** sha256:...
- **Toolkit versions:** ghidra 11.0.3, rizin 0.7.2, frida 16.4.8, yara 4.5.1
- **Runs:** `.rev/sandbox/runs/` contains timestamped run metadata for every dynamic invocation
