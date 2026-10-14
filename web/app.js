import * as pdfjsLib from "./vendor/pdfjs/pdf.mjs";
import { formatMoney, parseMoneyCents, parseReceipt, splitCents } from "./receipt.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdfjs/pdf.worker.mjs", import.meta.url).href;

const byId = (id) => document.getElementById(id);
const state = {
  people: ["Sander", "Arwen"],
  items: [],
  receiptText: "",
  method: "",
  goodsCents: null,
  payableCents: null,
  xtraDiscountCents: null,
  recognized: false,
  tesseractWorker: null,
};

const elements = {
  launchWarning: byId("launch-warning"),
  file: byId("receipt-file"),
  dropzone: byId("dropzone"),
  selectedFile: byId("selected-file"),
  status: byId("processing-status"),
  statusMessage: byId("status-message"),
  statusPercent: byId("status-percent"),
  progress: byId("progress-bar"),
  results: byId("results"),
  welcome: byId("welcome-card"),
  method: byId("receipt-method"),
  goodsTotal: byId("goods-total"),
  discountTotal: byId("discount-total"),
  payableTotal: byId("payable-total"),
  reconciliation: byId("reconciliation"),
  peopleList: byId("people-list"),
  personInput: byId("person-name"),
  addPersonForm: byId("add-person-form"),
  headers: byId("product-headers"),
  rows: byId("product-rows"),
  productCount: byId("product-count"),
  emptyProducts: byId("empty-products"),
  addProduct: byId("add-product"),
  totals: byId("person-totals"),
  unassignedCount: byId("unassigned-count"),
  unassignedWarning: byId("unassigned-warning"),
  exportCsv: byId("export-csv"),
  clearReceipt: byId("clear-receipt"),
  recognizedText: byId("recognized-text"),
};

elements.launchWarning.hidden = window.location.protocol !== "file:";

function setStatus(message, percent = null) {
  elements.status.hidden = false;
  elements.statusMessage.textContent = message;
  if (percent === null) {
    elements.statusPercent.textContent = "";
    elements.progress.style.width = "35%";
  } else {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    elements.statusPercent.textContent = `${value}%`;
    elements.progress.style.width = `${value}%`;
  }
}

function finishStatus(message) {
  elements.statusMessage.textContent = message;
  elements.statusPercent.textContent = "100%";
  elements.progress.style.width = "100%";
  window.setTimeout(() => { elements.status.hidden = true; }, 1500);
}

