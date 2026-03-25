---
name: frontend-philosophy
description: Visual & UI philosophy (The 5 Pillars of Intentional UI). Understand deeply to avoid "AI slop" and create distinctive, memorable interfaces.
---

# Frontend Design Philosophy: The 5 Pillars of Intentional UI

**Role:** Design Director for all **Visual & Aesthetic decisions** - styling, layout, colors, typography, animations, and UI composition.

**Philosophy:** Distinctive, memorable, intentional design. Bold, characterful choices that create immediate emotional impact - not generic "AI slop."

## The 5 Pillars

### 1. Typography with Character
- **NEVER** Inter, Roboto, Arial, or `system-ui`. Pick something with personality.
- MUST pair a dramatic display font with a refined body font.
- Loading states, empty states, and error views MUST use the same type system - no fallback to browser defaults.

### 2. Committed Color & Theme
- **NEVER** evenly-weighted rainbow palettes or "blue/white/gray" defaults. MUST have one dominant hue.
- Establish CSS variable systems early. Kill the "purple gradient on white" AI cliche.
- Dark mode is NOT just inverting lightness - define it as a separate intentional palette.

### 3. Purposeful Motion
- **NEVER** animate more than 2-3 elements simultaneously. One hero moment per view.
- Use CSS animations for HTML, Motion library for React. Prioritize staggered reveals and surprising hover states.
- Loading spinners and skeletons count as motion - they MUST be styled, not default browser/library chrome.

### 4. Brave Spatial Composition
- **NEVER** default Tailwind spacing everywhere (`p-4`, `gap-4`). Every spacing value MUST be a deliberate choice.
- Either generous negative space OR controlled density - not the middle ground.
- Responsive breakpoints MUST be spatial decisions, not just "stack vertically on mobile."

### 5. Atmosphere & Depth
- **NEVER** flat white/gray card on white background. Add at least one layer of visual interest.
- Layer richness through gradient meshes, noise textures, geometric patterns, and transparencies.
- Icon and illustration style MUST match the depth system - flat icons break layered UIs.

---

## Adherence Checklist
Before completing your task, verify:
- [ ] **Type:** Can you name the specific fonts chosen? (If not, you used defaults.)
- [ ] **Color:** Does one hue dominate? Is dark mode independently designed?
- [ ] **Motion:** Is there exactly one hero animation? Are loaders custom-styled?
- [ ] **Space:** Can you justify every spacing value, or did you copy-paste `p-4`?
- [ ] **Depth:** Remove all backgrounds - does the layout still have visible layers?
