const PRODUCT_LINE_RE = /^\s*[AC]\s+(\d{3,6})\s+(.+?)\s+(\d+(?:[,.]\d+)?\s*kg|\d+)\s+(\d+[,.]\d{2,3})\s+(\d+[,.]\d{2})\s*$/i;
const DISCOUNT_RE = /Korting\s+bon.*?(-\s*[\d.,]+)/i;
const PAYABLE_RE = /Totaal betaald\s+€?\s*([\d.,]+)/i;
const XTRA_DISCOUNT_RE = /Totale korting met Xtra\s*:\s*€?\s*([\d.,]+)/i;
const GOODS_RE = /TOTAAL\s+GOEDEREN/i;

function normalizeNumber(value) {
  let text = String(value ?? "").trim().replace(/\s|€/g, "");
  if (!text || !/[\d]/.test(text)) throw new Error("Vul een geldig bedrag in.");
  const sign = text.startsWith("-") ? -1 : 1;
  text = text.replace(/^[+-]/, "");
  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  let decimalMark = "";
  if (comma >= 0 && dot >= 0) decimalMark = comma > dot ? "," : ".";
  else if (comma >= 0) decimalMark = ",";
  else if (dot >= 0) decimalMark = ".";

  if (!decimalMark) return { sign, whole: text.replace(/\D/g, "") || "0", fraction: "" };
  const splitAt = text.lastIndexOf(decimalMark);
  const whole = text.slice(0, splitAt).replace(/\D/g, "") || "0";
  const fraction = text.slice(splitAt + 1).replace(/\D/g, "");
  return { sign, whole, fraction };
}

export function parseMoneyCents(value) {
  const { sign, whole, fraction } = normalizeNumber(value);
  const centsText = (fraction + "00").slice(0, 2);
  let cents = BigInt(whole) * 100n + BigInt(centsText || "0");
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1n;
  const signed = cents * BigInt(sign);
  const result = Number(signed);
  if (!Number.isSafeInteger(result)) throw new Error("Het bedrag is te groot.");
  return result;
}

export function formatMoney(cents) {
  const sign = cents < 0 ? "−" : "";
  const absolute = Math.abs(cents);
  const euros = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${sign}€ ${euros},${remainder}`;
}

export function splitCents(totalCents, peopleCount) {
  if (!Number.isInteger(peopleCount) || peopleCount < 1) return [];
  const sign = Math.sign(totalCents);
  const absolute = Math.abs(totalCents);
  const base = Math.floor(absolute / peopleCount);
  const remainder = absolute % peopleCount;
  return Array.from({ length: peopleCount }, (_, index) => sign * (base + (index < remainder ? 1 : 0)));
}

function extractTotal(text, pattern) {
  const match = text.match(pattern);
  if (!match) return null;
  try {
    return parseMoneyCents(match[1]);
  } catch {
    return null;
  }
}

export function parseReceipt(text) {
  const lines = String(text).split(/\r?\n/);
  const items = [];
  const ignoredNotes = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    const match = line.match(PRODUCT_LINE_RE);
    if (match) {
      const [, artikel, product, hoeveelheid, eenheidsprijs, bedrag] = match;
      try {
        items.push({
          artikel,
          product: product.trim(),
          hoeveelheid: hoeveelheid.replace(/\s/g, ""),
          eenheidsprijs,
          brutoCents: parseMoneyCents(bedrag),
          kortingCents: 0,
          personen: [],
        });
      } catch {
        ignoredNotes.push(`Bedrag niet herkend: ${line}`);
      }
      continue;
    }

    const discountMatch = line.match(DISCOUNT_RE);
    if (discountMatch && items.length) {
      try {
        items.at(-1).kortingCents += Math.abs(parseMoneyCents(discountMatch[1].replace(/\s/g, "")));
      } catch {
        ignoredNotes.push(`Korting niet herkend: ${line}`);
      }
    } else if (/Hoeveelheidsvoordeel|korting met Xtra/i.test(line)) {
      ignoredNotes.push(line);
    }
  }

  let goederenCents = null;
  const normalizedLines = lines.map((line) => line.replace(/\s+/g, " ").trim());
  const goodsIndex = normalizedLines.findIndex((line) => GOODS_RE.test(line));
  if (goodsIndex >= 0) {
    for (const totalLine of normalizedLines.slice(goodsIndex + 1, goodsIndex + 3)) {
      const euroAmounts = [...totalLine.matchAll(/€\s*([\d.,]+)/g)];
      if (euroAmounts.length >= 2) {
        try {
          goederenCents = parseMoneyCents(euroAmounts[1][1]);
        } catch {
          goederenCents = null;
        }
        break;
      }
    }
  }

  return {
    items,
    goederenCents,
    betaaldCents: extractTotal(text, PAYABLE_RE),
    xtraKortingCents: extractTotal(text, XTRA_DISCOUNT_RE),
    ignoredNotes,
  };
}
