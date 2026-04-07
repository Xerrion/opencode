# Agent Gap-analyse: Faldgruber og Edge Cases

> Hvor kan AI-agenter undlade at foelge reglerne? Denne analyse daekker baade **haard enforcement** (permissions der blokerer) og **bloed enforcement** (prompt-instruktioner der kan ignoreres).

## Oversigt

| Kategori | Kritisk | Hoej | Medium | Lav |
|----------|---------|------|--------|-----|
| Permission-huller | 2 | 4 | 4 | 1 |
| Plugin-bypass | 1 | 1 | 2 | 0 |
| Bloed enforcement | 3 | 6 | 3 | 0 |
| **Total** | **6** | **11** | **9** | **1** |

---

## 1. Kritiske fund

### 1.1 Credential-plugin kan omgaas via bash

**Risiko:** KRITISK | **Type:** Plugin-bypass

Credential-protection pluginnet (`plugins/sn-credential-protection.ts`, linje 77) tjekker KUN `write` og `edit` tools. `coder`-agenten har bash-adgang til kommandoer der kan skrive filer direkte:

```bash
# Alle disse omgaar credential-pluginnet:
echo "SERVICENOW_PASSWORD=secret" > config.js          # via echo *: allow
sed -i '' 's/x/SERVICENOW_PASSWORD=secret/' file.js    # via sed *: allow
node -e "require('fs').writeFileSync('f.js','pw=x')"   # via node *: allow
python -c "open('f.js','w').write('sn_password=x')"    # via python *: allow
```

**Kilde:** `opencode.jsonc` linje 216-260 (bash permissions) + `sn-credential-protection.ts` linje 77 (tool check)

**Mulig fix:** Plugin boer ogsaa intercepte `bash` tool-kald og scanne kommandoer for credential-moenstre i output-redirects.

---

### 1.2 Vilkaarlig kodeekskvering via package managers

**Risiko:** KRITISK | **Type:** Permission-hul

`coder` og `code-simplifier` har wildcard-adgang til runtimes og package managers:

| Moenster | Risiko-eksempel |
|----------|----------------|
| `node *` | `node -e "require('child_process').exec('...')"` |
| `python *` | `python -c "import os; os.system('...')"` |
| `npx *` | `npx malicious-package` (downloader og koerer) |
| `bun *` | `bun x arbitrary-package` |
| `pip *` | `pip install pkg-with-install-hooks` |
| `make *` | Koerer vilkaarlige shell-kommandoer fra Makefiles |

**Kilde:** `opencode.jsonc` linje 211-225 (coder), linje 280-295 (code-simplifier)

> **Praecisering:** `python *`, `python3 *`, `pip *`, `pip3 *` og `uv *` er eksklusivt tilgaengelige for `coder`. `code-simplifier` har kun `node *`, `bun *`, `npm *`, `npx *`, `yarn *`, `pnpm *`, `cargo *`, `go *` og `make *`.

**Mulig fix:** Begraens til specifikke subkommandoer: `"node --check *": "allow"`, `"npx jest *": "allow"` etc.

---

### 1.3 Filosofi-loading er ikke gated

**Risiko:** KRITISK | **Type:** Bloed enforcement

`coder`-agenten har `write: allow` og `edit: allow` UDEN nogen haard betingelse om at `skill`-toolet er kaldt foerst. Hele enforcement-kaeden er bloede prompt-instruktioner:

1. `philosophy/AGENTS.md`: "Every code change requires a loaded philosophy" (global instruktion)
2. `build.md` linje 159-164: "specify which skills to load" (delegation-instruktion)
3. `coder.md` linje 12-16: "Before ANY implementation, you MUST load" (selv-instruktion)

**Ingen af disse er programmatisk haandhaevet.** Hvis coderen springer skill-loading over, kan den stadig skrive filer frit.

**Kilde:** `opencode.jsonc` linje 203-204 vs `coder.md` linje 12-16

