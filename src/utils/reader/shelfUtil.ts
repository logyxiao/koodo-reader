import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

export const SHELVES_CHANGED = "koodo-shelves-changed";
export type ShelfMap = Record<string, string[]>;
export interface ShelfNode {
  key: string;
  name: string;
  parent: string;
  depth: number;
  hasChildren: boolean;
}

// Keep the existing shelf -> book IDs format. A child's key is its full path,
// so equal names in different folders stay distinct and old shelves need no migration.
export const shelfParent = (key: string) =>
  key.slice(0, Math.max(0, key.lastIndexOf("/")));
export const shelfName = (key: string) => key.split("/").pop() || key;
export const inShelfTree = (key: string, root: string) =>
  key === root || key.startsWith(root + "/");

export function buildShelfTree(
  shelves: ShelfMap,
  order: string[] = []
): ShelfNode[] {
  const keys = Array.from(new Set([...order, ...Object.keys(shelves)])).filter(
    (key) => Object.prototype.hasOwnProperty.call(shelves, key)
  );
  const children = new Map<string, string[]>();
  for (const key of keys) {
    const parent = shelfParent(key);
    const actualParent = Object.prototype.hasOwnProperty.call(shelves, parent)
      ? parent
      : "";
    children.set(actualParent, [...(children.get(actualParent) || []), key]);
  }
  const result: ShelfNode[] = [];
  const visit = (parent: string, depth: number) => {
    for (const key of children.get(parent) || []) {
      result.push({
        key,
        parent,
        depth,
        name: parent ? shelfName(key) : key,
        hasChildren: children.has(key),
      });
      visit(key, depth + 1);
    }
  };
  visit("", 0);
  return result;
}

class ShelfUtil {
  static getAll(): ShelfMap {
    return ConfigService.getAllMapConfig("shelfList") || {};
  }
  static getTree() {
    return buildShelfTree(
      this.getAll(),
      ConfigService.getAllListConfig("sortedShelfList") || []
    );
  }
  static notify() {
    window.dispatchEvent(new Event(SHELVES_CHANGED));
  }
  static validateName(name: string) {
    if (!name.trim()) throw new Error("Shelf Title is Empty");
    if (
      name.includes("/") ||
      [".", "..", "__proto__", "constructor", "prototype", "New"].includes(name)
    ) {
      throw new Error("Invalid shelf name");
    }
  }
  static create(name: string, parent = "") {
    name = name.trim();
    this.validateName(name);
    const shelves = this.getAll();
    if (parent && !Object.prototype.hasOwnProperty.call(shelves, parent))
      throw new Error("Shelf not found");
    const key = parent ? parent + "/" + name : name;
    if (Object.prototype.hasOwnProperty.call(shelves, key))
      throw new Error("Duplicate shelf");
    ConfigService.setOneMapConfig(key, [], "shelfList");
    ConfigService.setAllListConfig(
      [...this.getTree().map((node) => node.key)],
      "sortedShelfList"
    );
    this.notify();
    return key;
  }
  static ensurePath(segments: string[], parent = "") {
    const shelves = this.getAll();
    let key = parent;
    let changed = false;
    for (const segment of segments) {
      this.validateName(segment);
      key = key ? key + "/" + segment : segment;
      if (!Object.prototype.hasOwnProperty.call(shelves, key)) {
        ConfigService.setOneMapConfig(key, [], "shelfList");
        shelves[key] = [];
        changed = true;
      }
    }
    if (changed) this.notify();
    return key;
  }
  static bookKeys(root: string, shelves = this.getAll()): string[] {
    return Array.from(
      new Set(
        Object.keys(shelves)
          .filter((key) => inShelfTree(key, root))
          .flatMap((key) => shelves[key] || [])
      )
    );
  }
  static addBooks(key: string, bookKeys: string[]) {
    const current = this.getAll()[key] || [];
    const next = Array.from(new Set([...current, ...bookKeys]));
    if (next.length === current.length) return 0;
    ConfigService.setOneMapConfig(key, next, "shelfList");
    return next.length - current.length;
  }
  static removeBooks(root: string, bookKeys: string[]) {
    const removed = new Set(bookKeys);
    for (const [key, ids] of Object.entries(this.getAll())) {
      if (inShelfTree(key, root) && ids.some((id) => removed.has(id))) {
        ConfigService.setOneMapConfig(
          key,
          ids.filter((id) => !removed.has(id)),
          "shelfList"
        );
      }
    }
    this.notify();
  }
  static relocate(root: string, name: string, parent = "") {
    name = name.trim();
    this.validateName(name);
    const shelves = this.getAll();
    const order = this.getTree().map((node) => node.key);
    if (!Object.prototype.hasOwnProperty.call(shelves, root))
      throw new Error("Shelf not found");
    if (
      parent &&
      (!Object.prototype.hasOwnProperty.call(shelves, parent) ||
        inShelfTree(parent, root))
    ) {
      throw new Error("Cannot move a shelf into itself");
    }
    const nextRoot = parent ? parent + "/" + name : name;
    if (nextRoot === root) return root;
    const affected = Object.keys(shelves).filter((key) =>
      inShelfTree(key, root)
    );
    const remap = (key: string) =>
      inShelfTree(key, root) ? nextRoot + key.slice(root.length) : key;
    if (
      affected.some(
        (key) =>
          Object.prototype.hasOwnProperty.call(shelves, remap(key)) &&
          !affected.includes(remap(key))
      )
    ) {
      throw new Error("Duplicate shelf");
    }
    // All checks finish before the first write; preserve each book membership.
    for (const key of affected) ConfigService.deleteMapConfig(key, "shelfList");
    for (const key of affected)
      ConfigService.setOneMapConfig(remap(key), shelves[key], "shelfList");
    for (const list of ["sortedShelfList", "collapsedShelves"]) {
      ConfigService.setAllListConfig(
        (list === "sortedShelfList"
          ? order
          : ConfigService.getAllListConfig(list) || []
        ).map(remap),
        list
      );
    }
    const startup = ConfigService.getReaderConfig("startupShelf");
    if (startup && inShelfTree(startup, root))
      ConfigService.setReaderConfig("startupShelf", remap(startup));
    this.notify();
    return nextRoot;
  }
  static removeTree(root: string) {
    for (const key of Object.keys(this.getAll())) {
      if (inShelfTree(key, root))
        ConfigService.deleteMapConfig(key, "shelfList");
    }
    for (const list of ["sortedShelfList", "collapsedShelves"]) {
      ConfigService.setAllListConfig(
        (ConfigService.getAllListConfig(list) || []).filter(
          (key: string) => !inShelfTree(key, root)
        ),
        list
      );
    }
    const startup = ConfigService.getReaderConfig("startupShelf");
    if (startup && inShelfTree(startup, root))
      ConfigService.setReaderConfig("startupShelf", "");
    this.notify();
  }
}
export default ShelfUtil;
