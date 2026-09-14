import React from "react";
import "./importLocal.css";
import BookModel from "../../models/Book";
import { Trans } from "react-i18next";
import Dropzone from "react-dropzone";
import * as Kookit from "../../assets/lib/kookit.min";
import { ImportLocalProps, ImportLocalState } from "./interface";
import { isElectron } from "react-device-detect";
import { withRouter } from "react-router-dom";
import BookUtil from "../../utils/file/bookUtil";
import toast from "react-hot-toast";
import DOMPurify from "dompurify";
import {
  CommonTool,
  ConfigService,
} from "../../assets/lib/kookit-extra-browser.min";
import CoverUtil from "../../utils/file/coverUtil";
import { Readability } from "@mozilla/readability";
import {
  calculateFileMD5,
  clearComicTemp,
  getTextRules,
  supportedFormats,
  throttle,
  vexPromptAsync,
} from "../../utils/common";
import DatabaseService from "../../utils/storage/databaseService";
import { BookHelper } from "../../assets/lib/kookit.min";
import { analyzeBookTitle } from "../../utils/request/reader";
import ShelfUtil from "../../utils/reader/shelfUtil";
import {
  collectFolderImportFiles,
  FolderImportFile,
  relativeShelfSegments,
} from "../../utils/file/folderImport";

// Convert supportedFormats to react-dropzone v14+ accept format
// Key is MIME type, value is array of file extensions
const supportedFormatsAccept = supportedFormats.reduce<
  Record<string, string[]>
>((obj, ext) => {
  const mimeType = CommonTool.getMimeType(ext.replace(".", ""));
  if (mimeType) {
    if (!obj[mimeType]) obj[mimeType] = [];
    obj[mimeType].push(ext);
  }
  return obj;
}, {});
declare var window: any;

// Comic 封面规则与 kookit comic-book.js 保持一致：取自然排序后的第一张图片
const COMIC_IMAGE_EXTS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".webp",
  ".svg",
  ".avif",
  ".apng",
  ".ico",
  ".cur",
  ".jfif",
  ".pjpeg",
  ".pjp",
];
const getComicImageExt = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() || "png";
  return ext === "jpg" ? "jpeg" : ext;
};

export class ImportLocal extends React.Component<
  ImportLocalProps,
  ImportLocalState
