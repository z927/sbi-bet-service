import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

export const useTempDb = (label: string): string => {
  const random = Math.random().toString(36).slice(2);
  const file = join(tmpdir(), `diretta-${label}-${process.pid}-${random}.db`);
  process.env["DIRETTA_DB"] = file;
  return file;
}

export const removeDb = (file: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(`${file}${suffix}`, { force: true });
  }
}