**Mulig fix:** Plugin der intercepter `write`/`edit` og verificerer at `skill` tool er kaldt i samme session.

---

## 2. Hoej-risiko fund

### 2.1 Obligatorisk code review er kun en prompt-instruktion

**Risiko:** HOEJ | **Type:** Bloed enforcement

`build`-agentens review-protokol (`build.md` linje 44-46) siger:

> "After every delegation to coder that performs implementation, you MUST immediately delegate to code-reviewer."

Men der er ingen state machine, plugin, eller hook der haandhaever denne sekvens. Build-agenten KAN:
- Delegere til coder, faa resultat, og gaa videre uden review
- Beslutte at en aendring var "minor nok" til at springe review over
- Miste kontekst i en lang samtale og glemme review-steget

**Kilde:** `build.md` linje 44-58 vs `opencode.jsonc` linje 364-375

---

### 2.2 Code-reviewer tjekker IKKE filosofi-compliance

**Risiko:** HOEJ | **Type:** Bloed enforcement

Den obligatoriske review-loop bruger `code-reviewer`, som IKKE har en filosofi-checkliste. Den agent der faktisk tjekker filosofi (`reviewer`) er beskrevet som valgfri ("use for critical, complex, or security-sensitive changes").

| Agent | Filosofi-tjek | Bruges i review-loop |
|-------|---------------|---------------------|
| `code-reviewer` | Nej | Ja (obligatorisk) |
| `reviewer` | Ja (linje 34-59) | Nej (valgfri) |

**Kilde:** `code-reviewer.md` (ingen filosofi-reference) vs `reviewer.md` linje 34-59

---

### 2.3 `researcher` har `gh api *` - tillader skrive-operationer

**Risiko:** HOEJ | **Type:** Permission-hul

`researcher`-agenten er beskrevet som read-only, men `gh api *` giver fuld adgang til GitHub API inklusiv mutationer:

```bash
gh api -X DELETE repos/owner/repo           # Slet repository
gh api -X POST repos/owner/repo/issues      # Opret issues
gh api -X PUT repos/owner/repo/collaborators/attacker  # Tilfoej collaborators
```

**Kilde:** `opencode.jsonc` linje 155

**Mulig fix:** Begraens til `"gh api -H * GET *": "allow"` eller fjern `gh api` helt fra researcher.

---

### 2.4 Produktions-plugin fejler aabent paa non-standard URLs

**Risiko:** HOEJ | **Type:** Plugin-bypass

Produktions-warning pluginnet (`sn-production-warning.ts` linje 83-98) matcher kun `*.service-now.com` URLer. Alle andre URL-formater returnerer `isProd: false`:

```typescript
const match = instanceUrl.match(/https?:\/\/([^.]+)\.service-now\.com/);
if (!match) {
  return { isProd: false, reason: `Non-standard URL: ${instanceUrl}` };
}
```

Custom domains, IP-adresser, eller alternative ServiceNow hostnames omgaar beskyttelsen helt.

**Kilde:** `sn-production-warning.ts` linje 95-97

**Mulig fix:** Skift til fail-closed: returner `isProd: true` for ukendte URL-formater og kraev explicit opt-out.

---

### 2.5 `git`-agent kan force-push til main/master

**Risiko:** HOEJ | **Type:** Permission vs prompt-konflikt

`git`-agentens prompt siger "NEVER force-push to main, master, or develop" (`git.md` linje 48), men har `"git *": "allow"` (`opencode.jsonc` linje 431) som tillader `git push --force origin main`.

Andre destruktive operationer:
- `git reset --hard` - sletter working tree aendringer
- `git clean -fd` - sletter untracked filer
- `gh repo delete` - sletter hele repositories

**Kilde:** `git.md` linje 48 vs `opencode.jsonc` linje 431