function escapeCsv(value) {
  let text = String(value ?? "");
  if (/^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function centsForInput(value) {
  return parseMoneyCents(value);
}

function getItemAmounts(item) {
  const gross = centsForInput(item.bruto);
  const discount = centsForInput(item.korting);
  if (gross < 0 || discount < 0) throw new Error("Prijs en korting mogen niet negatief zijn.");
  if (discount > gross) throw new Error("Korting kan niet groter zijn dan de bruto prijs.");
  return { gross, discount, net: gross - discount };
}

function currentTotals() {
  const totals = Object.fromEntries(state.people.map((person) => [person, 0]));
  const invalid = [];
  const unassigned = [];
  const normalized = [];

  state.items.forEach((item, index) => {
    try {
      const amounts = getItemAmounts(item);
      const selected = item.personen.filter((person) => Object.prototype.hasOwnProperty.call(totals, person));
      const shares = splitCents(amounts.net, selected.length);
      selected.forEach((person, shareIndex) => { totals[person] += shares[shareIndex]; });
      if (!selected.length) unassigned.push(item.product || `Regel ${index + 1}`);
      normalized.push({ item, ...amounts, selected, shares });
    } catch (error) {
      invalid.push({ item, index, message: error.message });
    }
  });
  return { totals, invalid, unassigned, normalized };
}

function makeInput(value, field, label, className = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  input.dataset.field = field;
  input.setAttribute("aria-label", label);
  if (className) input.className = className;
  if (field === "bruto" || field === "korting") {
    input.inputMode = "decimal";
    input.autocomplete = "off";
  }
  return input;
}

function renderPeople() {
  elements.peopleList.replaceChildren();
  state.people.forEach((person, index) => {
    const chip = document.createElement("span");
    chip.className = "person-chip";
    const name = document.createElement("span");
    name.textContent = person;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-person";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Verwijder ${person}`);
    remove.addEventListener("click", () => {
      state.people.splice(index, 1);
      state.items.forEach((item) => { item.personen = item.personen.filter((selected) => selected !== person); });
      render();
    });
    chip.append(name, remove);
    elements.peopleList.append(chip);
  });
}

function renderTable() {
  elements.headers.replaceChildren();
  elements.rows.replaceChildren();
  const headerRow = document.createElement("tr");
  const headers = ["Product", "Aantal/gewicht", "Eenheidsprijs", "Bruto €", "Korting €", "Netto"];
  headers.forEach((title) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = title;
    headerRow.append(th);
  });
  state.people.forEach((person) => {
    const th = document.createElement("th");
    th.scope = "col";
    th.className = "person-header";
    th.textContent = person;
    headerRow.append(th);
  });
  const deleteHeader = document.createElement("th");
  deleteHeader.scope = "col";
  deleteHeader.textContent = "";
  headerRow.append(deleteHeader);
  elements.headers.append(headerRow);

  state.items.forEach((item, index) => {
    const row = document.createElement("tr");
    row.dataset.index = String(index);
    const productCell = document.createElement("td");
    productCell.className = "product-cell";
    productCell.append(makeInput(item.product, "product", "Productnaam"));
    row.append(productCell);

    const quantityCell = document.createElement("td");
    quantityCell.className = "quantity-cell";
    quantityCell.dataset.label = "Aantal / gewicht";
    quantityCell.append(makeInput(item.hoeveelheid, "hoeveelheid", "Aantal of gewicht"));
    row.append(quantityCell);

    const unitPriceCell = document.createElement("td");
    unitPriceCell.className = "unit-price-cell";
    unitPriceCell.dataset.label = "Eenheidsprijs";
    unitPriceCell.append(makeInput(item.eenheidsprijs, "eenheidsprijs", `Eenheidsprijs voor ${item.product || "product"}`));
    row.append(unitPriceCell);

    const grossCell = document.createElement("td");
    grossCell.className = "gross-cell";
    grossCell.dataset.label = "Bruto €";
    grossCell.append(makeInput(item.bruto, "bruto", `Bruto prijs voor ${item.product || "product"}`));
    row.append(grossCell);

    const discountCell = document.createElement("td");
    discountCell.className = "discount-cell";
    discountCell.dataset.label = "Korting €";
    discountCell.append(makeInput(item.korting, "korting", `Korting voor ${item.product || "product"}`));
    row.append(discountCell);

    const netCell = document.createElement("td");
    netCell.className = "net-cell";
    netCell.dataset.label = "Netto";
    netCell.dataset.net = "";
    row.append(netCell);

    const cardSpacer = document.createElement("td");
    cardSpacer.className = "card-spacer";
    row.append(cardSpacer);

    state.people.forEach((person) => {
      const cell = document.createElement("td");
      cell.className = "checkbox-cell person-cell";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = item.personen.includes(person);
      checkbox.dataset.person = person;
      checkbox.setAttribute("aria-label", `${person} betaalt mee voor ${item.product || "dit product"}`);
      const toggle = document.createElement("label");
      toggle.className = "person-toggle";
      if (checkbox.checked) toggle.classList.add("is-selected");
      const name = document.createElement("span");
      name.textContent = person;
      toggle.append(checkbox, name);
      cell.append(toggle);
      row.append(cell);
    });

    const deleteCell = document.createElement("td");
    deleteCell.className = "delete-cell";
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-row";
    deleteButton.textContent = "×";
    deleteButton.setAttribute("aria-label", `Verwijder ${item.product || `regel ${index + 1}`}`);
    deleteButton.addEventListener("click", () => {
      state.items.splice(index, 1);
      render();
    });
    deleteCell.append(deleteButton);
    row.append(deleteCell);
    elements.rows.append(row);
  });

  elements.productCount.textContent = String(state.items.length);
  elements.emptyProducts.hidden = state.items.length > 0;
  updateTotals();
}

function updateReconciliation(totalNet, totalGross, totalDiscount) {
  const messages = [];
  let kind = "ok";
  if (state.goodsCents !== null) {
    const delta = totalGross - state.goodsCents;
    if (delta === 0) messages.push(`Brutosom van de productregels sluit aan op goederenbedrag (${formatMoney(state.goodsCents)}).`);
    else {
      messages.push(`Brutosom van productregels wijkt ${formatMoney(delta)} af van goederenbedrag ${formatMoney(state.goodsCents)}.`);
      kind = "warn";
    }
  }
  if (state.xtraDiscountCents !== null && totalDiscount !== state.xtraDiscountCents) {
    messages.push(`Ingevoerde expliciete kortingen (${formatMoney(totalDiscount)}) wijken af van de vermelde Xtra-korting (${formatMoney(state.xtraDiscountCents)}).`);
    kind = "warn";
  }
  if (state.payableCents !== null) {
    const delta = totalNet - state.payableCents;
    if (delta === 0) messages.push(`Nettosom sluit aan op betaald bedrag (${formatMoney(state.payableCents)}).`);
    else {
      messages.push(`Nettosom wijkt ${formatMoney(delta)} af van het betaalde bedrag ${formatMoney(state.payableCents)}. Controleer kortingen en ontbrekende regels.`);
      kind = "warn";
    }
  }
  if (!messages.length) messages.push("Bonbedragen niet volledig herkend. Controleer de regels en totalen handmatig.");
  elements.reconciliation.className = `reconciliation ${kind}`;
  elements.reconciliation.textContent = messages.join(" ");
}

function updateTotals() {
  const { totals, invalid, unassigned, normalized } = currentTotals();
  const grossTotal = normalized.reduce((sum, row) => sum + row.gross, 0);
  const discountTotal = normalized.reduce((sum, row) => sum + row.discount, 0);
  const netTotal = normalized.reduce((sum, row) => sum + row.net, 0);
  const invalidGrossDiscount = invalid.reduce((sum, entry) => {
    try { return sum + parseMoneyCents(entry.item.bruto); } catch { return sum; }
  }, 0);

  elements.goodsTotal.textContent = state.goodsCents === null ? formatMoney(grossTotal + invalidGrossDiscount) : formatMoney(state.goodsCents);
  elements.discountTotal.textContent = formatMoney(discountTotal);
  elements.payableTotal.textContent = state.payableCents === null ? formatMoney(netTotal) : formatMoney(state.payableCents);
  elements.totals.replaceChildren();
  state.people.forEach((person) => {
    const card = document.createElement("article");
    card.className = "person-total-card";
    const label = document.createElement("span");
    label.textContent = person;
    const amount = document.createElement("strong");
    amount.textContent = formatMoney(totals[person]);
    card.append(label, amount);
    elements.totals.append(card);
  });

  elements.unassignedCount.textContent = unassigned.length ? `${unassigned.length} niet toegewezen` : "Alle geldige regels toegewezen";
  elements.unassignedWarning.hidden = unassigned.length === 0 && invalid.length === 0;
  const warnings = [];
  if (unassigned.length) warnings.push(`Nog niet toegewezen: ${unassigned.join(", ")}.`);
  if (invalid.length) warnings.push(`Controleer prijs/korting bij: ${invalid.map(({ item }) => item.product || "naamloze regel").join(", ")}.`);
  elements.unassignedWarning.textContent = warnings.join(" ");
  elements.exportCsv.disabled = state.items.length === 0 || invalid.length > 0;

  elements.rows.querySelectorAll("tr").forEach((row) => {
    const index = Number(row.dataset.index);
    const netCell = row.querySelector("[data-net]");
    const entry = normalized.find((item) => item.item === state.items[index]);
    const invalidEntry = invalid.find((item) => item.index === index);
    netCell.textContent = entry ? formatMoney(entry.net) : "Controleer";
    row.classList.toggle("row-invalid", Boolean(invalidEntry));
    row.querySelectorAll('input[data-field="bruto"], input[data-field="korting"]').forEach((input) => {
      input.classList.toggle("input-invalid", Boolean(invalidEntry));
      input.title = invalidEntry?.message ?? "";
    });
  });
  updateReconciliation(netTotal, grossTotal, discountTotal);
}

function render() {
  const hasContent = state.recognized || state.items.length > 0;
  elements.results.hidden = !hasContent;
  elements.welcome.hidden = hasContent;
  elements.method.textContent = state.method;
  elements.recognizedText.textContent = state.receiptText;
  renderPeople();
  renderTable();
}

function makeTesseractWorker() {
  if (!window.Tesseract) throw new Error("De lokale OCR-module is niet geladen. Herlaad de pagina en probeer opnieuw.");
  if (state.tesseractWorker) return Promise.resolve(state.tesseractWorker);
  const base = new URL("./vendor/tesseract/", import.meta.url);
  state.tesseractWorkerPromise ??= window.Tesseract.createWorker("nld+eng", 1, {
    workerPath: new URL("worker.min.js", base).href,
    corePath: new URL("core/", base).href,
    langPath: new URL("lang/", base).href,
    gzip: true,
    logger: (message) => {
      if (message.status === "recognizing text" && typeof message.progress === "number") {
        setStatus("Lokale OCR herkent tekst…", message.progress * 100);
      }
    },
  }).then((worker) => {
    state.tesseractWorker = worker;
    return worker;
  }).catch((error) => {
    state.tesseractWorkerPromise = null;
    throw error;
  });
  return state.tesseractWorkerPromise;
}

async function recognizeImage(image) {
  const worker = await makeTesseractWorker();
  const result = await worker.recognize(image);
  return result.data.text;
}

async function extractPdfText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  try {
    const document = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      setStatus(`PDF-tekst lezen · pagina ${pageNumber} van ${document.numPages}`, (pageNumber - 1) / document.numPages * 35);
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const textItems = content.items.filter((item) => item.str?.trim());
      const rows = [];
      for (const item of textItems) {
        const y = item.transform?.[5] ?? 0;
        let row = rows.find((candidate) => Math.abs(candidate.y - y) <= 2.5);
        if (!row) {
          row = { y, items: [] };
          rows.push(row);
        }
        row.items.push(item);
      }
      rows.sort((left, right) => right.y - left.y);
      pages.push(rows.map((row) => row.items.sort((a, b) => a.transform[4] - b.transform[4]).map((item) => item.str).join(" ")).join("\n"));
    }
    return { text: pages.join("\n"), document, cleanup: () => loadingTask.destroy() };
  } catch (error) {
    await loadingTask.destroy();
    throw error;
  }
}

