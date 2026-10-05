/** The part of a VS Code configuration section the settings reader needs. */
export interface ConfigReader {
  get<T>(key: string): T | undefined;
}