**Mulig fix:** Deny specifikke moenstre: `"git push --force*": "deny"`, `"git reset --hard*": "deny"`, `"gh repo delete*": "deny"`.

---

### 2.6 Privilege escalation via `task: allow`

**Risiko:** HOEJ | **Type:** Permission-hul

Agenter med `task: allow` kan delegere til ENHVER anden agent, inklusiv mere privilegerede:

| Agent | Egne rettigheder | Kan delegere til |
|-------|-------------------|-----------------|
| `plan` | write: deny, bash: deny | `coder` (write + bash) |
| `build` | write: deny, bash: deny | `coder` (write + bash) |
| `servicenow` | edit: deny | `coder` (edit + bash) |

Dette er by design for orkestratorer, men en kompromitteret orkestrater kan udnytte delegation til at omgaa egne restriktioner.

**Kilde:** `opencode.jsonc` linje 357, 371, 440

---

### 2.7 Slash commands omgaar review-protokollen

**Risiko:** HOEJ | **Type:** Flow-bypass

Ingen af de 12 slash commands inkluderer et review-step:

| Kommando | Agent | Skriver kode | Review-step |
|----------|-------|-------------|-------------|
| `/sn-write` | servicenow | Ja (deployer til instans) | Nej |
| `/wow-scaffold` | wow-addon | Ja (opretter filer) | Nej |
| `/review` | (default) | Nej (kun review) | - |
| `/sn-debug` | servicenow | Nej (read-only) | - |

> **Note:** `/review` har ingen `agent:` i frontmatter og bruger default-agenten. Kommandoens body delegerer til `reviewer`-agenten.

`/sn-write` deployer scripts direkte til ServiceNow uden code review. `/wow-scaffold` er desuden broken - `wow-addon` agenten har `write: deny` og kan ikke oprette filer.

**Kilde:** Alle `command/*.md` filer

---

## 3. Medium-risiko fund

### 3.1 `servicenow` kan deploye scripts direkte trods "MUST NOT write scripts" regel

**Risiko:** MEDIUM | **Type:** Permission vs prompt-konflikt

`servicenow.md` linje 228 siger "You MUST NOT write, generate, or output ServiceNow script code yourself. EVER." Men agenten har `servicenow_*: allow` (`opencode.jsonc` linje 441) som inkluderer `artifact_create` og `artifact_update`.

**Kilde:** `servicenow.md` linje 228 vs `opencode.jsonc` linje 441

---

### 3.2 `code-simplifier` har ingen filosofi-enforcement

**Risiko:** MEDIUM | **Type:** Bloed enforcement

`code-simplifier` har `write: allow` og `edit: allow` men:
- Prompten naevner ikke `code-philosophy` eller `frontend-philosophy`
- Ingen filosofi-checkliste
- Ingen instruktion om at loade skills foer modifikation
- Build-agentens review-protokol naevner kun review efter `coder`, ikke efter `code-simplifier`

Simplifier kan omskrive kode der bryder de 5 Laws (f.eks. fjerne early exit guards for "enkelhed").

**Kilde:** `code-simplifier.md` (ingen filosofi-referencer) vs `opencode.jsonc` linje 275-276

---

### 3.3 `AGENTS.md` vs `coder.md` modsigelse om tests

**Risiko:** MEDIUM | **Type:** Instruktionskonflikt

| Kilde | Regel |
|-------|-------|
| `AGENTS.md` linje 40 | "MUST write tests for new functionality" |
| `coder.md` linje 85 | "NEVER write tests unless explicitly instructed by the orchestrator" |

Coderen foelger sin egen "NEVER" regel. Hvis build-agenten glemmer at instruere test-skrivning, skrives ingen tests trods global MUST-regel.

**Kilde:** `AGENTS.md` linje 40 vs `coder.md` linje 85

---

### 3.4 WoW MCP tools bruger individuelle deny-entries

**Risiko:** MEDIUM | **Type:** Permission-hul

