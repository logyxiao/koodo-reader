import ShelfUtil, { buildShelfTree } from "./shelfUtil";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { collectFolderImportFiles } from "../file/folderImport";

jest.mock("../../assets/lib/kookit-extra-browser.min", () => {
  let maps = {},
    lists = {},
    settings = {};
  return {
    ConfigService: {
      reset() {
        maps = {};
        lists = {};
        settings = {};
      },
      getAllMapConfig: (name) => JSON.parse(JSON.stringify(maps[name] || {})),
      setOneMapConfig: (key, ids, name) => {
        maps[name] = { ...(maps[name] || {}), [key]: [...ids] };
      },
      deleteMapConfig: (key, name) => {
        delete maps[name][key];
      },
      getAllListConfig: (name) => lists[name] || [],
      setAllListConfig: (ids, name) => {
        lists[name] = [...ids];
      },
      getReaderConfig: (key) => settings[key] || "",
      setReaderConfig: (key, value) => {
        settings[key] = value;
      },
    },
  };
});

beforeEach(() => ConfigService.reset());

test("old flat shelves remain roots; identical child names have distinct membership", () => {
  ShelfUtil.create("旧书架");
  const a = ShelfUtil.ensurePath(["例文", "古言", "知乎风"]);
  const b = ShelfUtil.ensurePath(["例文", "悬疑", "知乎风"]);
  ShelfUtil.addBooks(a, ["a"]);
  ShelfUtil.addBooks(b, ["b"]);
  expect(ShelfUtil.bookKeys(a)).toEqual(["a"]);
  expect(ShelfUtil.bookKeys("例文")).toEqual(["a", "b"]);
  expect(ShelfUtil.getTree().find((node) => node.key === "旧书架").depth).toBe(
    0
  );
  expect(
    ShelfUtil.getTree()
      .filter((node) => node.name === "知乎风")
      .map((node) => node.depth)
  ).toEqual([2, 2]);
});

test("parent aggregation deduplicates a book linked to multiple child shelves", () => {
  const a = ShelfUtil.ensurePath(["根", "甲"]);
  const b = ShelfUtil.ensurePath(["根", "乙"]);
  ShelfUtil.addBooks(a, ["same"]);
  ShelfUtil.addBooks(b, ["same", "other"]);
  expect(ShelfUtil.bookKeys("根")).toEqual(["same", "other"]);
});

test("rename and reparent preserve the complete subtree, startup target and collapse state", () => {
  const leaf = ShelfUtil.ensurePath(["例文", "古言", "知乎风"]);
  ShelfUtil.create("归档");
  ShelfUtil.addBooks(leaf, ["book"]);
  ConfigService.setReaderConfig("startupShelf", leaf);
  ConfigService.setAllListConfig(["例文/古言"], "collapsedShelves");
  ShelfUtil.relocate("例文/古言", "古代", "归档");
  expect(ShelfUtil.bookKeys("归档/古代")).toEqual(["book"]);
  expect(ShelfUtil.getAll()[leaf]).toBeUndefined();
  expect(ConfigService.getReaderConfig("startupShelf")).toBe(
    "归档/古代/知乎风"
  );
  expect(ConfigService.getAllListConfig("collapsedShelves")).toEqual([
    "归档/古代",
  ]);
});

test("cycle and name collisions reject before changing existing memberships", () => {
  ShelfUtil.ensurePath(["根", "子"]);
  ShelfUtil.create("另一目录");
  const before = ShelfUtil.getAll();
  expect(() => ShelfUtil.relocate("根", "根", "根/子")).toThrow();
  expect(() => ShelfUtil.relocate("根", "另一目录")).toThrow("Duplicate shelf");
  expect(ShelfUtil.getAll()).toEqual(before);
});

test("removal from a parent affects only matching books in its subtree", () => {
  ShelfUtil.ensurePath(["根", "子"]);
  ShelfUtil.create("其他");
  ShelfUtil.addBooks("根/子", ["remove", "keep"]);
  ShelfUtil.addBooks("其他", ["remove"]);
  ShelfUtil.removeBooks("根", ["absent", "remove"]);
  expect(ShelfUtil.getAll()["根/子"]).toEqual(["keep"]);
  expect(ShelfUtil.getAll()["其他"]).toEqual(["remove"]);
});

test("deleting a subtree clears its settings and retains unrelated shelves", () => {
  ShelfUtil.ensurePath(["甲", "子"]);
  ShelfUtil.create("甲乙");
  ConfigService.setReaderConfig("startupShelf", "甲/子");
  ShelfUtil.removeTree("甲");
  expect(Object.keys(ShelfUtil.getAll())).toEqual(["甲乙"]);
  expect(ConfigService.getReaderConfig("startupShelf")).toBe("");
});

test("renaming an imported shelf preserves its sibling position", () => {
  ShelfUtil.ensurePath(["例文", "甲", "知乎风"]);
  ShelfUtil.ensurePath(["例文", "乙", "知乎风"]);
  ShelfUtil.relocate("例文/甲", "丙", "例文");
  expect(
    ShelfUtil.getTree()
      .filter((node) => node.depth === 1)
      .map((node) => node.name)
  ).toEqual(["丙", "乙"]);
});

test("unreadable entries and directory-link cycles do not abort other files", () => {
  const path = require("path");
  const onError = jest.fn();
  const fs = {
    readdirSync: () => ["broken.txt", "loop", "valid.txt"],
    realpathSync: (name) => (name.endsWith("/loop") ? "/例文" : name),
    statSync: (name) => {
      if (name.endsWith("broken.txt")) throw new Error("ENOENT");
      return {
        isDirectory: name.endsWith("/loop"),
        isFile: name.endsWith(".txt"),
        size: 100,
      };
    },
  };
  const files = collectFolderImportFiles(fs, path, "/例文", [".txt"], onError);
  expect(files.map((file) => file.name)).toEqual(["valid.txt"]);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(Object.keys(ShelfUtil.getAll())).toEqual(["例文"]);
});

test("flat drag order is normalized into a tree without losing children", () => {
  const tree = buildShelfTree({ A: [], "A/a": [], "A/b": [], B: [] }, [
    "A/b",
    "B",
    "A",
    "A/a",
    "missing",
  ]);
  expect(tree.map((node) => node.key)).toEqual(["B", "A", "A/b", "A/a"]);
});

test("folder planning retains empty directories, full paths, sizes and equal-sized files", () => {
  const path = require("path");
  const entries = {
    "/例文": ["甲", "乙", "空目录", ".hidden"],
    "/例文/甲": ["a.TXT"],
    "/例文/乙": ["b.txt", "skip.exe"],
    "/例文/空目录": [],
  };
  const fs = {
    readdirSync: (name) => entries[name],
    statSync: (name) => ({
      isDirectory: !!entries[name],
      isFile: !entries[name],
      size: 100,
    }),
  };
  const files = collectFolderImportFiles(fs, path, "/例文", [".txt"]);
  expect(files).toHaveLength(2);
  expect(files.map((file) => file.shelfSegments.join("/")).sort()).toEqual(
    ["例文/乙", "例文/甲"].sort()
  );
  expect(
    files.every((file) => file.size === 100 && file.path.endsWith(file.name))
  ).toBe(true);
  expect(ShelfUtil.getAll()["例文/空目录"]).toEqual([]);
});
