import 'better-sqlite3';

declare module 'better-sqlite3' {
  interface Statement<BindParameters extends unknown[] = unknown[], Result = unknown> {
    get<T = Result>(...params: BindParameters): T | undefined;
    all<T = Result>(...params: BindParameters): T[];
  }
}
