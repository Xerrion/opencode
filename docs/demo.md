# Demo: Engineering med Opencode

**Titel**: Engineering med Opencode - Fra Vibes til Verificerbar Kvalitet  
**Målgruppe**: Tekniske kolleger / Ingeniører  
**Varighed**: 10-15 minutter  
**Format**: Præsentationsmanuskript / Talenoter  

---

## 1. Opening Hook (1 min)

Velkommen alle sammen. I dag vil jeg gennemgå, hvordan jeg er gået fra at "chatte med AI" til "engineering med agents."

Vi har alle set, hvad der sker, når man giver en rå LLM en kompleks kodebase. Den starter stærkt ud, men så begynder den at drive. Den glemmer dine arkitektoniske begrænsninger. Den springer kanttilfældene over. Den "hallucinerer" en utility-funktion, der ikke eksisterer, i stedet for at bruge den, som du brugte tre dage på at perfektionere.

Mit mål med dette setup, bygget på `opencode`, var at løse netop det. Jeg ønskede at bevæge mig væk fra AI som en højhastigheds-autocomplete og mod AI som en struktureret, specialiseret arbejdsstyrke. Mit setup påtvinger tre ting, som rå LLM mangler: orchestration, specialisering og håndhævet filosofi.

> 🎬 LIVE-DEMO: Åbn `/Users/lasn/.config/opencode` mappen i din IDE. Vis hurtigt mapperne `agents/`, `skills/` og `command/` for at give publikum en fornemmelse af "maskineriet" bag kulisserne.

---

## 2. De tre søjler (2 min)

For at forstå, hvordan det fungerer, skal man se på det gennem tre søjler:

- **Orchestration**: Jeg har en primær `build` agent. Det er koordinatoren. Det er den eneste agent, jeg taler direkte med vedrørende implementering, og her er pointen - den har forbud mod at redigere filer. Den delegerer kun.
- **Specialisering**: Jeg har opdelt rollerne i et softwareteam i diskrete subagents. Hver har et afgrænset sæt værktøjer. Min `debugger` kan ikke skrive kode. Min `scribe` kan ikke køre bash-kommandoer. Min `git` agent kan ikke røre produktionsfiler.
- **Filosofi som kode**: Dette er den mest kritiske del. Jeg "prompter" ikke bare agenterne til at være gode. Jeg har kodificeret mine engineering-standarder i "Skills" - markdown-filer, der definerer systemets love. Hvis en filosofi ikke er indlæst, har agenten ikke tilladelse til at røre koden.

---

## 3. Orchestration: Build-agenten (3 min)

Lad os se på min `build` agent. Som jeg nævnte, er dens primære begrænsning, at den ikke kan redigere filer. Det kan virke som en flaskehals, men det er faktisk hemmeligheden bag dens pålidelighed.

Fordi den ikke "bare kan fikse det" selv, er den tvunget til at være en projektleder i verdensklasse. Den vedligeholder en delegationsmatrix. Hvis jeg beder om en feature, router den arbejdet gennem en liste:

- `explore` til indsamling af kontekst.
- `coder` til selve implementeringen.
- `reviewer` til et obligatorisk sikkerhedstjek.

Et af de mest kraftfulde mønstre, jeg har indbygget, er **Mandatory Review Loop**. Hver gang `coder` ændrer en fil, er `build` agenten hard-kodet til at aktivere `reviewer`. Revieweren returnerer en af tre domme: APPROVE, REQUEST_CHANGES eller NEEDS_DISCUSSION. Ved REQUEST_CHANGES ryger de pågældende BLOCKERs direkte tilbage til min coder, ordret. NEEDS_DISCUSSION eskalerer til mig. Vi begrænser dette til tre cyklusser før hård eskalering - ingen uendelige loops.

> 🎬 LIVE-DEMO: Giv min `build` agent en lille anmodning, som f.eks. "Tilføj en utility-funktion til at formatere datoer i en ny fil." Se den straks delegere til `explore` for at tjekke for eksisterende dato-utilities, og derefter til `coder`. Påpeg, at min `build` agent ikke skriver koden - den leder specialisten.

---

## 4. Specialisering: Agent-listen (2 min)

Bag min `build` agent står en liste af 10 subagent-specialister, som er en del af et system med 13 agenter (3 primære orchestrators, 10 subagents).

Vi har de generalister, man kunne forvente: `coder`, `tester`, `debugger` og `scribe`. Men jeg har også dybe domæneeksperter.

For eksempel er min `wow-addon` agent en research-specialist. Den har fem custom værktøjer, jeg har bygget i TypeScript - som `wow-api-lookup` og `wow-blizzard-source` - der giver den mulighed for at forespørge direkte i World of Warcraft API'en og kildekoden. Den skriver ikke Lua; den finder fakta og overleverer dem til min `coder`.

På ServiceNow-siden har jeg en dedikeret `servicenow` agent med adgang til dusinvis af platformsværktøjer via min `servicenow` MCP server.

