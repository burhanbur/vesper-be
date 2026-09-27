import type { NextFunction, Request, Response } from 'express';
import { validate as isUuid, v7 as uuidv7 } from 'uuid';

const REQUEST_ID_HEADER = 'x-request-id';

export function requestId(request: Request, response: Response, next: NextFunction): void {
  const incomingId = request.header(REQUEST_ID_HEADER);
  request.id = incomingId && isUuid(incomingId) ? incomingId : uuidv7();
  response.setHeader(REQUEST_ID_HEADER, request.id);
  next();
}