async function ocrPdf(pdfDocument) {
  const pageTexts = [];
  for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
    setStatus(`Bon scannen · pagina ${pageNumber} van ${pdfDocument.numPages}`, (pageNumber - 1) / pdfDocument.numPages * 20);
    const page = await pdfDocument.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.2 });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    await page.render({ canvasContext: context, viewport }).promise;
    pageTexts.push(await recognizeImage(canvas));
    canvas.width = 0;
    canvas.height = 0;
  }
  return pageTexts.join("\n");
}

function fromParsedReceipt(parsed, text, method) {
  state.items = parsed.items.map((item) => ({
    ...item,
    bruto: formatMoney(item.brutoCents),
    korting: formatMoney(item.kortingCents),
  }));
  state.receiptText = text;
  state.method = method;
  state.goodsCents = parsed.goederenCents;
  state.payableCents = parsed.betaaldCents;
  state.xtraDiscountCents = parsed.xtraKortingCents;
  state.recognized = true;
  elements.results.hidden = false;
  elements.welcome.hidden = true;
  render();
}

async function processFile(file) {
  if (!file) return;
  const extension = file.name.split(".").pop().toLowerCase();
  if (!(["pdf", "png", "jpg", "jpeg"].includes(extension))) {
    setStatus("Kies een PDF-, JPG- of PNG-bestand.");
    return;
  }
  elements.selectedFile.textContent = file.name;
  elements.file.disabled = true;
  state.items = [];
  state.receiptText = "";
  state.recognized = false;
  state.goodsCents = null;
  state.payableCents = null;
  state.xtraDiscountCents = null;
  render();
  let cleanupPdf = async () => {};
  try {
    let text = "";
    let method = "";
    if (extension === "pdf") {
      const extracted = await extractPdfText(file);
      cleanupPdf = extracted.cleanup;
      text = extracted.text;
      let parsed = parseReceipt(text);
      if (text.replace(/\s/g, "").length < 100 || parsed.items.length === 0) {
        text = await ocrPdf(extracted.document);
        method = "Lokale Tesseract-OCR op gescande PDF-pagina's";
        parsed = parseReceipt(text);
      } else {
        method = "PDF-tekst lokaal uitgelezen (OCR niet nodig)";
      }
      fromParsedReceipt(parsed, text, method);
    } else {
      setStatus("Lokale OCR op de afbeelding starten…", 4);
      text = await recognizeImage(file);
      method = "Lokale Tesseract-OCR op afbeelding";
      fromParsedReceipt(parseReceipt(text), text, method);
    }
    if (!state.items.length) {
      setStatus("Tekst gelezen, maar geen productregels herkend. Bekijk de tekst of voeg regels handmatig toe.");
    } else {
      finishStatus(`${state.items.length} productregels herkend.`);
    }
  } catch (error) {
    console.error("BonSplit lokale verwerking:", error);
    setStatus(error.message || "De bon kon niet worden gelezen. Controleer het bestand en probeer opnieuw.");
  } finally {
    await cleanupPdf();
    if (state.tesseractWorkerPromise) {
      try {
        const worker = state.tesseractWorker || await state.tesseractWorkerPromise;
        await worker.terminate();
      } catch {
        // A failed OCR worker is already unusable; release the app's reference.
      }
      state.tesseractWorker = null;
      state.tesseractWorkerPromise = null;
    }
    elements.file.disabled = false;
    elements.file.value = "";
  }
}

