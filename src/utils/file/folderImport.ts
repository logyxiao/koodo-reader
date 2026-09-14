import ShelfUtil from "../reader/shelfUtil";

export interface FolderImportFile extends File {
  shelfSegments?: string[];
  importQuiet?: boolean;
  openImmediately?: boolean;
  importStatus?: "imported" | "linked" | "duplicate" | "trash" | "failed";
}

export function relativeShelfSegments(file: FolderImportFile): string[] {
  if (file.shelfSegments) return file.shelfSegments;
  return (file.webkitRelativePath || "")
    .split("/")
    .filter(Boolean)
    .slice(0, -1);
}

// File stubs retain their on-disk path; the importer hashes/reads them on demand.
export function collectFolderImportFiles(
  fs: any,
  path: any,
  root: string,
  formats: string[],
  onError: (filePath: string, error: unknown) => void = (filePath, error) =>
    console.warn("Cannot scan folder entry", filePath, error)
): FolderImportFile[] {
  const files: FolderImportFile[] = [];
  const seen = new Set<string>();
  const walk = (directory: string, segments: string[]) => {
    const real = fs.realpathSync ? fs.realpathSync(directory) : directory;
    if (seen.has(real)) return;
    seen.add(real);
    ShelfUtil.ensurePath(segments);
    for (const name of fs
      .readdirSync(directory)
      .sort((a: string, b: string) =>
        a.localeCompare(b, undefined, { numeric: true })
      )) {
      if (name.startsWith(".")) continue;
      const filePath = path.join(directory, name);
      try {
        const stat = fs.statSync(filePath);
        const isDirectory =
          typeof stat.isDirectory === "function"
            ? stat.isDirectory()
            : stat.isDirectory;
        const isFile =
          typeof stat.isFile === "function" ? stat.isFile() : stat.isFile;
        if (isDirectory) walk(filePath, [...segments, name]);
        else if (isFile && formats.includes(path.extname(name).toLowerCase())) {
          const file = new File([], name) as FolderImportFile;
          Object.assign(file, {
            path: filePath,
            shelfSegments: segments,
            importQuiet: true,
          });
          Object.defineProperty(file, "size", { value: stat.size });
          files.push(file);
        }
      } catch (error) {
        onError(filePath, error);
      }
    }
  };
  walk(root, [path.basename(root)]);
  return files;
}
