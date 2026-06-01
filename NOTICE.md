# Notices

This repository contains the source code for BoCharge. The MIT license applies to the code in this repository, except where a file says otherwise.

## Public Data Sources

BoCharge uses LTA DataMall's EV Charging Points Batch API for production charger data. LTA describes the endpoint as returning all Singapore electric vehicle charging points and their availabilities in a single file.

Use of LTA API datasets is governed by the Singapore Open Data Licence and LTA's API Terms of Service. Production operators are responsible for keeping their own `LTA_ACCOUNT_KEY` secure and complying with the current LTA terms.

BoCharge uses PLANMalaysia MEVnet's public ArcGIS FeatureServer for Malaysia charger-location data. MEVnet describes its records as public existing and proposed charging bay locations for monitoring, planning, and public information; it does not provide real-time availability or tariff fields.

Production operators are responsible for checking current PLANMalaysia/MEVnet terms before redistributing derived Malaysia data outside this app.

OneMap place search is optional. If enabled, operators are responsible for complying with OneMap API terms and keeping OneMap credentials server-side.

## Maps

The map view uses OpenStreetMap tiles through Leaflet. Keep the visible OpenStreetMap attribution in the map UI.

## Provider Names, Logos, And App Store IDs

Charging provider names, app names, logos, app-store identifiers, and trademarks remain the property of their respective owners. Their inclusion is for user navigation and attribution inside the EV charger map and does not imply endorsement.

Logo source references, where known, are recorded in `src/data/providerApps.js`.

## Generated Data

`public/data/sample-chargers.json` is a checked-in sample fallback for local development and no-key demos. Refreshing it requires an LTA DataMall account key:

```bash
npm run data:refresh
```

Before publishing new generated samples, confirm the current source-data terms still permit your intended use.
