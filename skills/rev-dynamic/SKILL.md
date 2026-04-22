---
name: rev-dynamic
description: Dynamic reverse engineering - sandbox execution, debugging, tracing, emulation, and Frida instrumentation. Load for any work that runs or instruments a sample. Covers the Docker sandbox protocol, gdb/lldb recipes, strace/ltrace/frida usage, qemu-user and qemu-system emulation, network-capture discipline, and anti-debug bypass.
---

# Dynamic Reverse Engineering

## TL;DR

Dynamic analysis runs or instruments a sample. Every execution happens inside the pinned Docker toolkit image with `--network=none` by default. The host never touches the sample directly. Traces land under `.rev/traces/` with per-run metadata in `.rev/sandbox/runs/`.

## Sandbox Protocol

The toolkit image is built from `resources/Dockerfile.example`. Build once per toolchain change:

```bash
docker build -t re-toolkit:latest -f skills/rev-dynamic/resources/Dockerfile.example .
docker inspect --format='{{.Id}}' re-toolkit:latest > .rev/sandbox/image-digest
```

Record the digest in `.rev/config.yaml` under `sandbox.digest`.

Default invocation (no network):

```bash
docker run --rm --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  -v $(pwd)/.rev:/work:rw \
  -v /path/to/sample:/sample:ro \
  re-toolkit:<digest>
```

Capture-only tap mode (local bridge to tcpdump, never direct internet):

```bash
docker run --rm --network=tap-bridge --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  -v $(pwd)/.rev:/work:rw \
  -v /path/to/sample:/sample:ro \
  re-toolkit:<digest>
```

Volume semantics:

- `/sample` bind-mounted read-only; the container cannot mutate the original
- `/work` is the writable `.rev/` tree; outputs go here
- `/tmp` is tmpfs; nothing persists beyond the container

Per-run metadata lands in `.rev/sandbox/runs/<timestamp>-<slug>.json`:

```json
{
  "timestamp": "2026-04-21T14:32:10Z",
  "sample_sha256": "a3f2e1...",
  "image_digest": "sha256:...",
  "network": "none",
  "cmd": ["strace", "-f", "-e", "trace=network,file,process", "/sample"],
  "exit_code": 0,
  "trace_path": "traces/strace/a3f2e1-run1.log"
}
```

## Debugging Recipes

**gdb-multiarch (cross-arch native, via qemu-user):**

```bash
qemu-arm -g 1234 /sample &
gdb-multiarch -ex 'set architecture arm' -ex 'target remote :1234' /sample
```

Useful breakpoint strategies:

- Break on suspicious imports: `b *__imp_CreateProcessA` (PE) or `b execve` (ELF)
- Break on interesting strings: find the string xref in rizin, then `b *<addr>`
- Break on crypto APIs: `b CryptEncrypt`, `b EVP_EncryptUpdate`
- Break on decoder stubs: identify by packer fingerprint, break at the end of the unpacker

**lldb (Mach-O):**

```bash
lldb /sample
(lldb) breakpoint set -n main
(lldb) run
```

## Tracing

**strace:**

```bash
strace -f -e trace=network,file,process -o /work/traces/strace/<hash>-run1.log /sample
```

Key categories: `network` (connect, sendto), `file` (open, unlink), `process` (fork, execve).

**ltrace (userspace library calls):**

```bash
ltrace -f -o /work/traces/ltrace/<hash>-run1.log /sample
```

**frida-trace (dynamic hook generation):**

```bash
frida-trace -f /sample -i 'recv' -i 'send' -i 'CryptEncrypt' -o /work/traces/frida/<hash>-run1.log
```

All traces are captured with line-oriented output where possible so diffs between runs are meaningful.

## Emulation

**qemu-user (single binary, non-native arch):**

```bash
qemu-arm /sample                   # run
qemu-arm -strace /sample           # with syscall trace
qemu-arm -g 1234 /sample           # wait for gdb
```

**qemu-system (full-system firmware):**

```bash
qemu-system-arm -M virt -kernel zImage -initrd rootfs.cpio.gz -append "console=ttyAMA0" -nographic
```

For firmware, see `rev-firmware` for `firmadyne`/`firmae` patterns.

**unicorn-engine / qiling (partial binary execution):**

Use when only a specific function needs to run without a full environment. Typical use case: isolated string-decoder function. Scripts live in `.rev/scripts/python/` and output to `.rev/traces/unicorn/`.

## Frida Hooking

Scripts live in `.rev/scripts/frida/`. Common hook families:

- **File I/O:** hook `open`, `read`, `write`, `unlink`
- **Network:** hook `connect`, `send`, `recv`, `SSL_write`, `SSL_read`
- **SSL keylog:** hook `SSL_write`/`SSL_read` and log premaster; decrypts associated pcap
- **Android Java:** `Java.perform(() => { const cls = Java.use("com.example.Foo"); cls.bar.implementation = function(x) { ... } })`
- **iOS ObjC:** `ObjC.classes.NSString['- stringWithUTF8String:'].implementation = ...`

Invocation pattern:

```bash
frida -U -l .rev/scripts/frida/ssl-keylog.js -f com.example.app --no-pause
```

## Network Capture Discipline

- Default: `--network=none`. No exceptions for unknown or suspected-malware samples.
- `--network-tap` mode: the sandbox joins a local bridge network where a sidecar `tcpdump` captures all traffic to `/work/traces/pcap/<hash>-run<N>.pcap`. The bridge has no route to the host or the internet. Verify with `iptables -L FORWARD` on the host before first use.
- Direct internet is never allowed. If the user requires egress, they explicitly override by running the sandbox on a separate isolated lab network, outside this skill's invariants. Record any such override in `.rev/config.yaml:sandbox.tap_justification` with detailed justification.
- PCAPs are gitignored by default (live in `.rev/traces/pcap/`).

## Trace Artifact Organization

```
.rev/traces/
  strace/<hash>-run1.log
  ltrace/<hash>-run1.log
  frida/<hash>-run1.log
  pcap/<hash>-run1.pcap           # gitignored
  unicorn/<hash>-decoder.json
```

Every run cross-references the matching metadata file in `.rev/sandbox/runs/`.

## Anti-Debug and Anti-VM Bypass

Common patterns and counters:

| Detection                | Counter                                                       |
|--------------------------|---------------------------------------------------------------|
| `IsDebuggerPresent`      | Patch return to 0, or Frida-hook to return false              |
| `ptrace(PTRACE_TRACEME)` | Preload a stub that returns 0; or patch the call              |
| Timing checks (`rdtsc`)  | Patch the check; or run under `qemu-user` where timing differs |
| CPUID hypervisor bit     | Patch CPUID handler; or use an unmarked sandbox kernel        |
| Process name check       | Rename `gdb`/`strace` binaries in the toolkit image           |

Record every bypass as a patch in `.rev/patches/<hash>/anti-debug-<slug>.patch`.

## Host Safety Invariants

These are non-negotiable:

- NEVER run a sample directly on the host OS
- NEVER attach a host debugger to a suspicious process
- NEVER use `--privileged`, `--net=host`, `--pid=host`, or `--cap-add` on the sandbox
- NEVER mount `/` or the user's home directory into the sandbox
- NEVER disable `no-new-privileges`
- NEVER run the sandbox as host root when the host has any writable bind mounts beyond `.rev/`

## Forbidden Actions

- NEVER execute a sample outside the Docker sandbox
- NEVER enable unrestricted network egress from the sandbox
- NEVER exfiltrate trace data out of `.rev/` to a third-party service without user authorization
- NEVER commit pcaps or memory dumps