Jeg har også mappet gængse workflows til **Slash Commands**. Jeg har 12 kommandoer grupperet i tre familier: Plannotator review UIs (/plannotator-*), ServiceNow workflows (/sn-debug, /sn-health, /sn-logic-map, /sn-review, /sn-updateset, /sn-write), WoW addon workflows (/wow-review, /wow-scaffold), plus en universel /review. I stedet for at forklare en proces hver gang, kører jeg bare `/sn-debug` eller `/wow-scaffold`.

---

## 5. Filosofi som kode: Skills-systemet (3 min)

Det er her, vi bevæger os fra "vibes" til "verificerbar kvalitet."

Jeg har en regel i min `AGENTS.md` fil: **"Load Before You Touch Code. No load, no code."** (Indlæs før du rører kode. Ingen indlæsning, ingen kode).

Jeg har defineret 17 forskellige "Skills." Tre af dem er mine kernefilosofier:

- **Code: The 5 Laws of Elegant Defense** (Early Exit, Parse Don't Validate, Atomic Predictability, Fail Fast, Intentional Naming).
- **Frontend: The 5 Pillars of Intentional UI** (Typography, Color, Motion, Composition, Atmosphere).
- **Architecture: The 5 Laws of Intentional Architecture** (Follow the Grain, Layer Direction, Caller-Designed API, Single State Owner, Explicit Failures).

> ⏱ Tempo: Nævn de 5 Code-love højt, gestikuler mod Frontend og Architecture.

De øvrige 14 skills er operationelle: `code-review` metodologi, `plan` protokoller, `mcp-builder` guides, plus domænepakker til ServiceNow (6 skills) og WoW addon udvikling (4 skills).

Når en agent starter en opgave, skal den indlæse den relevante skill. Men det er ikke nok bare at "læse" den. Mine agenter følger en **"Name What You Checked"** (Navngiv hvad du har tjekket) regel. Før de markerer en opgave som udført, skal de eksplicit liste, hvilke love de har overholdt.

Dette skaber et papirspor. Hvis der kommer en PR, ser jeg ikke bare kode; jeg ser en erklæring fra agenten, der hævder, at den har fulgt "Early Exit" og "Atomic Predictability." Det gør AI'ens logik gennemsigtig og auditérbar.

> 🎬 LIVE-DEMO: Åbn `skills/code-philosophy/SKILL.md`. Vis de "5 Love." Vis derefter et tidligere agent-output (eller en commit-besked), hvor agenten eksplicit har listet: "Satisfied: Early Exit, Intentional Naming."

---

## 6. Hvordan det hele flyder (2 min)

Lad os spore en forespørgsel på en feature fra den virkelige verden. Lad os sige, jeg vil tilføje en ny UI-komponent.

1. Jeg spørger min **build** agent.
2. Min `build` agent delegerer til **explore** for at se, hvor komponenten skal bo, og hvilke eksisterende styles den skal følge.
3. Min `build` agent instruerer derefter **coder** i at implementere den. Den siger til min `coder`: "Load `code-philosophy` og `frontend-philosophy`."
4. Min `coder` skriver koden og returnerer en liste over de love, den har overholdt (f.eks. "Motion" og "Composition").
5. Min `build` agent delegerer straks til **reviewer**. Min `reviewer` indlæser min `code-review` skill og tjekker arbejdet.
6. Hvis min `reviewer` ser en overtrædelse af "Layer Direction," markerer den det som en `BLOCKER`.
7. Min `build` agent sender den feedback ordret tilbage til min `coder`.
8. Når det er godkendt, håndterer min **git** agent committet ved hjælp af konventionelle formater, og min **scribe** agent opdaterer README-filen for at dokumentere den nye komponent.

Dette er ikke bare en engangs-prompt; det er et samlebånd.

---

## 7. Hvad dette muliggør (1 min)

Ved at bygge dette stillads har jeg opnået fire store ting:

- **Konsistens**: Mine standarder håndhæves af systemet, ikke af mit humør eller hvor træt jeg er under en kodningssession klokken 2 om natten.
- **Auditérbarhed**: Hver ændring har en navngivet review-dom og en liste over principper, den hævder at følge.
- **Sikkerhed**: Afgrænset adgang til værktøjer betyder, at agenter fysisk ikke kan gøre ting, de ikke er beregnet til. Min `debugger` kan bogstaveligt talt ikke patche en bug - den kan kun rapportere om den.
- **Composability**: Fordi alt er modulært - agenterne, mine skills, mine MCP servere - kan jeg udskifte en model eller tilføje en ny domænespecialist (som mine WoW- eller ServiceNow-agenter) uden at genopbygge hele systemet.

---

## 8. Afslutning (30 sek)

Den vigtigste pointe, jeg vil efterlade jer med, er denne: Gevinsten ved AI ligger ikke kun i den model, man bruger. Gevinsten ligger i det stillads, man bygger omkring den.

Ved at behandle "instruktioner" som kode og "orchestration" som en hård begrænsning, har jeg forvandlet en stokastisk tekstgenerator til en pålidelig engineering-partner.

Tak for jeres tid. Jeg svarer gerne på spørgsmål eller går dybere ned i agenterne eller mine skills.
