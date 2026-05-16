/**
 * Swagger UI at GET /api/docs — serves openapi.yaml from /api/docs/openapi.yaml
 */

import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function registerApiDocs(app) {
  const openapiPath = path.join(__dirname, 'openapi.yaml');

  app.get('/api/docs/openapi.yaml', (_req, res) => {
    res.type('application/yaml');
    res.send(fs.readFileSync(openapiPath, 'utf8'));
  });

  app.get('/api/docs', (_req, res) => {
    res.type('text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>AMR Portal API</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: '/api/docs/openapi.yaml',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout',
    });
  </script>
</body>
</html>`);
  });
}
