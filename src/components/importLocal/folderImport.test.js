import { ImportLocal } from "./component";
import ShelfUtil from "../../utils/reader/shelfUtil";
import BookUtil from "../../utils/file/bookUtil";
import DatabaseService from "../../utils/storage/databaseService";
import { calculateFileMD5 } from "../../utils/common";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

jest.mock("../../assets/lib/kookit-extra-browser.min", () => {
  let maps = {},
    lists = {};
  return {
    CommonTool: { getMimeType: () => "text/plain" },
    ConfigService: {
      reset() {
        maps = {};
        lists = {};
      },
      getAllMapConfig: (name) => JSON.parse(JSON.stringify(maps[name] || {})),
      setOneMapConfig: (key, ids, name) => {
        maps[name] = { ...(maps[name] || {}), [key]: ids };
      },
      getAllListConfig: (name) => lists[name] || [],
      setAllListConfig: (ids, name) => {
        lists[name] = ids;
      },
      getReaderConfig: () => "",
      getItem: () => "",
      setListConfig: jest.fn(),
    },
  };
});
jest.mock("../../assets/lib/kookit.min", () => ({
  BookHelper: {
    getRendition: () => ({}),
    generateBook: async (name, extension, md5, size, path) => ({
      key: md5,
      name,
      format: extension,
      md5,
      size,
      path,
    }),
  },
}));
jest.mock("../../utils/common", () => ({
  calculateFileMD5: jest.fn(async (file) => file.testMd5),
  supportedFormats: [".txt"],
  getTextRules: () => [],
}));
jest.mock("react-device-detect", () => ({ isElectron: true }));
jest.mock("../../utils/file/bookUtil", () => ({
  __esModule: true,
  default: { getBookByMd5: jest.fn(), addBook: jest.fn() },
}));
jest.mock("../../utils/file/coverUtil", () => ({
  __esModule: true,
  default: { addCover: jest.fn() },
}));
jest.mock("../../utils/storage/databaseService", () => ({
  __esModule: true,
  default: { saveRecord: jest.fn() },
}));
jest.mock("../../utils/request/reader", () => ({
  analyzeBookTitle: jest.fn(),
}));

let importer;
const file = (segments, md5) =>
  Object.assign(new File([], md5 + ".txt"), {
    path: "/source/" + md5 + ".txt",
    shelfSegments: segments,
    testMd5: md5,
    importQuiet: true,
  });

beforeEach(() => {
  jest.clearAllMocks();
  ConfigService.reset();
  calculateFileMD5.mockImplementation(async (file) => file.testMd5);
  window.electronAPI = {
    fs: {
      existsSync: () => true,
      readFileSync: () => new Uint8Array([65, 66]),
    },
  };
  BookUtil.getBookByMd5.mockResolvedValue(null);
  DatabaseService.saveRecord.mockResolvedValue(undefined);
  importer = new ImportLocal({
    mode: "home",
    shelfTitle: "",
    t: (text) => text,
    handleFetchBooks: jest.fn(),
    handleReadingBook: jest.fn(),
    history: { push: jest.fn() },
  });
  importer.setState = (state) => {
    importer.state = { ...importer.state, ...state };
  };
});

test("existing content is linked to its directory without copying or saving another book", async () => {
  BookUtil.getBookByMd5.mockResolvedValue({ key: "existing" });
  const input = file(["例文", "古言", "知乎风"], "same");
  await importer.getMd5WithBrowser(input);
  expect(input.importStatus).toBe("linked");
  expect(ShelfUtil.bookKeys("例文/古言")).toEqual(["existing"]);
  expect(BookUtil.addBook).not.toHaveBeenCalled();
  expect(DatabaseService.saveRecord).not.toHaveBeenCalled();
  await importer.getMd5WithBrowser(input);
  expect(input.importStatus).toBe("duplicate");
  expect(ShelfUtil.bookKeys("例文")).toEqual(["existing"]);
});

test("concurrent entry calls keep their own shelf targets and equal-sized contents stay distinct", async () => {
  const a = file(["例文", "古言", "知乎风"], "a");
  const b = file(["例文", "悬疑", "知乎风"], "b");
  await Promise.all([
    importer.getMd5WithBrowser(a),
    importer.getMd5WithBrowser(b),
  ]);
  expect(a.importStatus).toBe("imported");
  expect(b.importStatus).toBe("imported");
  expect(ShelfUtil.bookKeys("例文/古言")).toEqual(["a"]);
  expect(ShelfUtil.bookKeys("例文/悬疑")).toEqual(["b"]);
  expect(DatabaseService.saveRecord).toHaveBeenCalledTimes(2);
});

test("trash duplicates are not silently restored or linked", async () => {
  BookUtil.getBookByMd5.mockResolvedValue({ key: "deleted" });
  ConfigService.setAllListConfig(["deleted"], "deletedBooks");
  const input = file(["例文"], "same");
  await importer.getMd5WithBrowser(input);
  expect(input.importStatus).toBe("trash");
  expect(ShelfUtil.bookKeys("例文")).toEqual([]);
});

test("hash or database failures resolve as failures and do not stall later files", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  calculateFileMD5.mockRejectedValueOnce(new Error("unreadable"));
  const a = file(["例文"], "bad-hash");
  await importer.getMd5WithBrowser(a);
  DatabaseService.saveRecord.mockRejectedValueOnce(new Error("disk full"));
  const b = file(["例文"], "bad-db");
  await importer.getMd5WithBrowser(b);
  const c = file(["例文"], "good");
  await importer.getMd5WithBrowser(c);
  expect([a.importStatus, b.importStatus, c.importStatus]).toEqual([
    "failed",
    "failed",
    "imported",
  ]);
  expect(ShelfUtil.bookKeys("例文")).toEqual(["good"]);
  log.mockRestore();
});
