---
name: wow-addon-dev
description: World of Warcraft addon development with LuaLS API annotations. Load when writing, reviewing, or debugging WoW addon Lua code. Provides accurate API signatures via wow-api-lookup tool.
---

# World of Warcraft Addon Development

## API Annotations

Local LuaLS annotations are available at `~/.local/share/wow-annotations/Annotations/` covering:

| Directory | Content |
|-----------|---------|
| `Core/Blizzard_APIDocumentationGenerated/` | 324 files - one per C_ namespace/API (e.g. C_LootHistory, C_Item) |
| `Core/Widget/` | Frame widgets: StatusBar, Button, Frame, Texture, Font, Animation |
| `Core/Type/` | Blizzard types, Enums, Events, Structures, Mixins |
| `Core/Data/` | Classic-specific data, CVars, Enums, Events |
| `Core/Libraries/` | Ace3, LibSharedMedia-3.0, LibDataBroker-1.1, LibDBIcon-1.0, LibStub |
| `Core/Lua/` | Lua 5.1 standard library |
| `Core/ScriptObject/` | Script object definitions |
| `FrameXML/Annotations/` | FrameXML annotations |

## When to Look Up APIs

**ALWAYS** use the `wow-api-lookup` tool before writing or reviewing code that calls:

- Any `C_*` namespace function (C_LootHistory, C_Item, C_Container, etc.)
- Widget methods (StatusBar:SetMinMaxValues, Frame:SetBackdrop, etc.)
- Global WoW API functions (GetLootSlotInfo, GetItemInfo, CreateFrame, etc.)
- Enums (Enum.ItemQuality, Enum.PowerType, etc.)
- Ace3 library methods when unsure of signatures

**DO NOT** guess at API signatures, parameter counts, return values, or enum values. The annotations are the source of truth.

## How to Use wow-api-lookup

The tool accepts two parameters:

- `query` (required) - API name, function, namespace, widget, or keyword
- `category` (optional) - Narrow search: "api", "widget", "type", "data", "library", "lua", "framexml", "all"

### Examples

| Goal | Query | Category |
|------|-------|----------|
| Check C_LootHistory functions | `C_LootHistory` | `api` |
| Get GetLootSlotInfo signature | `GetLootSlotInfo` | `api` |
| StatusBar widget methods | `StatusBar` | `widget` |
| Item quality enum values | `Enum.ItemQuality` | `type` |
| CreateFrame signature | `CreateFrame` | |
| Ace3 AceDB API | `AceDB` | `library` |
| String library functions | `string.find` | `lua` |

### Workflow

1. Before writing any WoW API call, look it up first
2. Check parameter types and order - they differ between Retail and Classic
3. Check return value count and types - many APIs return multiple values
4. When reviewing existing code, verify API usage matches annotations
5. Pay attention to `---@return` annotations with `?` (nullable returns)

## Version Differences

Many WoW APIs differ between Retail and Classic. Key things to check:

- **Return value count**: e.g. GetLootSlotInfo returns 10 values on Retail, 6 on Classic
- **Parameter availability**: some parameters only exist in Retail
- **API existence**: some C_ namespaces don't exist in Classic
- **Widget methods**: some widget methods were added in later expansions

When the annotations show version-specific behavior, always handle both paths with defensive nil checks or version guards.

## Annotation Format

The annotations use LuaLS format:

```lua
---@param paramName paramType Description
---@return returnType? optionalReturn
---@class ClassName
---@field fieldName fieldType
```

`?` after a type means nullable/optional. Multiple `---@return` lines indicate multiple return values.
