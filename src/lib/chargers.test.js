import assert from "node:assert/strict";
import test from "node:test";
import { compareComparableStationTariffs, getComparableStationTariff, getStationPriceKwh } from "./chargers.js";

function stationWithPlugs(plugTypes, overrides = {}) {
  return {
    priceCurrency: "SGD",
    plugTypes,
    ...overrides,
  };
}

const mixedStation = stationWithPlugs([
  { plugType: "Type 2", chargingSpeed: "22", price: "0.55", priceType: "kWh" },
  { plugType: "Combo 2", chargingSpeed: "50", price: "0.78", priceType: "kWh" },
  { plugType: "Combo 2", chargingSpeed: "100", price: "0.82", priceType: "kWh" },
]);

test("selects the cheapest station tariff and marks a multi-rate starting price", () => {
  const tariff = getComparableStationTariff(mixedStation);

  assert.equal(tariff.price, 0.55);
  assert.equal(tariff.connectorType, "Type 2");
  assert.equal(tariff.powerKw, 22);
  assert.equal(tariff.isStartingPrice, true);
  assert.equal(getStationPriceKwh(mixedStation), 0.55);
});

test("matches the active connector filter before comparing prices", () => {
  const tariff = getComparableStationTariff(mixedStation, { connectorTypeIds: ["connector:combo 2"] });

  assert.equal(tariff.price, 0.78);
  assert.equal(tariff.connectorType, "Combo 2");
  assert.equal(tariff.powerKw, 50);
  assert.equal(tariff.isStartingPrice, false);
});

test("matches the fast threshold before comparing prices", () => {
  const tariff = getComparableStationTariff(mixedStation, { fastOnly: true });

  assert.equal(tariff.price, 0.78);
  assert.equal(tariff.connectorType, "Combo 2");
});

test("returns null when matching plugs have no per-kWh tariff", () => {
  const station = stationWithPlugs([
    { plugType: "Type 2", chargingSpeed: "22", price: "0.55", priceType: "kWh" },
    { plugType: "CHAdeMO", chargingSpeed: "50", price: "", priceType: "" },
  ]);

  assert.equal(getComparableStationTariff(station, { connectorTypeIds: ["connector:chademo"] }), null);
});

test("treats an unexplained zero tariff as unknown", () => {
  const station = stationWithPlugs([{ plugType: "Type 2", chargingSpeed: "7.4", price: "0", priceType: "kWh" }]);

  assert.equal(getComparableStationTariff(station), null);
  assert.equal(getStationPriceKwh(station), null);
});

test("keeps an explicitly free tariff as a known zero price", () => {
  const station = stationWithPlugs([
    { plugType: "Type 2", chargingSpeed: "7.4", price: "0", priceType: "kWh", isFree: true },
  ]);

  assert.equal(getComparableStationTariff(station)?.price, 0);
  assert.equal(getStationPriceKwh(station), 0);
});

test("compares only tariffs attached to available charging points", () => {
  const station = stationWithPlugs(
    [
      { plugType: "Type 2", chargingSpeed: "22", price: "0", priceType: "kWh" },
      { plugType: "Type 2", chargingSpeed: "22", price: "0.72", priceType: "kWh" },
    ],
    {
      chargers: [
        {
          status: "occupied",
          plugTypes: [{ plugType: "Type 2", chargingSpeed: "22", price: "0", priceType: "kWh" }],
        },
        {
          status: "available",
          plugTypes: [{ plugType: "Type 2", chargingSpeed: "22", price: "0.72", priceType: "kWh" }],
        },
      ],
    },
  );

  assert.equal(getComparableStationTariff(station)?.price, 0.72);
});

test("ignores unavailable plug types within a mixed-status charging point", () => {
  const station = stationWithPlugs([], {
    chargers: [
      {
        status: "available",
        plugTypes: [
          {
            plugType: "Type 2",
            chargingSpeed: "22",
            price: "0.40",
            priceType: "kWh",
            connectors: [{ status: "occupied" }],
          },
          {
            plugType: "Combo 2",
            chargingSpeed: "50",
            price: "0.70",
            priceType: "kWh",
            connectors: [{ status: "available" }],
          },
        ],
      },
    ],
  });

  assert.equal(getComparableStationTariff(station)?.price, 0.7);
});

test("prefers the faster plug when matching tariffs are equal", () => {
  const tariff = getComparableStationTariff(
    stationWithPlugs([
      { plugType: "Combo 2", chargingSpeed: "50", price: "0.78", priceType: "kWh" },
      { plugType: "Combo 2", chargingSpeed: "100", price: "0.78", priceType: "kWh" },
    ]),
  );

  assert.equal(tariff.powerKw, 100);
});

test("sorts known tariffs by price and places unknown tariffs last", () => {
  const cheap = { price: 0.5 };
  const expensive = { price: 0.8 };

  assert.ok(compareComparableStationTariffs(cheap, expensive) < 0);
  assert.ok(compareComparableStationTariffs(expensive, cheap) > 0);
  assert.ok(compareComparableStationTariffs(cheap, null) < 0);
  assert.ok(compareComparableStationTariffs(null, cheap) > 0);
  assert.equal(compareComparableStationTariffs(null, null), 0);
  assert.equal(compareComparableStationTariffs(cheap, { price: 0.5 }), 0);
});
