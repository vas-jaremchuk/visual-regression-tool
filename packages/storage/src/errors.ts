/** Raised for any failed storage call; `status` is the HTTP status when there was a response. */
export class StorageError extends Error {
  readonly status: number | undefined;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, { cause: options.cause });
    this.name = 'StorageError';
    this.status = options.status;
  }

  static async fromResponse(operation: string, res: Response): Promise<StorageError> {
    const body = await res.text().catch(() => '');
    const detail = body ? ` ${body.slice(0, 500)}` : '';
    return new StorageError(`${operation} failed: ${res.status}${detail}`, { status: res.status });
  }
}

export class ObjectNotFoundError extends StorageError {
  readonly bucket: string;
  readonly key: string;

  constructor(bucket: string, key: string) {
    super(`Object not found: ${bucket}/${key}`, { status: 404 });
    this.name = 'ObjectNotFoundError';
    this.bucket = bucket;
    this.key = key;
  }
}
