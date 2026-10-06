# Vendored from Claw3D

Source: https://github.com/iamlukethedev/claw3d (MIT License — see `LICENSE`), commit in `UPSTREAM_COMMIT`.

| File | Upstream | RackIQ changes |
|---|---|---|
| `AgentModel.tsx` | `src/features/retro-office/objects/agents.tsx` | relative imports; explicit scene font (`font.ts`); tracking tablet, carried part box, repair/scan arm animation, safety-helmet hat style |
| `avatarProfile.ts` | `src/lib/avatars/profile.ts` | none |
| `constants.ts`, `geometry.ts`, `types.ts` | `core/constants.ts`, `core/geometry.ts`, `core/types.ts`, `objects/types.ts` | trimmed subsets; `toCanvas` inverse helper; crew fields |

The data-hall rack renderer (`src/live/DataHall.jsx`) is adapted from Claw3D's `ServerRackModel`
(`objects/machines.tsx`) into an instanced renderer for 100 racks × 8 servers.