Andre MCP servers bruger wildcard-deny (`servicenow_*: deny`, `exa_*: deny`), men WoW tools er listet individuelt:

```json
"wow-api-lookup": "deny",
"wow-wiki-fetch": "deny",
"wow-event-info": "deny",
"wow-blizzard-source": "deny",
"wow-addon-lint": "deny"
```

Nye tools tilfojet til WoW MCP serveren ville IKKE vaere denied. Derudover er `"wow-api-dev": "deny"` (linje 114) et phantom-entry der ikke matcher noget faktisk tool.

**Kilde:** `opencode.jsonc` linje 114, 118-122

**Mulig fix:** Erstat med `"wow-*": "deny"` wildcard.

---

### 3.5 `coder` kan laese alle environment variables

**Risiko:** MEDIUM | **Type:** Permission-hul

`"env *": "allow"` (`opencode.jsonc` linje 264) tillader `env` kommandoen som lister ALLE environment variabler inklusiv:
- `SONARQUBE_TOKEN`
- `SERVICENOW_MCP_DEV_PASSWORD`
- `SERVICENOW_MCP_USERNAME`

Credential-pluginnet tjekker ikke bash output for credential-eksponering.

**Kilde:** `opencode.jsonc` linje 264

**Mulig fix:** Fjern `"env *": "allow"` eller begraens til `"env -i *": "deny"`.

---

### 3.6 `explore` agentens `git branch*` tillader sletning

**Risiko:** MEDIUM | **Type:** Permission-hul

`"git branch*": "allow"` (`opencode.jsonc` linje 401) matcher ogsaa:
- `git branch -d feature` (slet branch)
- `git branch -D feature` (force-slet branch)
- `git branch -m old new` (omdoeb branch)

`explore` er beskrevet som read-only.

**Kilde:** `opencode.jsonc` linje 401

**Mulig fix:** Begraens til `"git branch --list*": "allow"` og `"git branch -a*": "allow"`.

---

### 3.7 `code-reviewer` og `doc-writer` eksisterer kun i frontmatter

**Risiko:** MEDIUM | **Type:** Konfigurationsusikkerhed

Begge agenter mangler entries i `opencode.jsonc` og definerer permissions kun via frontmatter i deres `.md` filer. Adfaerden afhaenger af platformens merge-semantik:

| Scenarie | Resultat for doc-writer |
|----------|------------------------|
| Frontmatter overrider global | `write: allow`, `edit: allow` (fungerer) |
| Global overrider frontmatter | `write: deny`, `edit: deny` (broken - kan ikke skrive) |

**Kilde:** `agents/code-reviewer.md` linje 1-21, `agents/doc-writer.md` linje 1-13

---

### 3.8 Tredjepartspluggins paa `@latest`

**Risiko:** MEDIUM | **Type:** Supply chain

To plugins bruger `@latest` uden version-pinning:

```json
"@franlol/opencode-md-table-formatter@latest",
"@plannotator/opencode@latest"
```

Disse koerer i plugin-konteksten med fuld adgang til tool-interception og kunne potentielt override sikkerhedsplugins.

**Kilde:** `opencode.jsonc` linje 97-98

**Mulig fix:** Pin til specifikke versioner.

---

### 3.9 Produktions-plugin: Tool name namespace-usikkerhed

**Risiko:** MEDIUM | **Type:** Plugin-bypass

`sn-production-warning.ts` tjekker tool-navne som `record_create`, ikke `servicenow_record_create`. Hvis platformen sender MCP-prefixed navne til plugins, ville ingen entries i `WRITE_TOOLS` sette matche, og pluginnet ville aldrig blokere noget. Denne risiko afhaenger af platformens faktiske adfaerd ved tool name resolution.

**Kilde:** `sn-production-warning.ts` linje 144 vs tool name conventions

---

## 4. Lavt-risiko fund

### 4.1 `explore` agents `sed *` tillader fil-modifikation

