# Privacy

BoCharge is designed to avoid collecting personal data by default.

## Location

The browser may ask for location permission when a user taps the location control. Location is used in the browser to sort nearby charging stations and is not intentionally stored by the app server.

## Analytics

Google Analytics is optional. If `GA_MEASUREMENT_ID` or `VITE_GA_MEASUREMENT_ID` is not configured, the Google Analytics script is not loaded.

When analytics is enabled, page-view events are sent to Google Analytics for the map and data pages. Do not add event tracking that sends precise user location, API keys, or other sensitive data.

## Server Logs

The Express server logs startup and backend refresh failures. It should not log `LTA_ACCOUNT_KEY`, OneMap credentials, precise user location, or raw request credentials.

## Third Parties

BoCharge can call these third-party services depending on configuration and user interaction:

- LTA DataMall for EV charger data.
- OneMap for server-side place search.
- OpenStreetMap tile servers for map tiles.
- Google Analytics when analytics is configured.
