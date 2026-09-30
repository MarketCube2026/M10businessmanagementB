import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";
const input = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
const target = process.argv[3];
const wb = Workbook.create();
for (const tab of input) {
  const s = wb.worksheets.add(tab.name);
  s.showGridLines = false;
  const width = tab.headers.length;
  const last = String.fromCharCode(64 + width);
  const expanded = tab.rows.flatMap((r) => {
    const cells = r.map((v) =>
      typeof v === "string" ? v.replace(/\r?\n/g, "；") : (v ?? ""),
    );
    const count = Math.max(
      1,
      ...cells.map((v) =>
        typeof v === "string" ? Math.ceil(v.length / 500) : 1,
      ),
    );
    return Array.from({ length: count }, (_, i) =>
      cells.map((v) =>
        typeof v === "string" && v.length > 500
          ? v.slice(i * 500, (i + 1) * 500)
          : i === 0
            ? v
            : typeof v === "string" && v.length < 100
              ? v
              : "",
      ),
    );
  });
  const values = [
    tab.headers,
    ...expanded.map((r) =>
      r.map((v) =>
        typeof v === "string" && /^[=+@]/.test(v) ? "'" + v : (v ?? ""),
      ),
    ),
  ];
  s.getRange("A1:" + last + values.length).values = values;
  const range = s.getRange("A1:" + last + values.length);
  range.format.font.name = "Microsoft YaHei";
  range.format.font.size = 10;
  range.format.rowHeight = 42;
  range.format.columnWidth = 22;
  range.format.wrapText = true;
  range.format.verticalAlignment = "top";
  s.getRange("A1:" + last + "1").format.fill = "#243858";
  s.getRange("A1:" + last + "1").format.font.color = "#FFFFFF";
  s.getRange("A1:" + last + "1").format.font.bold = true;
  s.freezePanes.freezeRows(1);
  for (const col of tab.wide || [])
    s.getRange(col + "1:" + col + values.length).format.columnWidth = 64;
  // Raw evidence is retained in full; long evidence cells use taller rows.
  for (let i = 1; i < values.length; i++) {
    const lines = Math.max(
      ...values[i].map((v, j) =>
        Math.ceil(
          String(v ?? "").length /
            ((tab.wide || []).includes(String.fromCharCode(65 + j)) ? 38 : 13),
        ),
      ),
    );
    s.getRange("A" + (i + 1) + ":" + last + (i + 1)).format.rowHeight =
      Math.max(42, lines * 15 + 12);
  }
}
wb.recalculate();
await fs.mkdir(path.dirname(target), { recursive: true });
await (await SpreadsheetFile.exportXlsx(wb)).save(target);
if (process.argv.includes("--render")) {
  for (const tab of input) {
    try {
      const blob = await wb.render({
        sheetName: tab.name,
        range: "A1:D5",
        scale: 1.5,
      });
      await fs.writeFile(
        path.join(path.dirname(target), tab.name + ".png"),
        new Uint8Array(await blob.arrayBuffer()),
      );
    } catch (e) {
      console.error("Render " + tab.name + ": " + e.message);
    }
  }
}
console.log(
  JSON.stringify({
    sheets: input.length,
    rows: input.reduce((n, s) => n + s.rows.length, 0),
    output: target,
  }),
);
