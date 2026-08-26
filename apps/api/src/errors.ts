export class HttpError extends Error {
  status: number;
  details: unknown;

  constructor(status: number, message: string, details: unknown = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (message: string, details: unknown = null): HttpError =>
  new HttpError(400, message, details);

export const notFound = (message: string): HttpError => new HttpError(404, message);

export const conflict = (message: string): HttpError => new HttpError(409, message);
