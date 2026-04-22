---
name: rev-mobile
description: Mobile reverse engineering - Android APK/AAB and iOS IPA. Load for any mobile app analysis. Covers apktool/jadx/androguard workflows, iOS class-dump/ipsw/frida-ios-dump, SSL-pinning and root-detection bypasses, entitlements and manifest review, and output conventions under .rev/decompiled/.
---

# Mobile Reverse Engineering

## TL;DR

Android work centers on `apktool` + `jadx` + `androguard` for static, and Frida + `objection` for dynamic. iOS work centers on `class-dump` + `ipsw` + `frida-ios-dump` for static acquisition, and Frida for dynamic. SSL pinning and root/jailbreak detection are routinely bypassed via Frida scripts in `.rev/scripts/frida/`.

## Android Workflow

**Static:**

```bash
# Unpack resources and smali
apktool d /sample.apk -o .rev/decompiled/<hash>/smali/

# Decompile to Java
jadx -d .rev/decompiled/<hash>/java/ /sample.apk

# Metadata and permissions
androguard analyze /sample.apk > .rev/disasm/<hash>/androguard.txt
```

Always review:

- `AndroidManifest.xml` - permissions, exported components, intent filters, `android:debuggable`, `networkSecurityConfig`
- `res/xml/network_security_config.xml` - cleartext policy, pinning, trust anchors
- Native libraries under `lib/<arch>/*.so` - drop into Ghidra for JNI function analysis
- `classes*.dex` - all dex files in a multi-dex APK
- `assets/` and `res/raw/` - often contain obfuscated payloads or encoded config

**Dynamic (Frida + objection):**

```bash
# Launch target, attach Frida
frida -U -l .rev/scripts/frida/ssl-pin-bypass.js -f com.example.app --no-pause

# objection for interactive instrumentation
objection -g com.example.app explore
```

Common Frida hook sets for Android:

- SSL pinning bypass: hook `okhttp3.CertificatePinner.check`, `javax.net.ssl.X509TrustManager.checkServerTrusted`
- Root detection bypass: hook `java.io.File.exists` for known root paths; hook `Runtime.exec` for `su` checks
- Signature check bypass: hook `PackageManager.getPackageInfo` to return the original signature

**JNI / native library analysis:**

- Native `.so` files follow the same workflow as ELF; see `rev-static`
- Cross-reference Java native method declarations (`native` keyword) against `JNI_OnLoad` and `Java_<class>_<method>` exports

## iOS Workflow

**Static acquisition:**

```bash
# Extract class interfaces from Mach-O binary
class-dump -H /path/to/MyApp -o .rev/decompiled/<hash>/objc/

# Inspect IPA / firmware
ipsw extract /sample.ipa

# For decrypted IPAs, disassemble ARM64 Mach-O in Ghidra
```

Always review:

- `Info.plist` - bundle ID, URL schemes, background modes, `NSAppTransportSecurity` (ATS)
- Entitlements (`codesign -d --entitlements - /path/to/MyApp.app`) - keychain groups, app groups, associated domains
- Embedded provisioning profile
- Swift metadata and ObjC runtime tables

**Swift and ObjC symbol demangling:**

```bash
# Swift demangling requires the Swift toolchain (Xcode on macOS or swift-lang on Linux).
# Run on the analyst's host, not inside the Docker sandbox.
xcrun swift-demangle < symbols.txt > demangled.txt

# ObjC method names are plain in the Mach-O; class-dump extracts them
```

**Dynamic (Frida on jailbroken device or simulator):**

```bash
# Dump decrypted binaries from a jailbroken device
frida-ios-dump -H <device-ip>

# Hook ObjC methods
frida -U -l .rev/scripts/frida/objc-nslog.js -f com.example.app --no-pause
```

Common Frida hook sets for iOS:

- SSL pinning bypass: hook `SecTrustEvaluateWithError`, `NSURLSession:didReceiveChallenge:`
- Jailbreak detection bypass: hook `stat`/`access` for `/Applications/Cydia.app`, `/bin/bash`; hook `canOpenURL:` for `cydia://`
- Keychain dump: hook `SecItemCopyMatching`

## Output Conventions

```
.rev/decompiled/<hash>/
  smali/              # apktool output
  java/               # jadx output
  objc/               # class-dump output
  swift-demangled.txt
  manifest.xml        # copy or export of AndroidManifest.xml
  entitlements.xml    # iOS entitlements
  info.plist          # iOS Info.plist
.rev/disasm/<hash>/
  androguard.txt
  native-libs/        # per-arch .so analysis output (links to rev-static conventions)
```

## Forbidden Actions

- NEVER install a suspected-malware APK on a real host Android device. Use an isolated emulator inside the sandbox.
- NEVER attach Frida to a host process on the analyst's own device without explicit user authorization.
- NEVER distribute decrypted IPAs or unpacked APKs beyond the local `.rev/` tree.
