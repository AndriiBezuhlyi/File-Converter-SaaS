export interface InfrastructureDependency {
  start(): Promise<void>;
  check(): Promise<void>;
  stop(): Promise<void> | void;
}

export async function bounded<T>(operation: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Infrastructure operation timed out.')), timeout);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
