# BoCharge Roadmap Notes

Product ideas that should be planned before implementation.

## Saved Chargers

- Add a way for users to save favorite or frequently visited charging stations.
- Likely needs a database-backed model instead of local-only browser storage if saves should persist across devices.
- Open decisions:
  - Account-based saves versus anonymous device-local saves.
  - Whether saved stations should support labels such as `Home`, `Office`, or `Weekend`.
  - How to handle station IDs changing across LTA feed refreshes.
  - Whether to store only station IDs or also snapshot metadata for stale/missing stations.

## Route-Aware Charger Selection

- Add a route planning flow where users enter a start point and destination, then BoCharge recommends charging points along or near that route.
- This should optimize for practical trip value, not just straight-line distance to the destination.
- Likely needs a routing provider or API that can return route geometry, drive time, and detour cost.
- Open decisions:
  - Which routing source to use for Singapore routes.
  - Whether recommendations optimize for shortest detour, charger availability, charging speed, provider preference, or a weighted score.
  - Whether users can set arrival battery or required charge duration.
  - How to handle stale availability while the user is already en route.
