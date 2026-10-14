import test from "node:test";
import assert from "node:assert/strict";
import { formatMoney, parseMoneyCents, parseReceipt, splitCents } from "../receipt.js";

const sampleReceipt = `A 4170 BOURSIN Vegan knoflook fijne kruid. 150g 2 3,35 6,70
Korting bon B103007 50% -3,35
A 4671 LIPTON Ice Tea Zero bruisend 33cl 8 0,822 6,58
A 10095 bereid gehakt varken+kalf 0,231kg 8,38 1,94
FOOD INC TOTAAL GOEDEREN TOT.LEEGGOED TE BETALEN
€ 12,00 € 15,22 € 0,00 € 11,87
Totale korting met Xtra: € 3,35
Totaal betaald € 11,87`;

test("leest geldbedragen met Nederlandse en internationale decimalen", () => {
  assert.equal(parseMoneyCents("3,75"), 375);
  assert.equal(parseMoneyCents("3.75"), 375);
  assert.equal(parseMoneyCents("1.234,56"), 123456);
  assert.equal(parseMoneyCents("1,234.56"), 123456);
  assert.equal(parseMoneyCents("0,822"), 82);
  assert.equal(formatMoney(-5), "−€ 0,05");
});

test("splitst centen zonder geld te verliezen", () => {
  const shares = splitCents(100, 3);
  assert.deepEqual(shares, [34, 33, 33]);
  assert.equal(shares.reduce((sum, value) => sum + value, 0), 100);
  assert.deepEqual(splitCents(1, 4), [1, 0, 0, 0]);
  assert.deepEqual(splitCents(99, 2), [50, 49]);
});

test("herkent producten, aparte korting, gewichten en bon-totalen", () => {
  const parsed = parseReceipt(sampleReceipt);
  assert.equal(parsed.items.length, 3);
  assert.equal(parsed.items[0].artikel, "4170");
  assert.equal(parsed.items[0].brutoCents, 670);
  assert.equal(parsed.items[0].kortingCents, 335);
  assert.equal(parsed.items[1].hoeveelheid, "8");
  assert.equal(parsed.items[1].brutoCents, 658);
  assert.equal(parsed.items[2].hoeveelheid, "0,231kg");
  assert.equal(parsed.items[2].brutoCents, 194);
  assert.equal(parsed.goederenCents, 1522);
  assert.equal(parsed.xtraKortingCents, 335);
  assert.equal(parsed.betaaldCents, 1187);

  const gross = parsed.items.reduce((sum, item) => sum + item.brutoCents, 0);
  const discounts = parsed.items.reduce((sum, item) => sum + item.kortingCents, 0);
  assert.equal(gross, parsed.goederenCents);
  assert.equal(gross - discounts, parsed.betaaldCents);
});