**Risiko:** LAV | **Type:** Permission-hul

`explore` har IKKE `sed *` - dette gaelder kun `coder` og `code-simplifier`. `explore` har korrekt begraensede bash-permissions.

Rettet: Intet lavt-risiko permission-hul for `explore` ud over `git branch*` (daekket i 3.6).

---

## 5. Enforcement-oversigt

### Hvad ER haardt haandhaevet (korrekt)

| Regel | Agent | Enforcement |
|-------|-------|-------------|
| Build kan ikke redigere filer | `build` | `write: deny`, `edit: deny`, `read: deny` |
| Researcher kan ikke skrive filer | `researcher` | Ingen `write`/`edit` permission |
| Reviewer kan ikke modificere | `reviewer` | `edit: deny`, `write: deny` |
| Scribe kan ikke koere bash | `scribe` | `bash: { "*": deny }` |
| Coder kan ikke delegere | `coder` | `task: deny` (global default) |
| Explore kan ikke skrive filer | `explore` | `edit: deny`, `write: deny` |
| WoW-addon kan ikke skrive filer | `wow-addon` | `edit: deny`, `write: deny` |

### Hvad er KUN bloedt haandhaevet (saarbart)

| Regel | Agent | Prompt-kilde | Modsigende permission |
|-------|-------|-------------|----------------------|
| Load filosofi foer kode | `coder` | `coder.md` L12 | `write: allow` uden gate |
| Obligatorisk review efter implementation | `build` | `build.md` L44 | `task: allow` uden sekvens-gate |
| Skriv tests til ny funktionalitet | `coder` | `AGENTS.md` L40 | Modsagt af `coder.md` L85 |
| Aldrig force-push til main | `git` | `git.md` L48 | `git *: allow` |
| Skriv aldrig ServiceNow kode | `servicenow` | `servicenow.md` L228 | `servicenow_*: allow` |
| Introducer aldrig nye dependencies | `coder` | `AGENTS.md` L19 | `npm *`, `pip *`: allow |
| Hold funktioner under 100 linjer | alle | `AGENTS.md` L16 | Ingen enforcement |

---

## 6. Anbefalede prioriteringer

### Umiddelbart (hoej effekt, lav indsats)

1. **Credential-plugin**: Udvid til at intercepte `bash` tool og scanne for credential-moenstre
2. **Produktions-plugin**: Skift til fail-closed for ukendte URL-formater
3. **WoW tools**: Erstat individuelle deny-entries med `"wow-*": "deny"` wildcard
4. **git agent**: Tilfoej explicit deny for `"git push --force*"`, `"git reset --hard*"`, `"gh repo delete*"`
5. **explore agent**: Begraens `git branch*` til `git branch --list*`
6. **Version-pin**: Pin tredjepartspluggins til specifikke versioner

### Mellem-sigt (kraever design-beslutning)

7. **Filosofi-gate plugin**: Byg plugin der kraever `skill` tool-kald foer `write`/`edit`
8. **Review-gate**: Overvej plugin der tracker delegation-sekvenser og advarer hvis review springes over
9. **Bash-straemning**: Erstat brede moenstre (`node *`, `python *`) med specifikke subkommandoer
10. **researcher**: Fjern eller begraens `gh api *` til read-only
11. **code-reviewer**: Tilfoej filosofi-checkliste eller brug `reviewer` i den obligatoriske loop
12. **Slash commands**: Tilfoej review-step til `/sn-write` og `/wow-scaffold`

### Langsigtet (arkitekturel)

13. **Frontmatter vs config**: Konsolider alle agent-permissions i `opencode.jsonc` for konsistens
14. **Tool name namespacing**: Verificer og dokumenter om MCP tools sendes med eller uden namespace-prefix til plugins
15. **env-variabel beskyttelse**: Fjern `"env *": "allow"` fra coder eller tilfoej output-scanning
