import type { Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { config } from '../config/index.js';
import { openApiDocument } from './openapi.js';

export function mountApiDocs(app: Express): void {
  if (!config.API_DOCS_ENABLED || config.NODE_ENV === 'production') {
    return;
  }

  app.get('/docs/openapi.json', (_request, response) => response.json(openApiDocument));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { explorer: true }));
}