> {
  resizeHandler: (() => void) | null = null;
  private importQueue: Promise<void> = Promise.resolve();
  private importTargetShelf = "";
  private importingFile: FolderImportFile | null = null;
  private folderImportRunning = false;

  constructor(props: ImportLocalProps) {
    super(props);
    this.state = {
      isOpenFile: false,
      width: document.body.clientWidth,
      isMoreOptionsVisible: false,
    };
  }
  componentDidMount() {
    if (isElectron) {
      const ipcRenderer = window.electronAPI;
      if (!ConfigService.getItem("storageLocation")) {
        ConfigService.setItem(
          "storageLocation",
          ipcRenderer.sendSync("storage-location", "ping")
        );
      }

      const filePath = ipcRenderer.sendSync("get-file-data");
      if (filePath && filePath !== ".") {
        this.handleFilePath(filePath);
      }
      window.addEventListener(
        "focus",
        () => {
          const _filePath = ipcRenderer.sendSync("get-file-data");
          if (_filePath && _filePath !== ".") {
            this.handleFilePath(_filePath);
          }
        },
        false
      );

      ipcRenderer.on("import-url-from-link", (config: any) => {
        const rawUrl = config?.url;
        if (!rawUrl || typeof rawUrl !== "string") return;
        this.handleURLImport(undefined as any, rawUrl);
      });
    }
    this.resizeHandler = throttle(() => {
      this.setState({ width: document.body.clientWidth });
    });
    window.addEventListener("resize", this.resizeHandler);
    this.props.handleImportBookFunc(this.getMd5WithBrowser);
  }
  componentWillUnmount() {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
  }
  handleFilePath = async (filePath: string) => {
    const fileName = window.electronAPI.path.basename(filePath);
    const stat = window.electronAPI.fs.statSync(filePath);
    const tempFile = new File([], fileName);
    tempFile.path = filePath;
    Object.defineProperty(tempFile, "size", {
      value: stat.size,
      writable: true,
      configurable: true,
    });
    let md5 = await calculateFileMD5(tempFile);

    let repeatBook: BookModel | null = await BookUtil.getBookByMd5(md5);
    if (repeatBook) {
      this.handleJump(repeatBook);
      return;
    }

    const fileTemp = new File([], fileName);
    fileTemp.path = filePath;
    (fileTemp as FolderImportFile).openImmediately = true;
    Object.defineProperty(fileTemp, "size", {
      value: stat.size,
      writable: true,
      configurable: true,
    });

    this.setState({ isOpenFile: true }, async () => {
      await this.getMd5WithBrowser(fileTemp);
    });
  };
  handleJump = (book: BookModel) => {
    ConfigService.setItem("tempBook", JSON.stringify(book));
    BookUtil.redirectBook(book);
    this.props.history.push("/manager/home");
  };
  handleAddBook = async (
    book: BookModel,
    buffer: ArrayBuffer,
    sourcePath?: string
  ) => {
    const quiet = this.importingFile?.importQuiet;
    if (!quiet)
      toast.loading(
        this.props.t("Importing") + ": " + book.name.substring(0, 50),
        { id: "add-book" }
      );
    const openOnly =
      this.importingFile?.openImmediately &&
      ConfigService.getReaderConfig("isPreventAdd") === "yes";
    let isImportPath = ConfigService.getReaderConfig("isImportPath") === "yes";
    if (
      isElectron &&
      (!book.path || !window.electronAPI.fs.existsSync(book.path))
    )
      isImportPath = false;
    if (openOnly) {
      this.handleJump(book);
      this.setState({ isOpenFile: false });
      toast.dismiss("add-book");
      return;
    }
    if (
      !isImportPath ||
      (this.props.isAuthed && ConfigService.getItem("defaultSyncOption"))
    ) {
      await BookUtil.addBook(
        book.key,
        book.format.toLowerCase(),
        buffer,
        sourcePath
      );
    }
    await CoverUtil.addCover(book);
    await DatabaseService.saveRecord(book, "books");
    if (this.importTargetShelf)
      ShelfUtil.addBooks(this.importTargetShelf, [book.key]);
    if (this.importingFile) this.importingFile.importStatus = "imported";
    if (!quiet) {
      this.props.handleReadingBook(book);
      ConfigService.setListConfig(book.key, "recentBooks");
      this.props.handleFetchBooks();
      ShelfUtil.notify();
      toast.success(
        this.props.t("Addition successful") + ": " + book.name.substring(0, 50),
        { id: "add-book" }
      );
      if (this.importingFile?.openImmediately) this.handleJump(book);
      else this.props.history.push("/manager/home");
    }
    this.setState({ isOpenFile: false });
  };

  analyzeBookMetadata = async (book: BookModel, bookName: string) => {
    if (
      ConfigService.getReaderConfig("isAIAnalyzeTitle") !== "yes" ||
      !this.props.isAuthed ||
      book.name !== bookName
    ) {
      return;
    }
    try {
      const response = await analyzeBookTitle(book.name);
      if (response && response.code === 200 && response.data?.name) {
        book.name = response.data.name;
        book.author = response.data.author || book.author;
      }
    } catch (error) {
      console.error(error, bookName);
    }
  };

  getMd5WithBrowser = (file: FolderImportFile): Promise<void> => {
    // All sources share one queue, so a folder target cannot leak into another import.
    const selectedShelf =
      this.props.mode === "shelf" ? this.props.shelfTitle : "";
    const task = this.importQueue.then(async () => {
      this.importingFile = file;
      file.importStatus = "failed";
      try {
        const segments = relativeShelfSegments(file);
        this.importTargetShelf = segments.length
          ? ShelfUtil.ensurePath(segments)
          : selectedShelf;
        const md5 = await calculateFileMD5(file);
        if (!md5) throw new Error(this.props.t("Import failed"));
        await this.handleBook(file, md5);
      } catch (error) {
        console.error(error, file.name);
        toast.error(this.props.t("Import failed") + ": " + file.name, {
          id: "add-book",
        });
      } finally {
        this.importingFile = null;
        this.importTargetShelf = "";
      }
    });
    this.importQueue = task.catch(() => {});
    return task;
  };

  importFolderFiles = async (files: FolderImportFile[]) => {
    if (this.folderImportRunning) return;
    this.folderImportRunning = true;
    const counts = {
      imported: 0,
      linked: 0,
      duplicate: 0,
      trash: 0,
      failed: 0,
    };
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        file.importQuiet = true;
        toast.loading(
          `${this.props.t("Importing")}: ${index + 1}/${files.length} · ${file.name}`,
          { id: "folder-import" }
        );
        await this.getMd5WithBrowser(file);
        counts[file.importStatus || "failed"]++;
        if ((index + 1) % 50 === 0) {
          this.props.handleFetchBooks();
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
      toast.success(
        `${this.props.t("Folder import complete")}: ${this.props.t("Imported")} ${counts.imported}, ${this.props.t("Linked to shelves")} ${counts.linked}, ${this.props.t("Skipped")} ${counts.duplicate + counts.trash}, ${this.props.t("Failed")} ${counts.failed}`,
        { id: "folder-import", duration: 8000 }
      );
    } finally {
      this.folderImportRunning = false;
      this.props.handleFetchBooks();
      ShelfUtil.notify();
      this.setState({ isMoreOptionsVisible: false });
    }
    if (
      ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
      ConfigService.getItem("defaultSyncOption")
    )
      await this.props.cloudSyncFunc();
  };

  handleBook = async (file: FolderImportFile, md5: string) => {
    const extension = file.name.split(".").pop()!.toLowerCase();
    const bookName = file.name.slice(0, -(extension.length + 1));
    const repeatBook = await BookUtil.getBookByMd5(md5);
    if (repeatBook) {
      const deleted = ConfigService.getAllListConfig("deletedBooks") || [];
      if (deleted.includes(repeatBook.key)) {
        file.importStatus = "trash";
        if (!file.importQuiet)
          toast.error(this.props.t("Duplicate book in trash bin"));
      } else if (relativeShelfSegments(file).length && this.importTargetShelf) {
        file.importStatus = ShelfUtil.addBooks(this.importTargetShelf, [
          repeatBook.key,
        ])
          ? "linked"
          : "duplicate";
        if (!file.importQuiet) {
          this.props.handleFetchBooks();
          ShelfUtil.notify();
        }
      } else {
        file.importStatus = "duplicate";
        toast.error(this.props.t("Duplicate book"));
      }
      return;
    }
    const sourcePath =
      isElectron && file.path && window.electronAPI.fs.existsSync(file.path)
        ? file.path
        : "";
    const recordPath = sourcePath || file.path || file.name;
    if (sourcePath && ["cbz", "cbt"].includes(extension)) {
      await new Promise<void>((resolve, reject) => {
        this.handleComicImport(
          file,
          bookName,
          extension,
          md5,
          sourcePath,
          resolve
        ).catch(reject);
      });
      return;
    }
    const content = sourcePath
      ? window.electronAPI.fs.readFileSync(sourcePath)
      : null;
    const buffer = content
      ? new Uint8Array(content).buffer
      : await file.arrayBuffer();
    await new Promise<void>((resolve, reject) => {
      this.processBookContent(
        bookName,
        extension,
        md5,
        buffer,
        file.size || buffer.byteLength,
        sourcePath,
        recordPath,
        resolve
      ).catch(reject);
    });
  };

  handleComicImport = async (
    file: File,
    bookName: string,
    extension: string,
    md5: string,
    sourcePath: string,
    resolve: (value: void) => void
  ) => {
    try {
      if (!isElectron) {
        toast.error(this.props.t("Import failed") + ": " + bookName, {
          duration: 4000,
        });
        return resolve();
      }
      const ipcRenderer = window.electronAPI;
      const fs = window.electronAPI.fs;
      const isZip = extension.toUpperCase() === "CBZ";
      // 只读取归档索引，不解压完整文件
      const entryList: {
        entryPath: string;
        size: number;
        fileName: string;
      }[] = await ipcRenderer.invoke(
        isZip ? "list-zip-file" : "list-tar-file",
        { filePath: sourcePath }
      );
      const images = entryList
        .filter((entry) =>
          COMIC_IMAGE_EXTS.some((ext) =>
            entry.entryPath.toLowerCase().endsWith(ext)
          )
        )
        .sort((a, b) =>
          a.entryPath.localeCompare(b.entryPath, undefined, {
            numeric: true,
            sensitivity: "base",
          })
        );
      if (images.length === 0) {
        throw new Error(this.props.t("No image found in archive"));
      }
      const coverEntry = images[0].entryPath;
      const extracted: string[] = await ipcRenderer.invoke(
        isZip ? "unzip-file" : "untar-file",
        { filePath: sourcePath, entries: [coverEntry] }
      );
      const extractedPath =
        Array.isArray(extracted) && extracted.length > 0 ? extracted[0] : "";
      if (!extractedPath || !fs.existsSync(extractedPath)) {
        throw new Error(this.props.t("Extract cover failed"));
      }
      const buf = fs.readFileSync(extractedPath);
      clearComicTemp();
      const cover = `data:image/${getComicImageExt(
        coverEntry
      )};base64,${CommonTool.arrayBufferToBase64(buf)}`;
      const stat = fs.statSync(sourcePath);
      const key = new Date().getTime() + "" + Math.floor(Math.random() * 1000);
      const book = new BookModel(
        key,
        bookName,
        "",
        "",
        md5,
        cover,
        extension.toUpperCase(),
        "",
        stat.size || file.size || 0,
        images.length,
        sourcePath,
        ""
      );
      await this.analyzeBookMetadata(book, bookName);
      await this.handleAddBook(book, new ArrayBuffer(0), sourcePath);
      return resolve();
    } catch (error) {
      console.error(error, bookName);
      toast.error(this.props.t("Import failed") + ": " + bookName, {
        duration: 4000,
      });
      return resolve();
    }
  };

  processBookContent = async (
    bookName: string,
    extension: string,
    md5: string,
    file_content: ArrayBuffer,
    fileSize: number,
    filePath: string,
    recordPath: string,
    resolve: (value: void) => void
  ) => {
    let result: BookModel;
    try {
      let rendition = BookHelper.getRendition(
        file_content,
        {
          format: extension.toUpperCase(),
          readerMode: "",
          charset: "",
          animation: ConfigService.getReaderConfig("animation") || "none",
          convertChinese: ConfigService.getReaderConfig("convertChinese"),
          bookLayout: ConfigService.getReaderConfig("bookLayout"),
          textRules: getTextRules(),
          codeHighlight: ConfigService.getReaderConfig("codeHighlight") || "",
          fullTranslationMode: "no",
          textOrientation: ConfigService.getReaderConfig("textOrientation"),
          parserRegex: "",
          isDarkMode: "no",
          isMobile: "no",
          password: "",
          isScannedPDF: "no",
          isKeepPDFBackground: "no",
        },
        Kookit
      );
      result = await BookHelper.generateBook(
        bookName,
        extension,
        md5,
        fileSize,
        recordPath,
        file_content,
        rendition
      );

      if (
        ConfigService.getReaderConfig("isPrecacheBook") === "yes" &&
        extension !== "pdf"
      ) {
        let cache = await rendition.preCache(file_content);
        if (cache !== "err" || cache) {
          await BookUtil.addBook("cache-" + result.key, "zip", cache);
        }
      }
    } catch (error) {
      console.error(error, bookName);
      toast.error(this.props.t("Import failed") + ": " + bookName, {
        duration: 4000,
      });
      return resolve();
    }

    // get metadata failed
    if (!result || !result.key) {
      console.error("get metadata failed", bookName);
      toast.error(this.props.t("Import failed") + ": " + bookName, {
        duration: 4000,
      });
      return resolve();
    }
    await this.analyzeBookMetadata(result as BookModel, bookName);
    await this.handleAddBook(
      result as BookModel,
      file_content as ArrayBuffer,
      filePath
    );

    return resolve();
  };

  decodeHtmlEntities = (value: string) => {
    if (!value) return "";
    const doc = new DOMParser().parseFromString(value, "text/html");
    return doc.documentElement.textContent || value;
  };

  escapeHtml = (value: string) => {
    return (value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  makeUrlsAbsolute = (rootDoc: Document, baseUrl: string) => {
    const toAbs = (value: string | null) => {
      if (!value) return value;
      if (value.startsWith("data:")) return value;
      try {
        return new URL(value, baseUrl).toString();
      } catch {
        return value;
      }
    };

    rootDoc.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      const next = toAbs(href);
      if (next) a.setAttribute("href", next);
    });
    rootDoc.querySelectorAll("img[src]").forEach((img) => {
      const src = img.getAttribute("src");
      const next = toAbs(src);
      if (next) img.setAttribute("src", next);
    });
    ["data-src", "data-original", "data-lazy-src"].forEach((attr) => {
      rootDoc.querySelectorAll(`img[${attr}]`).forEach((img) => {
        const value = img.getAttribute(attr);
        const next = toAbs(value);
        if (next) img.setAttribute(attr, next);
      });
    });
    rootDoc.querySelectorAll("link[href]").forEach((l) => {
      const href = l.getAttribute("href");
      const next = toAbs(href);
      if (next) l.setAttribute("href", next);
    });
  };

  fetchImageAsDataUrl = async (imageUrl: string): Promise<string | null> => {
    if (!imageUrl || imageUrl.startsWith("data:")) {
      return imageUrl || null;
    }
    if (imageUrl.startsWith("blob:")) {
      return null;
    }
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) return null;
      const blob = await response.blob();
      const contentType = (
        response.headers.get("content-type") ||
        blob.type ||
        ""
      ).toLowerCase();
      if (contentType && !contentType.startsWith("image/")) {
        return null;
      }
      return await CoverUtil.blobToBase64(blob);
    } catch {
      return null;
    }
  };

  resolveImageUrl = (img: Element): string | null => {
    const candidates = [
      img.getAttribute("src"),
      img.getAttribute("data-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-lazy-src"),
    ].filter(Boolean) as string[];

    for (const value of candidates) {
      if (value.startsWith("data:")) {
        if (value.length > 200) return value;
        continue;
      }
      if (!value.startsWith("blob:")) return value;
    }
    return null;
  };

  embedImagesAsBase64 = async (rootDoc: Document, toastId: string) => {
    const images = Array.from(rootDoc.querySelectorAll("img"));
    const total = images.length;
    if (total === 0) return;

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const imageUrl = this.resolveImageUrl(img);
      if (!imageUrl) continue;

      if (imageUrl.startsWith("data:")) {
        img.setAttribute("src", imageUrl);
        continue;
      }

      const dataUrl = await this.fetchImageAsDataUrl(imageUrl);
      if (dataUrl) {
        img.setAttribute("src", dataUrl);
        img.removeAttribute("data-src");
        img.removeAttribute("data-original");
        img.removeAttribute("data-lazy-src");
        img.removeAttribute("srcset");
      }

      const pct = Math.round(((i + 1) / total) * 100);
      toast.loading(this.props.t("Downloading") + ": " + pct + "%", {
        id: toastId,
        position: "bottom-center",
      });
    }
  };

  importHtmlFromURL = async (
    url: string,
    urlFileName: string,
    toastId: string
  ) => {
    toast.loading(this.props.t("Downloading") + ": 0%", {
      id: toastId,
      position: "bottom-center",
    });
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = (
      response.headers.get("content-type") || ""
    ).toLowerCase();
    const looksLikeHtml =
      contentType.includes("text/html") ||
      contentType.includes("application/xhtml+xml") ||
      contentType.includes("text/plain") ||
      contentType.includes("application/xml") ||
      contentType.includes("text/xml") ||
      !contentType;

    if (!looksLikeHtml) {
      throw new Error(
        this.props.t("Unsupported file format") +
          ": " +
          (contentType || "unknown")
      );
    }

    const htmlText = await response.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, "text/html");

    // 1) Try better main-content extraction (more aggressive clipping).
    let extracted: any = null;
    try {
      const reader = new Readability(doc);
      extracted = reader.parse();
    } catch (e) {
      extracted = null;
    }

    const rawTitle =
      extracted?.title ||
      doc.title ||
      (urlFileName || "book").replace(/\.[^/.]+$/, "") ||
      "book";
    const decodedTitle = this.decodeHtmlEntities(rawTitle).trim() || "book";

    // 2) Prefer extracted content; fallback to body html.
    const extractedContent = extracted?.content || doc.body?.innerHTML || "";

    // 3) Resolve relative links/images to absolute using the original URL.
    const contentDoc = parser.parseFromString(extractedContent, "text/html");
    if (contentDoc?.body) {
      this.makeUrlsAbsolute(contentDoc, url);
      await this.embedImagesAsBase64(contentDoc, toastId);
    }

    // 4) Sanitize & rebuild as a standalone html "book" file.
    const sanitizedBody = DOMPurify.sanitize(
      contentDoc.body?.innerHTML || extractedContent,
      {
        USE_PROFILES: { html: true },
      }
    );

    const safeTitle = this.escapeHtml(decodedTitle);
    const finalHtmlFileName = `${decodedTitle.replace(/[/\\?%*:|"<>]/g, "-")}.html`;
    const finalHtml = `<!doctype html><html><head><meta charset="utf-8"/><title>${safeTitle}</title></head><body>${sanitizedBody}</body></html>`;

    const blob = new Blob([new TextEncoder().encode(finalHtml)], {
      type: "text/html",
    });
    const file = new File([blob], finalHtmlFileName);
    file.path = url; // Helps bookkeeping; works in Electron, no harm in browser.

    toast.dismiss(toastId);
    await this.getMd5WithBrowser(file);
  };
  toggleMoreOptions = () => {
    this.setState((prevState) => ({
      isMoreOptionsVisible: !prevState.isMoreOptionsVisible,
    }));
  };

  // Add method to handle cloud import
  handleCloudImport = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the Dropzone
    this.setState({ isMoreOptionsVisible: false });

    this.props.handleImportDialog(true);
  };

  // Handle OPDS import
  handleOPDSImport = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the Dropzone
    this.setState({ isMoreOptionsVisible: false });
    this.props.handleOPDSDialog(true);
  };

  // Handle auto import folder
  handleAutoImport = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering the Dropzone
    this.setState({ isMoreOptionsVisible: false });
    this.props.handleAutoImportDialog(true);
  };

  // Handle URL import
  handleURLImport = async (e?: React.MouseEvent, externalUrl?: string) => {
    e?.stopPropagation();
    this.setState({ isMoreOptionsVisible: false });
    const url =
      typeof externalUrl === "string"
        ? externalUrl
        : await vexPromptAsync(
            this.props.t("Enter book download URL or article URL"),
            "https://"
          );
    if (!url || typeof url !== "string") return;
    const trimmedUrl = url.trim();
    if (
      !trimmedUrl.startsWith("http://") &&
      !trimmedUrl.startsWith("https://")
    ) {
      toast.error(this.props.t("Please enter a valid http or https URL"));
      return;
    }
    let fileName = decodeURIComponent(
      trimmedUrl.split("?")[0].split("/").pop() || "book"
    );
    const ext = "." + fileName.split(".").pop()?.toLowerCase();
    const toastId = "url-download";
    if (
      !supportedFormats
        .filter((item) => item !== ".html" && item !== ".htm")
        .includes(ext)
    ) {
      try {
        await this.importHtmlFromURL(trimmedUrl, fileName, toastId);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        toast.error(this.props.t("Import failed") + ": " + errorMessage, {
          id: toastId,
        });
        console.error("URL import error:", error);
      }
      return;
    }

    toast.loading(this.props.t("Downloading") + ": 0%", {
      id: toastId,
      position: "bottom-center",
    });
    try {
      const response = await fetch(trimmedUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const contentLength = response.headers.get("content-length");
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (total > 0) {
          const percent = Math.round((received / total) * 100);
          toast.loading(this.props.t("Downloading") + ": " + percent + "%", {
            id: toastId,
            position: "bottom-center",
          });
        } else {
          toast.loading(
            this.props.t("Downloading") +
              ": " +
              (received / 1024).toFixed(1) +
              " KB",
            { id: toastId, position: "bottom-center" }
          );
        }
      }
      toast.dismiss(toastId);
      const arrayBuffer = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        arrayBuffer.set(chunk, offset);
        offset += chunk.length;
      }
      const blob = new Blob([arrayBuffer.buffer]);
      const file = new File([blob], fileName);
      await this.getMd5WithBrowser(file);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      toast.error(this.props.t("Import failed") + ": " + errorMessage, {
        id: toastId,
      });
      console.error("URL import error:", error);
    }
  };
  render() {
    return (
      <Dropzone
        onDrop={async (acceptedFiles) => {
          this.props.handleDrag(false);
          if (
            acceptedFiles.some((file) => relativeShelfSegments(file).length > 0)
          ) {
            await this.importFolderFiles(acceptedFiles);
            return;
          }
          for (let item of acceptedFiles) {
            await this.getMd5WithBrowser(item);
          }
          if (
            ConfigService.getReaderConfig("isDisableAutoSync") !== "yes" &&
            ConfigService.getItem("defaultSyncOption")
          ) {
            await this.props.cloudSyncFunc();
          }
        }}
        accept={supportedFormatsAccept}
        multiple={true}
      >
        {({ getRootProps, getInputProps }) => (
          <div
            className="import-from-local"
            {...getRootProps()}
            style={
              this.props.isCollapsed && document.body.clientWidth < 950
                ? { width: "42px" }
                : {}
            }
          >
            {this.props.isCollapsed && this.state.width < 950 ? null : (
              <div
                className="more-import-option"
                onClick={(e) => {
                  e.stopPropagation(); // Prevent triggering the Dropzone
                  this.toggleMoreOptions();
                }}
              >
                <span className="dropdown-triangle"></span>
                {this.state.isMoreOptionsVisible && (
                  <div
                    className="more-options-dropdown"
                    onMouseLeave={this.toggleMoreOptions}
                    style={
                      this.state.width < 950
                        ? {
                            bottom: "calc(100% + 5px)",
                            top: "unset",
                            right: "unset",
                            left: "-110px",
                          }
                        : {}
                    }
                  >
                    <div
                      className="more-option-item"
                      onClick={async (event) => {
                        event.stopPropagation(); // Prevent triggering the Dropzone
                        //select folder from local
                        if (isElectron) {
                          const ipcRenderer = window.electronAPI;
                          const newPath =
                            await ipcRenderer.invoke("select-path");
                          if (!newPath) {
                            return;
                          }
                          try {
                            const files = collectFolderImportFiles(
                              window.electronAPI.fs,
                              window.electronAPI.path,
                              newPath,
                              supportedFormats,
                              (filePath) =>
                                toast.error(
                                  this.props.t("Unable to read folder entry") +
                                    ": " +
                                    filePath
                                )
                            );
                            await this.importFolderFiles(files);
                          } catch (error) {
                            toast.error(
                              this.props.t("Import failed") +
                                ": " +
                                (error as Error).message
                            );
                          }
                        }
                      }}
                    >
                      <span className="more-option-text">
                        <Trans>Import folder</Trans>
                      </span>
                      {!isElectron && (
                        <input
                          type="file"
                          {...({
                            webkitdirectory: "",
                            mozdirectory: "",
                            directory: "",
                          } as React.InputHTMLAttributes<HTMLInputElement>)}
                          multiple
                          style={{
                            position: "absolute",
                            width: "100%",
                            height: "45px",
                            opacity: 0,
                            marginLeft: "-20px",
                            cursor: "pointer",
                          }}
                          onChange={async (e) => {
                            const files = e.target.files;
                            if (!files || files.length === 0) {
                              return;
                            }
                            await this.importFolderFiles(
                              Array.from(files).filter((file) =>
                                supportedFormats.some((ext) =>
                                  file.name.toLowerCase().endsWith(ext)
                                )
                              )
                            );
                          }}
                        ></input>
                      )}
                    </div>
                    <div
                      className="more-option-item"
                      onClick={this.handleCloudImport}
                    >
                      <span className="more-option-text">
                        <Trans>From cloud storage</Trans>
                      </span>
                    </div>
                    <div
                      className="more-option-item"
                      onClick={this.handleOPDSImport}
                    >
                      <span className="more-option-text">
                        <Trans>From OPDS</Trans>
                      </span>
                    </div>
                    <div
                      className="more-option-item"
                      onClick={this.handleURLImport}
                    >
                      <span className="more-option-text">
                        <Trans>From URL</Trans>
                      </span>
                    </div>
                    {isElectron && (
                      <div
                        className="more-option-item"
                        onClick={this.handleAutoImport}
                      >
                        <span className="more-option-text">
                          <Trans>Auto import folder</Trans>
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="animation-mask-local"></div>
            {this.props.isCollapsed && this.state.width < 950 ? (
              <span
                className="icon-folder"
                style={{ fontSize: "15px", fontWeight: 500 }}
              ></span>
            ) : (
              <span>
                <Trans>Import</Trans>
              </span>
            )}

            {!isElectron ? (
              <input
                type="file"
                id="import-book-box"
                className="import-book-box"
                name="file"
                {...getInputProps()}
              />
            ) : (
              <div
                className="import-book-box"
                onClick={async () => {
                  const ipcRenderer = window.electronAPI;
                  let filePaths = await ipcRenderer.invoke(
                    "select-book",
                    "ping"
                  );
                  for (let filePath of filePaths) {
                    try {
                      const path = window.electronAPI.path;
                      let file = new File([], path.basename(filePath));
                      file.path = filePath;

                      await this.getMd5WithBrowser(file);
                    } catch (error) {
                      const errorMessage =
                        error instanceof Error ? error.message : String(error);
                      toast.error(errorMessage);
                      console.error(
                        `Error processing file ${filePath}:`,
                        error
                      );
                    }
                  }
                  if (
                    ConfigService.getReaderConfig("isDisableAutoSync") !==
                      "yes" &&
                    ConfigService.getItem("defaultSyncOption")
                  ) {
                    await this.props.cloudSyncFunc();
                  }
                }}
              ></div>
            )}
          </div>
        )}
      </Dropzone>
    );
  }
}

export default withRouter(ImportLocal as any);
