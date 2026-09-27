import SwaggerParser from '@apidevtools/swagger-parser';

await SwaggerParser.validate('generated/openapi.json');
process.stdout.write('OpenAPI document is valid.\n');
