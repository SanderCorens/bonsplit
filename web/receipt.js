const PRODUCT_LINE_RE = /^\s*[AC]\s+(\d{3,6})\s+(.+?)\s+(\d+(?:[,.]\d+)?\s*kg|\d+)\s+(\d+[,.]\d{2,3})\s+(\d+[,.]\d{2})\s*$/i;
const LIDL_PRODUCT_LINE_RE = /^\s*(.+?)\s+(\d+\s*[,.]\s*\d{2})\s+[A-Z]\s*$/i;
const DELHAIZE_PRODUCT_LINE_RE = /^\s*(.+?)\s+(\d+\s*,\s*\d{2})\s*$/i;
const DISCOUNT_RE = /Korting\s+bon.*?(-\s*[\d.,]+)/i;
const LIDL_DISCOUNT_RE = /^Lidl\s+Plus\s+(-?\s*\d+\s*[,.]\s*\d{2})\s*$/i;
const DELHAIZE_DISCOUNT_RE = /^NUTRI-BOOST\s+10%\s+(-\s*\d+\s*,\s*\d{2})\s*$/i;
const PAYABLE_RE = /(?:Totaal betaald|Te betalen|Total:)\s+€?\s*([\d.,]+)/i;
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

export function aggregateGroupTotals(items, people) {
  const groups = new Map();
  items.forEach(({ selected, net }) => {
    const participants = people.filter((person) => selected.includes(person));
    if (!participants.length) return;
    const key = JSON.stringify(participants);
    const group = groups.get(key) ?? { participants, cents: 0 };
    group.cents += net;
    groups.set(key, group);
  });
  return [...groups.values()];
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

    const lidlProductMatch = line.match(LIDL_PRODUCT_LINE_RE);
    if (lidlProductMatch) {
      const [, product, bedrag] = lidlProductMatch;
      try {
        const cents = parseMoneyCents(bedrag.replace(/\s/g, ""));
        items.push({
          artikel: "",
          product: product.trim(),
          hoeveelheid: "1",
          eenheidsprijs: bedrag.replace(/\s/g, ""),
          brutoCents: cents,
          kortingCents: 0,
          personen: [],
        });
      } catch {
        ignoredNotes.push(`Bedrag niet herkend: ${line}`);
      }
      continue;
    }

    const delhaizeDiscountMatch = line.match(DELHAIZE_DISCOUNT_RE);
    if (delhaizeDiscountMatch && items.length) {
      const discountCents = Math.abs(parseMoneyCents(delhaizeDiscountMatch[1].replace(/\s/g, "")));
      const discountedItem = [...items].reverse().find((item) => (
        item.kortingCents === 0
        && Math.abs(Math.round(item.brutoCents * 0.1) - discountCents) <= 1
      ));
      if (discountedItem) discountedItem.kortingCents += discountCents;
      else ignoredNotes.push(`Korting niet gekoppeld: ${line}`);
      continue;
    }

    const delhaizeProductMatch = line.match(DELHAIZE_PRODUCT_LINE_RE);
    if (delhaizeProductMatch && !/^(?:TOTAAL|TERUG|KREDIETKAART)\b/i.test(line)) {
      const [, product, bedrag] = delhaizeProductMatch;
      try {
        const normalizedAmount = bedrag.replace(/\s/g, "");
        items.push({
          artikel: "",
          product: product.trim(),
          hoeveelheid: "1",
          eenheidsprijs: normalizedAmount,
          brutoCents: parseMoneyCents(normalizedAmount),
          kortingCents: 0,
          personen: [],
        });
      } catch {
        ignoredNotes.push(`Bedrag niet herkend: ${line}`);
      }
      continue;
    }

    const lidlDiscountMatch = line.match(LIDL_DISCOUNT_RE);
    if (lidlDiscountMatch && items.length) {
      try {
        items.at(-1).kortingCents += Math.abs(parseMoneyCents(lidlDiscountMatch[1].replace(/\s/g, "")));
      } catch {
        ignoredNotes.push(`Korting niet herkend: ${line}`);
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
  const delhaizeTotals = normalizedLines
    .map((line) => line.match(/^TOTAAL\s+([\d.,]+)$/i)?.[1])
    .filter(Boolean);
  if (delhaizeTotals.length >= 2) {
    try {
      goederenCents = parseMoneyCents(delhaizeTotals[0]);
    } catch {
      goederenCents = null;
    }
  }
  const goodsIndex = normalizedLines.findIndex((line) => GOODS_RE.test(line));
  if (goederenCents === null && goodsIndex >= 0) {
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
