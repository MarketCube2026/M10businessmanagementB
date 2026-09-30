import { Router } from "express";
import { randomBytes } from "node:crypto";
import { mkdirSync, existsSync, promises as fs } from "node:fs";
import path from "node:path";
import multer from "multer";
import mammoth from "mammoth";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { db } from "./db";
import {
  accessible,
  audit,
  canCost,
  fail,
  safeRecord,
  writer,
} from "./service";
import { Kind } from "../shared/domain";
const wrap = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
export const filesRouter = Router();
const storage = path.resolve(
  process.env.STORAGE_DIR ||
    "storage/" + (process.env.APP_MODE === "demo" ? "demo" : "business"),
);
mkdirSync(storage, { recursive: true });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});
filesRouter.post(
  "/records/:id/files",
  (req, res, next) => {
    accessible(req.user, req.params.id)
      .then((r) => {
        writer(req.user, r.kind as Kind);
        if (r.kind === "quote" && !canCost(req.user))
          fail("报价附件可能包含成本，仅财务和主管可管理", 403);
        if (r.archived) fail("记录已归档");
        next();
      })
      .catch(next);
  },
  upload.single("file"),
  wrap(async (req: any, res: any) => {
    const r = await accessible(req.user, req.params.id);
    const f = req.file;
    if (!f) fail("请选择文件");
    const name = Buffer.from(f.originalname, "latin1").toString("utf8");
    const ext = path.extname(name).toLowerCase();
    if (![".pdf", ".docx", ".txt", ".mp3", ".wav", ".m4a"].includes(ext))
      fail("仅支持 PDF、DOCX、TXT、MP3、WAV、M4A");
    let text = "",
      parseStatus = "parsed";
    try {
      if (ext === ".pdf") {
        if (!f.buffer.subarray(0, 5).equals(Buffer.from("%PDF-")))
          throw new Error();
        text = (await pdfParse(f.buffer)).text;
      } else if (ext === ".docx")
        text = (await mammoth.extractRawText({ buffer: f.buffer })).value;
      else if (ext === ".txt") text = f.buffer.toString("utf8");
      else parseStatus = "transcription_unconfigured";
      if (!text.trim() && parseStatus === "parsed")
        parseStatus = "needs_manual_text";
    } catch {
      parseStatus = "parse_failed";
    }
    const filename = randomBytes(24).toString("hex") + ext;
    await fs.writeFile(path.join(storage, filename), f.buffer);
    try {
      const saved = await db.$transaction(async (tx) => {
        const result = await tx.attachment.create({
          data: {
            recordId: r.id,
            name,
            mime:
              ext === ".pdf"
                ? "application/pdf"
                : ext === ".txt"
                  ? "text/plain; charset=utf-8"
                  : ext === ".docx"
                    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    : "application/octet-stream",
            path: filename,
            size: f.size,
            text: text.slice(0, 100000),
            parseStatus,
          },
        });
        await audit(tx, req.user, r.id, "upload", name);
        return result;
      });
      res.status(201).json({ id: saved.id, parseStatus, text: saved.text });
    } catch (e) {
      await fs.unlink(path.join(storage, filename));
      throw e;
    }
  }),
);
filesRouter.get(
  "/files/:id",
  wrap(async (req: any, res: any) => {
    const f = await db.attachment.findUnique({ where: { id: req.params.id } });
    if (!f) fail("文件不存在", 404);
    const r = await accessible(req.user, f.recordId);
    if (r.kind === "quote" && !canCost(req.user)) fail("无权访问成本附件", 403);
    res.setHeader("Content-Type", f.mime);
    res.setHeader(
      "Content-Disposition",
      (req.query.preview === "1" &&
      ["application/pdf", "text/plain; charset=utf-8"].includes(f.mime)
        ? "inline"
        : "attachment") +
        "; filename*=UTF-8''" +
        encodeURIComponent(f.name),
    );
    res.sendFile(path.join(storage, f.path));
  }),
);
filesRouter.get(
  "/records/:id/export/:format",
  wrap(async (req: any, res: any) => {
    const r = await accessible(req.user, req.params.id);
    const safe = safeRecord(req.user, r);
    const text = [
      r.title,
      "版本 " + r.version + " · 状态 " + r.status,
      r.updatedAt.toISOString(),
      ...Object.entries(safe.data).map(([k, v]) => k + "：" + v),
    ].join("\n");
    if (req.params.format === "docx") {
      const doc = new Document({
        sections: [
          {
            children: text
              .split("\n")
              .map(
                (t) =>
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: t,
                        font: "Microsoft YaHei",
                        size: 22,
                      }),
                    ],
                    spacing: { after: 120 },
                  }),
              ),
          },
        ],
      });
      const b = await Packer.toBuffer(doc);
      res
        .type(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        .attachment(r.id + ".docx")
        .send(b);
    } else if (req.params.format === "pdf") {
      const font =
        process.env.PDF_FONT ||
        [
          "C:/Windows/Fonts/msyh.ttc",
          "C:/Windows/Fonts/simsun.ttc",
          "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        ].find(existsSync);
      if (!font) fail("缺少中文字体，请配置 PDF_FONT", 503);
      const pdf = new PDFDocument({ margin: 48 });
      const chunks: Buffer[] = [];
      pdf.on("data", (b) => chunks.push(b));
      const completed = new Promise<Buffer>((resolve, reject) => {
        pdf.on("end", () => resolve(Buffer.concat(chunks)));
        pdf.on("error", reject);
      });
      if (font.endsWith(".ttc"))
        pdf.font(
          font,
          font.includes("msyh")
            ? "MicrosoftYaHei"
            : font.includes("simsun")
              ? "SimSun"
              : "WenQuanYiZenHei",
        );
      else pdf.font(font);
      pdf.fontSize(11).text(text, { lineGap: 5 });
      pdf.end();
      const b = await completed;
      res
        .type("pdf")
        .attachment(r.id + ".pdf")
        .send(b);
    } else fail("不支持的导出格式");
  }),
);
