import fs from 'node:fs';
import path from 'node:path';
import { apiEnv, apiPaths, readJson } from './env';
import type { TestDataEntry, TestDataFile } from './types';

export type DataFileName = 'valid' | 'invalid' | 'boundary';

const ENV_PLACEHOLDER = /^\$\{env:([A-Z0-9_]+)\}$/;

/** Replaces "${env:USERNAME}" strings with <API>_USERNAME values at runtime (secrets never live in files). */
function resolvePlaceholders(apiName: string, value: unknown): unknown {
  if (typeof value === 'string') {
    const m = ENV_PLACEHOLDER.exec(value);
    return m ? (apiEnv(apiName, m[1]) ?? '') : value;
  }
  if (Array.isArray(value)) return value.map((v) => resolvePlaceholders(apiName, v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolvePlaceholders(apiName, v)]));
  }
  return value;
}

export class TestData {
  private readonly files = new Map<DataFileName, TestDataFile>();

  constructor(private readonly apiName: string) {}

  private file(name: DataFileName): TestDataFile {
    let data = this.files.get(name);
    if (!data) {
      const file = path.join(apiPaths(this.apiName).testData, `${name}.json`);
      data = fs.existsSync(file) ? readJson<TestDataFile>(file) : {};
      this.files.set(name, data);
    }
    return data;
  }

  /** Returns a resolved copy of a test-data entry; throws if the key is missing (a script error). */
  entry(name: DataFileName, key: string): TestDataEntry {
    const raw = this.file(name)[key];
    if (!raw) throw new Error(`Test data "${key}" not found in api/${this.apiName}/test-data/${name}.json`);
    return resolvePlaceholders(this.apiName, raw) as TestDataEntry;
  }

  has(name: DataFileName, key: string): boolean {
    return key in this.file(name);
  }
}