function addPerson(name) {
  const trimmed = name.trim();
  if (!trimmed) return;
  if (state.people.some((person) => person.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
    elements.personInput.setCustomValidity("Deze persoon staat al in de lijst.");
    elements.personInput.reportValidity();
    elements.personInput.setCustomValidity("");
    return;
  }
  state.people.push(trimmed);
  render();
}

function addProduct() {
  state.items.push({
    artikel: "",
    product: "Nieuw product",
    hoeveelheid: "1",
    eenheidsprijs: "",
    brutoCents: 0,
    kortingCents: 0,
    bruto: formatMoney(0),
    korting: formatMoney(0),
    personen: [],
  });
  state.recognized = true;
  render();
  const lastName = elements.rows.querySelector("tr:last-child input[data-field=product]");
  lastName?.focus();
  lastName?.select();
}

function exportCsv() {
  const { invalid, normalized } = currentTotals();
  if (invalid.length || !normalized.length) return;
  const personNames = state.people;
  const rows = [["Product", "Artikel", "Aantal/gewicht", "Bruto", "Korting", "Netto", "Gedeeld door", ...personNames.map((name) => `${name} aandeel`)]];
  normalized.forEach(({ item, gross, discount, net, selected, shares }) => {
    const shareByPerson = Object.fromEntries(selected.map((person, index) => [person, formatMoney(shares[index])]));
    rows.push([
      item.product,
      item.artikel,
      item.hoeveelheid,
      formatMoney(gross),
      formatMoney(discount),
      formatMoney(net),
      selected.join(", ") || "NIET TOEGEWEZEN",
      ...personNames.map((person) => shareByPerson[person] ?? formatMoney(0)),
    ]);
  });
  const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "bonsplit-verdeling.csv";
  link.click();
  URL.revokeObjectURL(url);
}

elements.file.addEventListener("change", (event) => processFile(event.target.files?.[0]));
elements.dropzone.addEventListener("dragover", (event) => { event.preventDefault(); elements.dropzone.classList.add("dragging"); });
elements.dropzone.addEventListener("dragleave", () => elements.dropzone.classList.remove("dragging"));
elements.dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  elements.dropzone.classList.remove("dragging");
  processFile(event.dataTransfer.files?.[0]);
});
elements.addPersonForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addPerson(elements.personInput.value);
  elements.personInput.value = "";
});
elements.addProduct.addEventListener("click", addProduct);
elements.exportCsv.addEventListener("click", exportCsv);
elements.clearReceipt.addEventListener("click", () => {
  state.items = [];
  state.receiptText = "";
  state.method = "";
  state.goodsCents = null;
  state.payableCents = null;
  state.xtraDiscountCents = null;
  state.recognized = false;
  elements.file.value = "";
  elements.selectedFile.textContent = "Nog geen bestand gekozen";
  elements.status.hidden = true;
  render();
});
elements.rows.addEventListener("input", (event) => {
  const input = event.target.closest("input[data-field]");
  if (!input) return;
  const row = input.closest("tr");
  const item = state.items[Number(row.dataset.index)];
  item[input.dataset.field] = input.value;
  if (input.dataset.field === "product") {
    row.querySelector("input[type=checkbox]")?.setAttribute("aria-label", `${state.people[0] ?? "Persoon"} betaalt mee voor ${input.value || "dit product"}`);
  }
  updateTotals();
});
elements.rows.addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[type="checkbox"][data-person]');
  if (checkbox) {
    const row = checkbox.closest("tr");
    const item = state.items[Number(row.dataset.index)];
    const person = checkbox.dataset.person;
    item.personen = checkbox.checked
      ? [...new Set([...item.personen, person])]
      : item.personen.filter((name) => name !== person);
    checkbox.closest(".person-toggle")?.classList.toggle("is-selected", checkbox.checked);
    updateTotals();
    return;
  }
  const input = event.target.closest('input[data-field="bruto"], input[data-field="korting"]');
  if (input) {
    try {
      parseMoneyCents(input.value);
      input.classList.remove("input-invalid");
    } catch {
      input.classList.add("input-invalid");
    }
    updateTotals();
  }
});

elements.selectedFile.textContent = "Nog geen bestand gekozen";
