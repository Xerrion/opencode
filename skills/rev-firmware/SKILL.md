---
name: rev-firmware
description: Firmware and embedded reverse engineering. Load for firmware images, bootloaders, embedded filesystems, and RTOS binaries. Covers binwalk extraction, squashfs and jefferson workflows, U-Boot and Coreboot analysis, architecture identification, qemu-system and firmadyne emulation, and hardware-interface documentation guidance (agent does not touch hardware).
---

# Firmware Reverse Engineering

## TL;DR

Firmware analysis extracts the filesystem, identifies the architecture, maps the boot chain, and emulates individual binaries or the whole system in QEMU. The agent does not touch hardware. UART/JTAG notes are documentation only.

## Extraction

```bash
# Recursive carving; extracts common archives, filesystems, and bootloader structures
binwalk -eM /sample.bin -C .rev/disasm/<hash>/binwalk-out/

# Unpack a squashfs image manually if binwalk misses it
unsquashfs -d .rev/decompiled/<hash>/rootfs/ squashfs-root.img

# JFFS2
jefferson jffs2.img -d .rev/decompiled/<hash>/rootfs/

# U-Boot image extraction
dumpimage -T legacy -p 0 -o kernel.bin /sample.bin
mkimage -l /sample.bin
```

Record every extraction step to `.rev/disasm/<hash>/extract.sh` so it is replayable.

## Filesystem Analysis

Review the extracted rootfs:

- `/etc/passwd`, `/etc/shadow` - hardcoded credentials (record any finding as an IoC with HIGH confidence)
- `/etc/init.d/` and `/etc/rc*.d/` - boot scripts reveal startup services and network bindings
- `/usr/sbin/`, `/usr/bin/` - vendor binaries; the target of deeper static analysis
- Embedded certificates and private keys (`*.pem`, `*.crt`, `*.key`) - every finding is an IoC
- Update URLs and C2-like endpoints in config files and binaries
- `.ko` kernel modules - architecture hint plus vendor-specific driver analysis

## Bootloader Analysis

**U-Boot:**

- Identify the image magic (`27 05 19 56` for legacy format)
- `mkimage -l` lists the image header
- Environment variables in the U-Boot image reveal boot command, kernel load address, console settings
- Script images (`autoscr`) carry boot logic that can hide persistence

**Coreboot:**

- `cbfstool <rom> print` lists the CBFS components
- Identify payloads (SeaBIOS, Tianocore, GRUB) and extract them for separate analysis

**Vendor bootloaders:**

- Look for architecture-specific entry points and vendor magic strings
- Record the entry offset in `.rev/disasm/<hash>/boot.md`

## Architecture Identification

| Indicator              | Likely Arch                 |
|------------------------|-----------------------------|
| `7f 45 4c 46 01 01 01` | ELF 32-bit little-endian    |
| `feedface`/`cefaedfe`  | Mach-O 32-bit               |
| `feedfacf`             | Mach-O 64-bit               |
| MIPS-specific reloc    | MIPS                        |
| `.ARM` section         | ARM                         |
| Thumb markers          | ARM Thumb                   |
| RISC-V reloc           | RISC-V                      |

Use `binwalk -A` for architecture-by-signature scanning, or `file` on extracted binaries. Cross-check against the bootloader's declared architecture.

## Emulation

**qemu-user (single binary):**

```bash
qemu-arm /work/decompiled/<hash>/rootfs/usr/sbin/httpd
qemu-mipsel -strace /work/decompiled/<hash>/rootfs/usr/sbin/upnpd
```

**qemu-system-arm / qemu-system-mips (full system):**

```bash
qemu-system-arm -M virt -kernel zImage -initrd rootfs.cpio.gz \
  -append "console=ttyAMA0 root=/dev/ram0" -nographic
```

**firmadyne / firmae (automated firmware emulation):**

These frameworks auto-build a QEMU environment from a firmware image and a vendor-extraction database. They patch NVRAM access, stub out hardware-specific drivers, and redirect network interfaces to a tap bridge. Output lands in `.rev/sandbox/runs/firmadyne-<hash>/`.

```bash
# Inside the sandbox container
./run.sh <image-id>
```

Post-boot, the emulated device exposes its management surfaces on the tap bridge; combine with `tshark` to capture protocol traces.

## Hardware Interface Documentation

The agent does not touch hardware. When the analysis surfaces a physical interface, document the evidence:

- **UART:** note baud rate guesses (from strings or driver analysis), GPIO pinouts if documented in source, and any boot banner observed in emulated output
- **JTAG:** identify the TAP controller (ARM DAP, MIPS EJTAG); note the chain length from datasheet if available
- **SPI / I2C flash:** note the flash chip part number from strings, photos, or bill-of-materials documents provided by the user

These notes go in `.rev/disasm/<hash>/hardware.md` as documentation only. The user performs any physical probing.

## RTOS Binaries

| RTOS      | Indicators                                                     |
|-----------|----------------------------------------------------------------|
| FreeRTOS  | `vTaskStartScheduler`, `xTaskCreate`, `pxCurrentTCB`           |
| Zephyr    | `_kernel`, `z_thread_*`, specific section names                |
| VxWorks   | `bootrom`, `symTbl`, distinctive task-name strings             |
| ThreadX   | `_tx_thread_*`                                                 |
| Contiki   | `process_thread_*`                                             |

RTOS binaries often lack a standard executable format. Identify via strings and entry point, then load into Ghidra with the correct base address and architecture.

## Output Conventions

```
.rev/disasm/<hash>/
  binwalk-out/          # raw binwalk extraction
  extract.sh            # replayable extraction script
  boot.md               # bootloader analysis notes
  hardware.md           # physical-interface documentation (no hands-on probing)
.rev/decompiled/<hash>/
  rootfs/               # extracted filesystem (beware: can be huge)
  kernel.bin
  <arch>-binaries/      # per-binary Ghidra exports
.rev/sandbox/runs/
  firmadyne-<hash>/     # automated emulation artifacts
```

## Forbidden Actions

- NEVER flash modified firmware to a physical device under this agent's direction
- NEVER probe hardware interfaces (UART, JTAG, SPI) directly. Documentation only.
- NEVER connect an emulated firmware instance to the open internet; use `--network-tap` with local capture only
